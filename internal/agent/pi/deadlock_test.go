package pi

import (
	"testing"
	"time"
)

// An extension notification arriving while handleRawEvent holds s.mu must not lock again.
//
// handleRawEvent runs on the stdout read loop with the session mutex held. A re-entrant Lock
// there deadlocks that loop, and the session then accepts a prompt and produces nothing at all —
// no error, no output, just a silent stall that looks like a slow model.
//
// This test drives the same path with a timeout so a regression fails instead of hanging.
func TestExtensionNotificationDoesNotDeadlock(t *testing.T) {
	sess, err := StartSession(LaunchOptions{NoSession: true})
	if err != nil {
		t.Skip("pi not available:", err)
	}
	defer sess.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		// Exactly what handleRawEvent does: hold the mutex, then route the notification.
		sess.mu.Lock()
		sess.handleExtensionNotification(EntryCaptureMarker + ` {"reason":"session_start","entries":[{"id":"e1","text":"hi"}]}`)
		sess.handleExtensionNotification(CommandResultMarker + ` {"requestId":"r1","ok":true}`)
		sess.mu.Unlock()
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("notification handling deadlocked while the session mutex was held")
	}

	// And the capture was actually recorded.
	if id, ok := sess.TreeEntryForMessage("hi"); !ok || id != "e1" {
		t.Fatalf("entry capture not recorded: id=%q ok=%v", id, ok)
	}
}
