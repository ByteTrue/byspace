package sdk

import "testing"

// The omp tool names that are not the shared vocabulary still map onto a real card.
func TestOmpToolNamesMapToCards(t *testing.T) {
	for name, want := range map[string]string{
		"read": "read", "ls": "read",
		"edit": "edit", "write": "write",
		"bash": "bash", "execute": "bash",
		"grep": "grep", "find": "grep", "search": "search",
	} {
		if got := canonicalToolName(name); got != want {
			t.Fatalf("%q → %q, want %q", name, got, want)
		}
	}
}

// `xdev` is a wrapper whose inner tool arrives in the result. The name is mapped to bash so the card has
// a shape, and ResolveOmpToolCallName replaces it with the real tool once the result lands.
func TestXdevIsCanonicalized(t *testing.T) {
	if got := canonicalToolName("xdev"); got != "bash" {
		t.Fatalf("xdev → %q", got)
	}
}
