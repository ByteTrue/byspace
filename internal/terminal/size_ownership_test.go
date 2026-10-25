package terminal

import "testing"

func newTestSession(t *testing.T) *Session {
	t.Helper()
	sess, err := StartSession(StartOptions{Cwd: t.TempDir(), Rows: 24, Cols: 80})
	if err != nil {
		t.Skip("pty unavailable:", err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	return sess
}

// Two clients can watch one terminal. The first resize claims ownership; a later "update" from
// a different client must be ignored, or a phone would shrink the desktop's shell.
func TestApplySizeOwnerWins(t *testing.T) {
	sess := newTestSession(t)

	if !ApplySize(sess, "phone", 40, 100, IntentClaim) {
		t.Fatal("first claim should apply")
	}
	if ApplySize(sess, "desktop", 24, 80, IntentUpdate) {
		t.Fatal("a non-owner update must be ignored")
	}
	if rows, cols := sess.Size(); rows != 40 || cols != 100 {
		t.Fatalf("size changed to %dx%d", rows, cols)
	}
	// The owner can still update.
	if !ApplySize(sess, "phone", 50, 120, IntentUpdate) {
		t.Fatal("the owner's update should apply")
	}
	if rows, cols := sess.Size(); rows != 50 || cols != 120 {
		t.Fatalf("owner update not applied: %dx%d", rows, cols)
	}
	// And another client can take over with a claim.
	if !ApplySize(sess, "desktop", 24, 80, IntentClaim) {
		t.Fatal("a claim should always apply")
	}
}

// Absent intent means claim: that is what clients predating intents send.
func TestApplySizeDefaultsToClaim(t *testing.T) {
	sess := newTestSession(t)
	if !ApplySize(sess, "a", 30, 90, "") {
		t.Fatal("absent intent should claim")
	}
	if !ApplySize(sess, "b", 31, 91, "") {
		t.Fatal("a new claim from another client should apply")
	}
}

func TestApplySizeIgnoresZeroDimensions(t *testing.T) {
	sess := newTestSession(t)
	if ApplySize(sess, "a", 0, 80, IntentClaim) {
		t.Fatal("zero rows must be ignored")
	}
	if ApplySize(sess, "a", 24, 0, IntentClaim) {
		t.Fatal("zero cols must be ignored")
	}
}
