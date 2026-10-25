package server

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// The row's text has to match what the client's error surface renders and what the fork spec asserts
// verbatim: the prefix, the error, then code and diagnostic as separate paragraphs.
func TestFormatTurnFailedMessage(t *testing.T) {
	cases := []struct {
		name string
		ev   map[string]any
		want string
	}{
		{
			name: "error only",
			ev:   map[string]any{"error": "Requested mock provider failure"},
			want: "Requested mock provider failure",
		},
		{
			name: "error and code",
			ev:   map[string]any{"error": "boom", "code": "E_TIMEOUT"},
			want: "boom\n\ncode: E_TIMEOUT",
		},
		{
			name: "error code and diagnostic",
			ev:   map[string]any{"error": "boom", "code": "E_X", "diagnostic": "provider died"},
			want: "boom\n\ncode: E_X\n\nprovider died",
		},
		{
			// A diagnostic that just repeats the error must not become a second identical paragraph.
			name: "diagnostic duplicates error",
			ev:   map[string]any{"error": "boom", "diagnostic": "boom"},
			want: "boom",
		},
		{
			name: "empty error still says something",
			ev:   map[string]any{},
			want: "Provider run failed",
		},
		{
			name: "whitespace error is empty",
			ev:   map[string]any{"error": "   "},
			want: "Provider run failed",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := formatTurnFailedMessage(tc.ev); got != tc.want {
				t.Fatalf("formatTurnFailedMessage(%v) = %q, want %q", tc.ev, got, tc.want)
			}
		})
	}
}

// The row carries the prefix, which is what assistant-fork-menu.spec.ts waits on.
func TestSystemErrorRowText(t *testing.T) {
	got := systemErrorRowText(map[string]any{"error": "Requested mock provider failure"})
	want := "[System Error] Requested mock provider failure"
	if got != want {
		t.Fatalf("systemErrorRowText = %q, want %q", got, want)
	}
}

func newNoticeSession(t *testing.T) providers.ManagedSession {
	t.Helper()
	return providers.StartMockSession(providers.MockLaunchOptions{
		Cwd:   t.TempDir(),
		Model: "e2e-fast-stream",
	})
}

func lastItemText(session providers.ManagedSession) (string, bool) {
	entries := session.Timeline()
	if len(entries) == 0 {
		return "", false
	}
	last := entries[len(entries)-1].Item
	if last.Type != "assistant_message" {
		return "", false
	}
	return last.Text, true
}

// A failed turn leaves a row the reader can see, stored in the provider's own timeline so it is part
// of the transcript and not just a transient event.
func TestAppendSystemErrorRowStoresIt(t *testing.T) {
	session := newNoticeSession(t)
	entry, stored := storeSystemErrorRow(session, "[System Error] Requested mock provider failure")
	if !stored {
		t.Fatal("the row was not stored")
	}
	if entry.Item.Type != "assistant_message" {
		t.Fatalf("stored item type = %q, want assistant_message", entry.Item.Type)
	}
	if entry.Item.MessageID != "" {
		t.Fatalf("the row carries a messageId %q; it belongs to no provider message", entry.Item.MessageID)
	}
	if entry.TurnID != "" {
		t.Fatalf("the row carries a turnId %q; the turn is already over", entry.TurnID)
	}
	got, ok := lastItemText(session)
	if !ok || got != "[System Error] Requested mock provider failure" {
		t.Fatalf("last timeline item = %q (assistant=%v), want the system error row", got, ok)
	}
	// A row that failed to reach the timeline would still show as a live event but vanish on reload.
	if !strings.Contains(got, systemErrorPrefix) {
		t.Fatalf("the row lost its prefix: %q", got)
	}
}

// The same failure twice must not stack two identical rows.
func TestAppendSystemErrorRowDedupesConsecutive(t *testing.T) {
	session := newNoticeSession(t)
	text := "[System Error] boom"
	if _, stored := storeSystemErrorRow(session, text); !stored {
		t.Fatal("first row was not stored")
	}
	if _, stored := storeSystemErrorRow(session, text); stored {
		t.Fatal("a repeat of the immediately preceding row was stored again")
	}
	count := 0
	for _, entry := range session.Timeline() {
		if entry.Item.Type == "assistant_message" && entry.Item.Text == text {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("system error rows = %d, want 1", count)
	}
}

// A failure after real output is a new event, not a repeat — it still gets its row.
func TestAppendSystemErrorRowAfterOtherOutputIsNotDeduped(t *testing.T) {
	session := newNoticeSession(t)
	session.AppendTimelineItem(sdk.TimelineItem{Type: "assistant_message", Text: "some real output"})
	if _, stored := storeSystemErrorRow(session, "[System Error] boom"); !stored {
		t.Fatal("a failure after real output was wrongly deduped")
	}
	if got, ok := lastItemText(session); !ok || got != "[System Error] boom" {
		t.Fatalf("last item = %q (assistant=%v), want the system error row", got, ok)
	}
}

// An empty message is not stored: there is nothing to say.
func TestAppendSystemErrorRowSkipsEmpty(t *testing.T) {
	session := newNoticeSession(t)
	if _, stored := storeSystemErrorRow(session, ""); stored {
		t.Fatal("an empty row was stored")
	}
	if len(session.Timeline()) != 0 {
		t.Fatalf("timeline has %d entries, want 0", len(session.Timeline()))
	}
}
