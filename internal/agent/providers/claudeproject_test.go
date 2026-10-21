package providers

import (
	"path/filepath"
	"strings"
	"testing"
)

// The encoding has to match the Claude SDK exactly: a reader that computes a different directory name
// finds nothing and the import list comes back empty for a project that plainly has sessions.
func TestClaudeProjectDirEncoding(t *testing.T) {
	// The leading slash becomes a dash, which is why real Claude project directories are named
	// `-Users-name-project`. The assertion is on the real shape: getting this "prettier" breaks the
	// match with what the SDK wrote.
	dir := ClaudeProjectDir("/Users/me/work/BySpace", "/cfg")
	if got, want := filepath.Base(dir), "-Users-me-work-BySpace"; got != want {
		t.Fatalf("encoded = %q, want %q", got, want)
	}
	if filepath.Dir(dir) != filepath.Join("/cfg", "projects") {
		t.Fatalf("root = %q", filepath.Dir(dir))
	}

	// Every character outside [a-zA-Z0-9] becomes one dash, including a literal dash.
	if got := filepath.Base(ClaudeProjectDir("/a-b/c.d e", "/cfg")); got != "-a-b-c-d-e" {
		t.Fatalf("got %q", got)
	}
}

// Over the cap, the SDK keeps 200 characters and appends a hash of the ORIGINAL path — which is why the
// hash cannot be computed from the truncated form.
func TestClaudeProjectDirLengthCap(t *testing.T) {
	long := "/" + strings.Repeat("segment/", 40) + "end"
	encoded := filepath.Base(ClaudeProjectDir(long, "/cfg"))
	if len(encoded) <= claudeProjectDirLengthCap {
		t.Fatalf("a long path was not hashed: %d chars", len(encoded))
	}
	if !strings.Contains(encoded[claudeProjectDirLengthCap:], "-") {
		t.Fatalf("no hash suffix: %q", encoded[len(encoded)-12:])
	}

	// Two paths sharing the first 200 encoded characters must not collide.
	other := "/" + strings.Repeat("segment/", 40) + "different"
	if ClaudeProjectDir(long, "/cfg") == ClaudeProjectDir(other, "/cfg") {
		t.Fatal("distinct long paths produced the same directory")
	}
}

// The hash is a 32-bit djb2 rendered in base 36; it has to be this exact function because the SDK
// already wrote the directory names.
func TestClaudeProjectHashSuffixIsDeterministic(t *testing.T) {
	a := claudeProjectHashSuffix("same")
	b := claudeProjectHashSuffix("same")
	if a != b {
		t.Fatalf("unstable: %q vs %q", a, b)
	}
	if claudeProjectHashSuffix("same") == claudeProjectHashSuffix("other") {
		t.Fatal("different inputs hashed the same")
	}
	for _, r := range a {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z') {
			t.Fatalf("not base 36: %q", a)
		}
	}
}

// CLAUDE_CONFIG_DIR wins over the default: a user who moved their config has transcripts there and
// nowhere else.
func TestResolveClaudeConfigDir(t *testing.T) {
	if got := resolveClaudeConfigDir("/explicit"); got != "/explicit" {
		t.Fatalf("explicit = %q", got)
	}
	t.Setenv("CLAUDE_CONFIG_DIR", "/from-env")
	if got := resolveClaudeConfigDir(""); got != "/from-env" {
		t.Fatalf("env = %q", got)
	}
}
