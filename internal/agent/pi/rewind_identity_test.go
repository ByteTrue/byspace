package pi

import (
	"errors"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestTreeEntryForMessageDistinguishesRepeatedPromptText(t *testing.T) {
	s := &Session{
		treeEntries: map[string]string{},
		timeline: []sdk.TimelineEntry{
			{Item: sdk.TimelineItem{Type: "user_message", Text: "repeat", MessageID: "first"}},
			{Item: sdk.TimelineItem{Type: "assistant_message", Text: "one"}},
			{Item: sdk.TimelineItem{Type: "user_message", Text: "repeat", MessageID: "second"}},
		},
	}
	s.handleEntryCaptureNotification(EntryCaptureMarker + `{"entries":[{"id":"tree-1","text":"repeat"},{"id":"tree-2","text":"repeat"}]}`)
	if id, ok := s.TreeEntryForMessage("first"); !ok || id != "tree-1" {
		t.Fatalf("first entry = %q, %v", id, ok)
	}
	if id, ok := s.TreeEntryForMessage("second"); !ok || id != "tree-2" {
		t.Fatalf("second entry = %q, %v", id, ok)
	}
}

func TestPromptRequestErrorFromPreviousTurnDoesNotFailCurrentTurn(t *testing.T) {
	s := &Session{status: "running", activeTurnID: "turn-2", pendingPromptID: "request-2"}
	s.handlePromptRequestError("request-1", "turn-1", errors.New("stale failure"))
	if s.status != "running" || s.activeTurnID != "turn-2" || s.pendingPromptID != "request-2" {
		t.Fatalf("stale error changed the active turn: %+v", s)
	}
	s.handlePromptRequestError("request-2", "turn-2", errors.New("current failure"))
	if s.status != "idle" {
		t.Fatalf("current error did not settle its turn: %s", s.status)
	}
}

func TestTreeEntryForMessageResolvesCanonicalClientID(t *testing.T) {
	s := &Session{
		treeEntries: map[string]string{"hello": "tree-entry-1"},
		timeline: []sdk.TimelineEntry{{Item: sdk.TimelineItem{
			Type: "user_message", Text: "hello", MessageID: "client-1", ClientMessageID: "client-1",
		}}},
	}
	if id, ok := s.TreeEntryForMessage("client-1"); !ok || id != "tree-entry-1" {
		t.Fatalf("entry = %q, %v", id, ok)
	}
}
