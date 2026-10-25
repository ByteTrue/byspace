package agenttitle

import (
	"strings"
	"testing"
)

// Two different titles: the explicit one the client asked for, and a provisional one derived from
// the prompt for the sidebar to show until something better exists.
func TestResolve(t *testing.T) {
	// No explicit title: derive from the prompt.
	got := Resolve("", "  refactor the parser\nand then ship it  ")
	if got.Explicit != "" {
		t.Fatalf("explicit = %q", got.Explicit)
	}
	if got.Provisional != "refactor the parser" {
		t.Fatalf("provisional = %q", got.Provisional)
	}

	// An explicit title wins and suppresses the derived one: the client decided the name.
	got = Resolve("  My agent  ", "do something")
	if got.Explicit != "My agent" {
		t.Fatalf("explicit = %q", got.Explicit)
	}
	if got.Provisional != "do something" {
		t.Fatalf("provisional = %q", got.Provisional)
	}
}

// The first *content* line, not the first line: a prompt opening with a blank line would otherwise
// produce an empty title.
func TestDeriveSkipsBlankLines(t *testing.T) {
	got := Resolve("", "\n\n\n  the real first line \n second")
	if got.Provisional != "the real first line" {
		t.Fatalf("got %q", got.Provisional)
	}
	// Internal whitespace collapses so a tabbed line is one readable string.
	got = Resolve("", "a\tb   c")
	if got.Provisional != "a b c" {
		t.Fatalf("got %q", got.Provisional)
	}
	// A prompt of only whitespace yields nothing rather than a title of spaces.
	if got := Resolve("", "   \n\t\n"); got.Provisional != "" {
		t.Fatalf("got %q", got.Provisional)
	}
}

// A title of Chinese costs three bytes each; a byte limit would cut it to a third of the intended
// length and can split a character.
func TestClampCountsCharacters(t *testing.T) {
	long := strings.Repeat("中", MaxInitialChars+20)
	got := Resolve("", long).Provisional
	if len([]rune(got)) != MaxInitialChars {
		t.Fatalf("runes = %d", len([]rune(got)))
	}
	if strings.ContainsRune(got, '\uFFFD') {
		t.Fatal("the cut split a character")
	}

	explicit := Resolve(strings.Repeat("x", MaxExplicitChars+50), "")
	if len([]rune(explicit.Explicit)) != MaxExplicitChars {
		t.Fatalf("explicit runes = %d", len([]rune(explicit.Explicit)))
	}
}

// A rename applies the same limit the create path does; two limits would let a rename produce a
// title that create would have refused.
func TestClampExplicit(t *testing.T) {
	if got := ClampExplicit("  short  "); got != "short" {
		t.Fatalf("got %q", got)
	}
	if got := ClampExplicit(strings.Repeat("y", MaxExplicitChars+1)); len([]rune(got)) != MaxExplicitChars {
		t.Fatalf("runes = %d", len([]rune(got)))
	}
}
