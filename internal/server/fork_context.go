package server

import (
	"errors"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/activity"
	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// Building the fork-context attachment.
//
// Ported from activity-curator.ts's buildAgentForkContextAttachment / selectForkContextRows /
// buildForkContextText. A fork hands the previous conversation to a new agent as one text
// attachment; the client renders it as a "chat history" pill only when the attachment is shaped the
// way TextAttachmentSchema requires — type text, mimeType text/plain, and contextKind
// "chat_history". The previous Go version sent mimeType text/markdown and a name field with no
// contextKind, which failed that schema, so the client saw no attachment at all and every fork spec
// timed out waiting for a pill that never rendered.
//
// One architectural difference from node drives the boundary lookup. Node slices its raw rows by
// `row.seq === cursor.seq` and projects the slice; here the raw entries are projected first and the
// boundary is matched against the projected entries' seq range. That is what the client's cursor
// actually points at — timelineCursor.seq is a projected entry's seqEnd — and it holds for both pi
// (which folds deltas into one entry spanning Seq..SeqEnd) and the mock (one entry per delta).

// forkCursorBoundary is the position a completed turn's fork pins the cut to.
type forkCursorBoundary struct {
	Epoch string
	Seq   int
}

// forkContextResult is the response payload's parts. Attachment is nil only on the error path.
type forkContextResult struct {
	Attachment        map[string]any
	ItemCount         int
	BoundaryCursor    map[string]any
	BoundaryMessageID *string
}

// buildForkContextAttachment selects the rows up to the boundary, curates them to text, and wraps
// them in the shape the client recognises. timelineEpoch is the daemon's current epoch, the same
// value fetch_agent_timeline_response stamps on the cursors the client hands back here.
func buildForkContextAttachment(
	rows []pi.TimelineEntry,
	cursor *forkCursorBoundary,
	boundaryMessageID string,
	timelineEpoch string,
	agentTitle string,
	cwd string,
) (forkContextResult, error) {
	items, selectedCursor, err := selectForkContextItems(rows, cursor, boundaryMessageID, timelineEpoch)
	if err != nil {
		return forkContextResult{}, err
	}

	entries := activity.CurateEntries(items, activity.CuratorOptions{
		// maxItems 0 keeps the whole selected history: a fork is meant to carry the conversation, not
		// a summary of its tail.
		LabelAssistantMessages:   true,
		IncludeKinds:             []string{"user_message", "assistant_message", "tool_call"},
		IncludeExternalToolInput: false,
	})
	body := strings.Join(entries, "\n")
	if strings.TrimSpace(body) == "" {
		body = "No chat history to display."
	}

	result := forkContextResult{
		Attachment: map[string]any{
			"type":        "text",
			"mimeType":    "text/plain",
			"contextKind": "chat_history",
			"title":       "Chat history",
			"text":        buildForkContextText(body, agentTitle, cwd),
		},
		ItemCount: len(items),
	}
	if selectedCursor != nil {
		result.BoundaryCursor = map[string]any{"epoch": selectedCursor.Epoch, "seq": selectedCursor.Seq}
	}
	if id := strings.TrimSpace(boundaryMessageID); id != "" {
		result.BoundaryMessageID = &id
	}
	return result, nil
}

// selectForkContextItems picks the projected items up to and including the boundary.
//
// No boundary projects the whole timeline, which is what an in-flight fork wants: it captures the
// response still streaming. A cursor boundary cuts at the entry whose seq range ends at the cursor;
// a message-id boundary cuts after the last assistant message carrying that id. A cursor from a
// different epoch, or a boundary that matches nothing, is an error rather than a silent whole-history
// fork — the position the user pointed at no longer exists.
func selectForkContextItems(
	rows []pi.TimelineEntry,
	cursor *forkCursorBoundary,
	boundaryMessageID string,
	timelineEpoch string,
) ([]sdk.TimelineItem, *forkCursorBoundary, error) {
	projected := projectTimelineRows(rows, "projected")
	items := make([]sdk.TimelineItem, 0, len(projected))
	for _, entry := range projected {
		items = append(items, entry.Item)
	}

	hasCursor := cursor != nil && cursor.Seq > 0
	messageID := strings.TrimSpace(boundaryMessageID)
	if !hasCursor && messageID == "" {
		return items, nil, nil
	}

	if hasCursor && cursor.Epoch != timelineEpoch {
		return nil, nil, errors.New("Selected timeline position is no longer available.")
	}

	boundaryIndex := -1
	if hasCursor {
		for i, entry := range projected {
			if entry.SeqEnd == cursor.Seq {
				boundaryIndex = i
				break
			}
		}
	} else {
		for i := len(projected) - 1; i >= 0; i-- {
			if projected[i].Item.Type == "assistant_message" && projected[i].Item.MessageID == messageID {
				boundaryIndex = i
				break
			}
		}
	}
	if boundaryIndex < 0 {
		if hasCursor {
			return nil, nil, errors.New("Selected timeline position is no longer available.")
		}
		return nil, nil, errors.New("Selected assistant message is no longer available.")
	}

	selected := make([]sdk.TimelineItem, 0, boundaryIndex+1)
	for _, entry := range projected[:boundaryIndex+1] {
		selected = append(selected, entry.Item)
	}
	if hasCursor {
		return selected, cursor, nil
	}
	return selected, nil, nil
}

// buildForkContextText wraps the curated body in the tag and header a forked agent reads first.
func buildForkContextText(body, agentTitle, cwd string) string {
	header := []string{"Chat history from a previous BySpace agent."}
	if title := strings.TrimSpace(agentTitle); title != "" {
		header = append(header, "Source agent: "+title)
	}
	if dir := strings.TrimSpace(cwd); dir != "" {
		header = append(header, "Source directory: "+dir)
	}
	return "<chat-history-summary>\n" + strings.Join(header, "\n") + "\n\n" + body + "\n</chat-history-summary>"
}
