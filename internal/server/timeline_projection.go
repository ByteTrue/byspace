package server

import (
	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// Timeline projection: folding the raw per-delta timeline into the rows the client renders.
//
// Ported from agent/timeline-projection.ts. A provider emits one timeline entry per streaming
// delta, so a single assistant turn is thousands of entries (a ten-second mock stream measured
// 1636 assistant_message deltas for one turn). The client asks for a page of `TIMELINE_FETCH_PAGE_SIZE`
// *projected* rows, and it merges deltas itself only within the ranges the daemon declares — a
// response that sends raw deltas as separate rows with no collapse tells the client they are
// separate rows, and a 40-entry tail page ends up holding 40 fragments of one message with no
// user_message in it at all.
//
// The projection therefore runs here, on the daemon, before paging: collapse tool-call lifecycle
// updates by call id, then merge adjacent assistant deltas and reasoning deltas into single rows.
// Each projected row carries the source seq ranges it covers, which is what lets a page boundary
// fall between messages instead of through one.

// TimelineSeqRange is a contiguous run of source seqs one projected row covers.
type timelineSeqRange struct {
	StartSeq int `json:"startSeq"`
	EndSeq   int `json:"endSeq"`
}

// projectedEntry is one row after projection: the item the client renders plus the seq bookkeeping
// that maps it back to the raw timeline.
type projectedEntry struct {
	Item            pi.TimelineItem
	TurnID          string
	Timestamp       string
	SeqStart        int
	SeqEnd          int
	SourceSeqRanges []timelineSeqRange
	Collapsed       []string
}

// timelineItemIdentity is the key that folds a tool call's lifecycle updates into one row: pi emits
// a running entry and later mutates it to completed, and a provider that appends a second entry with
// the same call id has to collapse onto the first. Only tool_call and plugin items have an identity.
func timelineItemIdentity(item pi.TimelineItem) string {
	if item.Type == "tool_call" {
		return item.CallID
	}
	// plugin items are retired (issue 025); nothing produces them, so they carry no identity here.
	return ""
}

// makeCanonicalEntries turns raw timeline rows into one projected entry each, unmerged. This is the
// "canonical" projection: every delta stays its own row.
func makeCanonicalEntries(rows []pi.TimelineEntry) []projectedEntry {
	out := make([]projectedEntry, 0, len(rows))
	for _, row := range rows {
		seq := row.Seq
		if seq <= 0 {
			seq = 1
		}
		out = append(out, projectedEntry{
			Item:            row.Item,
			TurnID:          row.TurnID,
			Timestamp:       row.Timestamp,
			SeqStart:        seq,
			SeqEnd:          seq,
			SourceSeqRanges: []timelineSeqRange{{StartSeq: seq, EndSeq: seq}},
			Collapsed:       nil,
		})
	}
	return out
}

// appendSeqToRanges extends the last range to cover seq when it is contiguous, else starts a new one.
func appendSeqToRanges(ranges []timelineSeqRange, seq int) []timelineSeqRange {
	if len(ranges) == 0 {
		return []timelineSeqRange{{StartSeq: seq, EndSeq: seq}}
	}
	next := make([]timelineSeqRange, len(ranges))
	copy(next, ranges)
	last := &next[len(next)-1]
	if seq <= last.EndSeq+1 {
		if seq > last.EndSeq {
			last.EndSeq = seq
		}
		return next
	}
	return append(next, timelineSeqRange{StartSeq: seq, EndSeq: seq})
}

// mergeSeqRanges folds incoming ranges into existing ones seq by seq, so a merged row keeps an
// accurate map of every source seq it now covers.
func mergeSeqRanges(existing, incoming []timelineSeqRange) []timelineSeqRange {
	merged := make([]timelineSeqRange, len(existing))
	copy(merged, existing)
	for _, r := range incoming {
		for seq := r.StartSeq; seq <= r.EndSeq; seq++ {
			merged = appendSeqToRanges(merged, seq)
		}
	}
	return merged
}

// mergeToolCallDetail prefers a concrete detail over an "unknown" placeholder: the running entry
// often carries a bare shell, and the completion carries the real output.
func mergeToolCallDetail(existing, incoming pi.TimelineItem) pi.TimelineItem {
	merged := incoming
	merged.Detail = incoming.Detail
	existingType, _ := detailType(existing.Detail)
	incomingType, _ := detailType(incoming.Detail)
	if existingType == "unknown" && incomingType != "unknown" {
		merged.Detail = incoming.Detail
	} else if incomingType == "unknown" && existingType != "unknown" {
		merged.Detail = existing.Detail
	}
	// Metadata (nested codemode's parentToolCallId / nestedSummary) survives from either side.
	if existing.Metadata != nil || incoming.Metadata != nil {
		combined := map[string]any{}
		for k, v := range existing.Metadata {
			combined[k] = v
		}
		for k, v := range incoming.Metadata {
			combined[k] = v
		}
		merged.Metadata = combined
	}
	// The lifecycle's terminal status wins on error: a failure keeps its error, a completion clears it.
	switch incoming.Status {
	case "failed":
		merged.Error = incoming.Error
	case "completed", "canceled":
		merged.Error = nil
	default:
		if incoming.Error != nil {
			merged.Error = incoming.Error
		} else {
			merged.Error = existing.Error
		}
	}
	if merged.Name == "" {
		merged.Name = existing.Name
	}
	return merged
}

func detailType(detail any) (string, bool) {
	m, ok := detail.(map[string]any)
	if !ok {
		return "", false
	}
	t, _ := m["type"].(string)
	return t, ok
}

// collapseByIdentity folds tool-call lifecycle updates that share a call id into one row, and does
// the same for any other identity-bearing item. Non-identity items pass through untouched.
func collapseByIdentity(entries []projectedEntry) []projectedEntry {
	output := make([]projectedEntry, 0, len(entries))
	indexByID := map[string]int{}
	for _, entry := range entries {
		identity := timelineItemIdentity(entry.Item)
		if identity == "" {
			output = append(output, entry)
			continue
		}
		existingIndex, seen := indexByID[identity]
		if !seen {
			indexByID[identity] = len(output)
			output = append(output, entry)
			continue
		}
		existing := output[existingIndex]
		merged, ok := mergeIdentityEntries(existing, entry)
		if !ok {
			// A second, unrelated item reusing the id (a different turn's tool call): keep both.
			indexByID[identity] = len(output)
			output = append(output, entry)
			continue
		}
		output[existingIndex] = merged
	}
	return output
}

func mergeIdentityEntries(existing, entry projectedEntry) (projectedEntry, bool) {
	if entry.Item.Type != "tool_call" || existing.Item.Type != "tool_call" {
		return projectedEntry{}, false
	}
	if existing.TurnID != entry.TurnID {
		return projectedEntry{}, false
	}
	merged := existing
	merged.Item = mergeToolCallDetail(existing.Item, entry.Item)
	merged.Timestamp = entry.Timestamp
	if entry.SeqEnd > merged.SeqEnd {
		merged.SeqEnd = entry.SeqEnd
	}
	merged.SourceSeqRanges = mergeSeqRanges(existing.SourceSeqRanges, entry.SourceSeqRanges)
	merged.Collapsed = appendCollapsed(existing.Collapsed, entry.Collapsed, "tool_lifecycle")
	return merged, true
}

func appendCollapsed(existing, incoming []string, kind string) []string {
	seen := map[string]bool{kind: true}
	out := make([]string, 0, len(existing)+len(incoming)+1)
	for _, k := range existing {
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	for _, k := range incoming {
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	out = append(out, kind)
	return out
}

// mergeReasoningChunks concatenates adjacent reasoning deltas of the same turn into one row.
func mergeReasoningChunks(entries []projectedEntry) []projectedEntry {
	output := make([]projectedEntry, 0, len(entries))
	for _, entry := range entries {
		if len(output) > 0 {
			prev := &output[len(output)-1]
			if prev.Item.Type == "reasoning" && entry.Item.Type == "reasoning" &&
				prev.SeqEnd+1 == entry.SeqStart && prev.TurnID == entry.TurnID {
				prev.Item.Text += entry.Item.Text
				prev.Timestamp = entry.Timestamp
				prev.SeqEnd = entry.SeqEnd
				prev.SourceSeqRanges = mergeSeqRanges(prev.SourceSeqRanges, entry.SourceSeqRanges)
				prev.Collapsed = appendCollapsed(prev.Collapsed, entry.Collapsed, "reasoning_merge")
				continue
			}
		}
		output = append(output, entry)
	}
	return output
}

// mergeAssistantChunks concatenates adjacent assistant deltas of the same turn and message into one
// row. A delta whose messageId differs from the row it would join starts a new row instead: two
// assistant messages in one turn are two bubbles, not one.
func mergeAssistantChunks(entries []projectedEntry) []projectedEntry {
	output := make([]projectedEntry, 0, len(entries))
	for _, entry := range entries {
		if len(output) > 0 {
			prev := &output[len(output)-1]
			if prev.Item.Type == "assistant_message" && entry.Item.Type == "assistant_message" &&
				prev.SeqEnd+1 == entry.SeqStart && prev.TurnID == entry.TurnID &&
				sameAssistantMessage(prev.Item, entry.Item) {
				prev.Item.Text += entry.Item.Text
				prev.Timestamp = entry.Timestamp
				prev.SeqEnd = entry.SeqEnd
				prev.SourceSeqRanges = mergeSeqRanges(prev.SourceSeqRanges, entry.SourceSeqRanges)
				prev.Collapsed = appendCollapsed(prev.Collapsed, entry.Collapsed, "assistant_merge")
				continue
			}
		}
		output = append(output, entry)
	}
	return output
}

// sameAssistantMessage reports whether two deltas belong to one message. An incoming delta with no
// messageId joins whatever precedes it (providers stream text before they know the id); a delta
// with an id joins only a row carrying the same id.
func sameAssistantMessage(prev, entry pi.TimelineItem) bool {
	if entry.MessageID == "" {
		return true
	}
	return prev.MessageID == entry.MessageID
}

// projectTimelineRows folds raw rows into the projected rows the client pages over. `canonical`
// leaves every delta as its own row; `projected` applies the three merges in node's order:
// identity (tool lifecycle) first, then assistant chunks, then reasoning chunks.
func projectTimelineRows(rows []pi.TimelineEntry, mode string) []projectedEntry {
	canonical := makeCanonicalEntries(rows)
	if mode == "canonical" {
		return canonical
	}
	toolCollapsed := collapseByIdentity(canonical)
	assistantMerged := mergeAssistantChunks(toolCollapsed)
	return mergeReasoningChunks(assistantMerged)
}
