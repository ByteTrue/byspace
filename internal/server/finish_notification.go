package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

// Child-agent finish notifications, ported from setupFinishNotification in agent-prompt.ts.
//
// A parent agent that creates a child and waits for it has no way to learn the child finished:
// the child is a separate agent with its own turn. Without a notification the parent either
// polls (which costs turns) or gives up and reports an answer derived from nothing. The node
// daemon solves this by prompting the parent with a system envelope describing the outcome.
//
// The notification carries the child's last message so the parent can report a result without
// reading the child's transcript.

// FinishNotificationMessageLimit bounds the child's last message in the notification.
//
// The body rides in the parent's prompt; a child whose last message is a 200 KB file dump must
// not turn into a 200 KB parent prompt.
const FinishNotificationMessageLimit = 4000

// finishReasons are the reasons a parent is notified about, matching the node daemon.
const (
	finishReasonFinished  = "finished"
	finishReasonErrored   = "errored"
	finishReasonNeedsPerm = "needs permission"
	finishReasonWasClosed = "was closed"
)

// notifyParentChildFinished prompts a child's parent that the child reached a terminal state.
//
// Called from the places a turn ends. Failures are logged and dropped: a notification that could
// not be delivered must not fail the child's turn, which has already completed.
func (s *Server) notifyParentChildFinished(ctx context.Context, childID, reason string) {
	// One notification per child per terminal state. A turn that both completes and then has its
	// process exit would otherwise prompt the parent twice, and the second prompt is noise that
	// costs a parent turn.
	s.notifiedChildrenMu.Lock()
	if s.notifiedChildren == nil {
		s.notifiedChildren = make(map[string]bool)
	}
	key := childID + "\x00" + reason
	if s.notifiedChildren[key] {
		s.notifiedChildrenMu.Unlock()
		return
	}
	s.notifiedChildren[key] = true
	s.notifiedChildrenMu.Unlock()

	record, err := s.store.GetAgent(childID)
	if err != nil || record == nil {
		return
	}
	parentID := record.ParentAgentID
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		// Also read the label: the node daemon records the relationship there, and an agent
		// created by a parent's MCP call carries both.
		if labelValue, ok := record.Labels[ParentAgentIDLabel]; ok && strings.TrimSpace(labelValue) != "" {
			stripped := strings.TrimSpace(labelValue)
			parentID = &stripped
		}
	}
	if parentID == nil || strings.TrimSpace(*parentID) == "" || *parentID == childID {
		return
	}

	// A parent that no longer exists (deleted or archived) has nobody to tell.
	parentRecord, parentErr := s.store.GetAgent(*parentID)
	if parentErr != nil || parentRecord == nil || parentRecord.ArchivedAt != nil {
		return
	}
	// A parent that is not currently running will pick this up as history: prompting a
	// non-existent runtime would load an agent just to deliver a notification nobody asked for.
	s.mu.Lock()
	parentMP := s.agents[*parentID]
	s.mu.Unlock()
	if parentMP == nil {
		return
	}

	body := s.formatFinishNotificationBody(*record, reason)
	prompt := sdk.FormatSystemNotificationPrompt(body)

	mp, loadErr := s.ensureAgentLoaded(*parentID)
	if loadErr != nil || mp == nil || mp.session == nil {
		return
	}

	// Best effort with its own deadline: the child's turn is already over, so this must not
	// block the caller while a parent is busy.
	notifyCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = mp.session.Prompt(notifyCtx, prompt, nil)
	_ = ctx
}

// formatFinishNotificationBody builds the text the parent reads.
func (s *Server) formatFinishNotificationBody(child store.AgentRecord, reason string) string {
	title := child.Cwd
	if child.Title != nil && strings.TrimSpace(*child.Title) != "" {
		title = strings.TrimSpace(*child.Title)
	}

	sections := []string{
		fmt.Sprintf("Agent %s (%s) %s.", child.ID, title, reason),
	}

	if child.LastError != nil && strings.TrimSpace(*child.LastError) != "" &&
		(reason == finishReasonErrored || reason == finishReasonWasClosed) {
		sections = append(sections, "Error:\n"+truncateForNotification(*child.LastError))
	}

	// The child's last message is what makes this notification useful: the parent can relay a
	// result without fetching the child's transcript.
	if reason == finishReasonFinished {
		if last := s.lastAssistantTextFor(child.ID); last != "" {
			sections = append(sections, "Last message:\n"+truncateForNotification(last))
		}
	}

	sections = append(sections,
		"The child agent is not waiting for input. Do not call wait_for_finish on it again.")

	return strings.Join(sections, "\n\n")
}

// lastAssistantTextFor returns the most recent assistant text of an agent, live or persisted.
func (s *Server) lastAssistantTextFor(agentID string) string {
	s.mu.Lock()
	mp := s.agents[agentID]
	s.mu.Unlock()
	if mp != nil && mp.session != nil {
		if text := strings.TrimSpace(mp.session.LastAssistantText()); text != "" {
			return text
		}
		return ""
	}

	// The child is usually already gone by the time this runs (its runtime is released at the
	// end of the turn), so the transcript is the only source.
	record, err := s.store.GetAgent(agentID)
	if err != nil || record == nil || record.Persistence == nil {
		return ""
	}
	path, isString := record.Persistence.NativeHandle.(string)
	if !isString || !strings.HasSuffix(path, ".jsonl") {
		return ""
	}
	entries, loadErr := pi.LoadTimelineFromJSONL(path)
	if loadErr != nil {
		return ""
	}
	for index := len(entries) - 1; index >= 0; index-- {
		if entries[index].Item.Type == "assistant_message" {
			if text := strings.TrimSpace(entries[index].Item.Text); text != "" {
				return text
			}
		}
	}
	return ""
}

// truncateForNotification bounds a notification section.
func truncateForNotification(text string) string {
	if len(text) <= FinishNotificationMessageLimit {
		return text
	}
	cut := FinishNotificationMessageLimit
	for cut > 0 && (text[cut]&0xC0) == 0x80 {
		cut--
	}
	return text[:cut] + "\n… (truncated)"
}

// finishNotificationPayload is the JSON a permission notification carries.
//
// Exported shape on purpose: the parent is told to reply with `respond_to_permission` using
// these ids, so they must appear verbatim.
func finishNotificationPermissionPayload(childID string, permission map[string]any) string {
	body := map[string]any{
		"agentId":   childID,
		"requestId": permission["id"],
		"request":   permission,
	}
	encoded, err := json.MarshalIndent(body, "", "  ")
	if err != nil {
		return ""
	}
	return string(encoded)
}
