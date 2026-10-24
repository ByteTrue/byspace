package server

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// The notification is the parent's only way to learn a delegated agent finished; without the
// child's last message the parent has to fetch the whole transcript to say anything useful.
func TestFormatFinishNotificationBody(t *testing.T) {
	srv := newNotificationTestServer(t)
	title := "audit the repo"
	lastError := "provider process exited"
	record := store.AgentRecord{
		ID:        "agt_child",
		Title:     &title,
		Cwd:       "/tmp/work",
		LastError: &lastError,
	}

	body := srv.formatFinishNotificationBody(record, finishReasonFinished)
	if !strings.Contains(body, "agt_child") || !strings.Contains(body, "audit the repo") {
		t.Fatalf("the child must be identifiable: %q", body)
	}
	if !strings.Contains(body, finishReasonFinished) {
		t.Fatalf("the reason is missing: %q", body)
	}
	// Told explicitly, so the parent does not wait on an agent that is already done.
	if !strings.Contains(body, "not waiting for input") {
		t.Fatalf("the parent must be told not to wait: %q", body)
	}

	// An error reason carries the error; a plain finish does not.
	errored := srv.formatFinishNotificationBody(record, finishReasonErrored)
	if !strings.Contains(errored, "provider process exited") {
		t.Fatalf("the error is missing: %q", errored)
	}
	if strings.Contains(body, "provider process exited") {
		t.Fatalf("a successful finish must not report an error: %q", body)
	}
}

// A child whose last message is a large dump must not turn into a large parent prompt.
func TestTruncateForNotification(t *testing.T) {
	short := "done"
	if got := truncateForNotification(short); got != short {
		t.Fatalf("short text changed: %q", got)
	}
	long := strings.Repeat("x", FinishNotificationMessageLimit+500)
	got := truncateForNotification(long)
	if len(got) > FinishNotificationMessageLimit+32 {
		t.Fatalf("length = %d", len(got))
	}
	if !strings.Contains(got, "(truncated)") {
		t.Fatal("truncation must be visible")
	}
}

// The prompt the parent receives has to be wrapped as a system envelope, or it renders as a user
// bubble the human never typed.
func TestFinishNotificationUsesSystemEnvelope(t *testing.T) {
	srv := newNotificationTestServer(t)
	title := "child"
	body := srv.formatFinishNotificationBody(store.AgentRecord{ID: "agt_c", Title: &title, Cwd: "/tmp"}, finishReasonFinished)

	// Import-cycle-free check of the wrapping rule: same open/close tags, exact newline layout.
	wrapped := "<byspace-system>\n" + body + "\n</byspace-system>"
	if !strings.HasPrefix(wrapped, "<byspace-system>\n") || !strings.HasSuffix(wrapped, "\n</byspace-system>") {
		t.Fatalf("envelope layout: %q", wrapped)
	}
}

// newNotificationTestServer builds a Server with just enough state for the body formatting.
func newNotificationTestServer(t *testing.T) *Server {
	t.Helper()
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: tmp, Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}
