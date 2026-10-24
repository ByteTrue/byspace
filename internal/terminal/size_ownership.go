package terminal

import "sync"

// Terminal size ownership, ported from terminal-size-ownership.ts.
//
// Two clients can watch one terminal — a phone and a laptop. Without an owner, whichever
// window resizes last wins, so opening the session on a phone shrinks the desktop's shell to
// phone width and every line wraps wrong. "claim" takes ownership and resizes; "update" only
// applies when the sender already owns it.

// SizeIntent is what the client asked for.
type SizeIntent string

const (
	// IntentClaim takes ownership and applies the size.
	IntentClaim SizeIntent = "claim"
	// IntentUpdate applies only if the sender already owns the terminal.
	IntentUpdate SizeIntent = "update"
)

// sizeOwners maps a session to the owner token that currently controls its size.
var (
	sizeOwnersMu sync.Mutex
	sizeOwners   = map[*Session]string{}
)

// ApplySize applies a resize request subject to ownership. It reports whether it was applied.
//
// An absent intent is treated as "claim", which is the compatibility behaviour the node daemon
// documents for clients that predate intents.
func ApplySize(sess *Session, owner string, rows, cols uint16, intent SizeIntent) bool {
	if sess == nil || rows == 0 || cols == 0 {
		return false
	}
	if intent == "" {
		intent = IntentClaim
	}

	sizeOwnersMu.Lock()
	current, hasOwner := sizeOwners[sess]
	if intent == IntentUpdate && hasOwner && current != owner {
		sizeOwnersMu.Unlock()
		return false
	}
	if intent == IntentClaim {
		sizeOwners[sess] = owner
	}
	sizeOwnersMu.Unlock()

	curRows, curCols := sess.Size()
	if curRows == rows && curCols == cols {
		return true
	}
	_ = sess.Resize(rows, cols)
	return true
}

// ReleaseSizeOwnership drops a session's owner, used when the owning client disconnects.
func ReleaseSizeOwnership(sess *Session) {
	sizeOwnersMu.Lock()
	delete(sizeOwners, sess)
	sizeOwnersMu.Unlock()
}
