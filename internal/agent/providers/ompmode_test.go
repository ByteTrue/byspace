package providers

import "testing"

// Without the translation Full Access, Write Approval and Always Ask all ran with omp's default approval
// behaviour — the user's "ask me before writing" silently became whatever omp defaults to.
func TestOmpModeArgs(t *testing.T) {
	cases := map[string][]string{
		"full":  {"--approval-mode", "yolo"},
		"write": {"--approval-mode", "write"},
		"ask":   {"--approval-mode", "always-ask"},
		// An empty mode is the default one.
		"": {"--approval-mode", "yolo"},
	}
	for mode, want := range cases {
		gotMode, args, err := OmpModeArgs(mode)
		if err != nil {
			t.Fatalf("%q: %v", mode, err)
		}
		if len(args) != len(want) || args[0] != want[0] || args[1] != want[1] {
			t.Fatalf("%q → %v, want %v", mode, args, want)
		}
		if gotMode == "" {
			t.Fatalf("%q returned an empty mode", mode)
		}
	}

	// Refused rather than defaulted: silently running an unknown mode as "full" grants unattended access
	// to a caller who asked for something else.
	if _, _, err := OmpModeArgs("yolo-mode"); err == nil {
		t.Fatal("an unknown mode must be refused")
	}
}

// Absent role models are omitted so omp keeps its own defaults.
func TestOmpModelRoleArgs(t *testing.T) {
	if got := OmpModelRoleArgs("", "", ""); len(got) != 0 {
		t.Fatalf("empty → %v", got)
	}
	got := OmpModelRoleArgs("small", " ", "plan")
	want := []string{"--smol", "small", "--plan", "plan"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// An older binary accepts the launch arguments and then behaves differently — the agent starts, so nothing
// reports a failure.
func TestOmpVersionSupported(t *testing.T) {
	for _, version := range []string{
		"16.3.9", "16.4.0", "17.0.0", "omp 16.4.0 (abc123)", "v16.10.1",
	} {
		if !OmpVersionSupported(version) {
			t.Fatalf("%q should be supported", version)
		}
	}
	for _, version := range []string{
		"16.3.8", "16.2.99", "15.0.0", "", "not a version", "1.2",
	} {
		if OmpVersionSupported(version) {
			t.Fatalf("%q should not be supported", version)
		}
	}
}

// A bare "unsupported" makes the user guess whether to upgrade or reconfigure.
func TestOmpVersionMessage(t *testing.T) {
	message := OmpVersionMessage(" 16.3.8 ")
	if message == "" {
		t.Fatal("no message")
	}
	for _, want := range []string{"16.3.8", MinSupportedOmpVersion, "upgrade"} {
		if !containsText(message, want) {
			t.Fatalf("message %q lacks %q", message, want)
		}
	}
	// An unknown version still produces an actionable message.
	if !containsText(OmpVersionMessage(""), "unknown") {
		t.Fatalf("empty version message = %q", OmpVersionMessage(""))
	}
}

func containsText(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
