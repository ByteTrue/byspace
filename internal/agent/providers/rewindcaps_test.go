package providers

import "testing"

// A capability is a promise the client renders a button from. Claiming rewind everywhere made the button appear
// for providers that cannot do it, and pressing it fails — which reads as the app being broken.
func TestRewindCapabilitiesFor(t *testing.T) {
	pi := RewindCapabilitiesFor("pi")
	if !pi.Conversation || pi.Files {
		t.Fatalf("pi = %+v: the tree extension rewinds the conversation, not the working tree", pi)
	}
	if pi.SupportsRewindBoth() {
		t.Fatal("both needs both halves")
	}

	// opencode reverts files as well; codex only rolls the thread back.
	if opencode := RewindCapabilitiesFor("opencode"); !opencode.Conversation || !opencode.Files {
		t.Fatalf("opencode = %+v", opencode)
	}
	if codex := RewindCapabilitiesFor("codex"); !codex.Conversation || codex.Files {
		t.Fatalf("codex = %+v", codex)
	}

	// Everything else honestly reports nothing, including providers whose node implementation has rewind Go
	// has not ported.
	for _, provider := range []string{"claude", "omp", "copilot", "cursor", "unknown"} {
		caps := RewindCapabilitiesFor(provider)
		if caps.Conversation || caps.Files || caps.SupportsRewindBoth() {
			t.Fatalf("%s = %+v, want no rewind", provider, caps)
		}
	}
}

// The combined mode is only available when both halves are.
func TestSupportsRewindBoth(t *testing.T) {
	if (RewindCapabilities{Conversation: true, Files: true}).SupportsRewindBoth() != true {
		t.Fatal("both should be available")
	}
	if (RewindCapabilities{Conversation: true}).SupportsRewindBoth() {
		t.Fatal("conversation-only must not claim both")
	}
	if (RewindCapabilities{Files: true}).SupportsRewindBoth() {
		t.Fatal("files-only must not claim both")
	}
}
