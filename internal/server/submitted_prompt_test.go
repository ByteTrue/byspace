package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func newSubmittedPromptSession(t *testing.T) providers.ManagedSession {
	t.Helper()
	return providers.StartMockSession(providers.MockLaunchOptions{
		Cwd:   t.TempDir(),
		Model: "e2e-fast-stream",
	})
}

// The row exists before the provider echoes, which is what lets a client that just sent a message
// fetch the timeline and see it. Both ids carry the client id, so the rewind trigger has a target.
func TestStoreSubmittedPromptRowCarriesTheClientID(t *testing.T) {
	session := newSubmittedPromptSession(t)
	entry, stored := storeSubmittedPromptRow(session, "cid_1", "hello")
	if !stored {
		t.Fatal("storeSubmittedPromptRow reported no row")
	}
	if entry.Item.Type != "user_message" {
		t.Fatalf("item type = %q, want user_message", entry.Item.Type)
	}
	if entry.Item.MessageID != "cid_1" || entry.Item.ClientMessageID != "cid_1" {
		t.Fatalf("ids = (%q, %q), want both cid_1", entry.Item.MessageID, entry.Item.ClientMessageID)
	}
	if got := len(session.Timeline()); got != 1 {
		t.Fatalf("timeline length = %d, want 1", got)
	}
}

// Accepting the same prompt twice must not stack rows: a retried send carries the same client id.
func TestStoreSubmittedPromptRowIsIdempotent(t *testing.T) {
	session := newSubmittedPromptSession(t)
	if _, stored := storeSubmittedPromptRow(session, "cid_1", "hello"); !stored {
		t.Fatal("first row was not stored")
	}
	if _, stored := storeSubmittedPromptRow(session, "cid_1", "hello"); stored {
		t.Fatal("second row was stored, want skipped")
	}
	if got := len(session.Timeline()); got != 1 {
		t.Fatalf("timeline length = %d, want 1", got)
	}
}

// A prompt with no client id cannot be matched to an echo, so recording it would leave a row that
// never resolves.
func TestStoreSubmittedPromptRowNeedsAClientID(t *testing.T) {
	session := newSubmittedPromptSession(t)
	if _, stored := storeSubmittedPromptRow(session, "", "hello"); stored {
		t.Fatal("row without a client id was stored")
	}
}

// Node refuses a rewind whose prompt the provider has not echoed, with this exact wording. Until the
// echo arrives the daemon's own row is the only user_message for that client id.
func TestIsUnacknowledgedSubmittedPromptBeforeEcho(t *testing.T) {
	srv := &Server{}
	session := newSubmittedPromptSession(t)
	entry, stored := storeSubmittedPromptRow(session, "cid_1", "hello")
	if !stored {
		t.Fatal("row was not stored")
	}
	srv.recordSubmittedPromptSeq("agt_1", "cid_1", entry.Seq)

	if !srv.isUnacknowledgedSubmittedPrompt(session, "agt_1", "cid_1") {
		t.Fatal("row should read as unacknowledged before the echo")
	}
}

// The echo is a second user_message for the same client id. pi reuses the client id as its own
// message id, so the two rows are separated by seq rather than by their ids.
func TestIsUnacknowledgedSubmittedPromptAfterEcho(t *testing.T) {
	srv := &Server{}
	session := newSubmittedPromptSession(t)
	entry, stored := storeSubmittedPromptRow(session, "cid_1", "hello")
	if !stored {
		t.Fatal("row was not stored")
	}
	srv.recordSubmittedPromptSeq("agt_1", "cid_1", entry.Seq)

	echo := session.AppendTimelineItem(sdk.TimelineItem{
		Type:            "user_message",
		Text:            "hello",
		MessageID:       "cid_1",
		ClientMessageID: "cid_1",
	})
	if echo.Seq == entry.Seq {
		t.Fatalf("echo reused seq %d", echo.Seq)
	}

	if srv.isUnacknowledgedSubmittedPrompt(session, "agt_1", "cid_1") {
		t.Fatal("row should read as acknowledged once the echo is present")
	}
}

// A message id this daemon never recorded belongs to the provider or to a restored session; rewind
// must not invent a refusal for it.
func TestIsUnacknowledgedSubmittedPromptIgnoresUnknownIDs(t *testing.T) {
	srv := &Server{}
	session := newSubmittedPromptSession(t)
	if srv.isUnacknowledgedSubmittedPrompt(session, "agt_1", "msg_provider") {
		t.Fatal("unknown message id read as unacknowledged")
	}
}

// One row per submitted prompt: the provider's echo supersedes the daemon's row, and the surviving
// row keeps the provider's turn id and seq so the client places it in the turn it belongs to.
func TestDedupeSubmittedPromptsKeepsTheEcho(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, Item: sdk.TimelineItem{Type: "user_message", Text: "hi", MessageID: "cid_1", ClientMessageID: "cid_1"}},
		{Seq: 2, Item: sdk.TimelineItem{Type: "user_message", Text: "hi", MessageID: "cid_1", ClientMessageID: "cid_1"}},
		{Seq: 3, Item: sdk.TimelineItem{Type: "assistant_message", Text: "hello"}},
	}
	got := dedupeSubmittedPrompts(rows)
	if len(got) != 2 {
		t.Fatalf("row count = %d, want 2", len(got))
	}
	if got[0].Seq != 2 {
		t.Fatalf("surviving user row seq = %d, want 2 (the echo)", got[0].Seq)
	}
	if got[1].Item.Type != "assistant_message" {
		t.Fatalf("second row = %q, want assistant_message", got[1].Item.Type)
	}
}

// Rows without a client id cannot be paired with an echo, and rows for different prompts must all
// survive.
func TestDedupeSubmittedPromptsLeavesUnpairedRowsAlone(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, Item: sdk.TimelineItem{Type: "user_message", Text: "a"}},
		{Seq: 2, Item: sdk.TimelineItem{Type: "user_message", Text: "b", ClientMessageID: "cid_b"}},
		{Seq: 3, Item: sdk.TimelineItem{Type: "user_message", Text: "c", ClientMessageID: "cid_c"}},
	}
	if got := len(dedupeSubmittedPrompts(rows)); got != 3 {
		t.Fatalf("row count = %d, want 3", got)
	}
}
