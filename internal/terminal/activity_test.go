package terminal

import "testing"

// unknown != idle: a plain shell, or a terminal whose agent was killed, must not claim it
// finished. Only working → idle sets the reason, which is what the sidebar's rollup shows.
func TestAttentionReasonOnlyOnFinished(t *testing.T) {
	sess := &Session{activityState: "idle"}
	if got := sess.AttentionReason(); got != "" {
		t.Fatalf("a fresh idle terminal has no reason, got %q", got)
	}

	// idle → working: no reason.
	sess.SetActivity("working")
	if got := sess.AttentionReason(); got != "" {
		t.Fatalf("working has no reason, got %q", got)
	}

	// working → idle: finished.
	sess.SetActivity("idle")
	if got := sess.AttentionReason(); got != "finished" {
		t.Fatalf("expected finished, got %q", got)
	}

	// idle → idle again does not re-raise it after clearing.
	sess.ClearAttention()
	sess.SetActivity("idle")
	if got := sess.AttentionReason(); got != "" {
		t.Fatalf("a no-op transition must not re-raise the marker, got %q", got)
	}
}

// The callback must carry the reason, or the broadcast has no way to show "finished".
func TestActivityCallbackCarriesReason(t *testing.T) {
	var gotState, gotReason string
	sess := &Session{activityState: "idle", onActivityChange: func(state, reason string) {
		gotState, gotReason = state, reason
	}}
	sess.SetActivity("working")
	if gotState != "working" || gotReason != "" {
		t.Fatalf("working: state=%q reason=%q", gotState, gotReason)
	}
	sess.SetActivity("idle")
	if gotState != "idle" || gotReason != "finished" {
		t.Fatalf("idle: state=%q reason=%q", gotState, gotReason)
	}
}
