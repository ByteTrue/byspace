package pathutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestExpandTilde(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got := ExpandTilde("~"); got != home {
		t.Fatalf("~ → %q", got)
	}
	if got := ExpandTilde("~/code"); got != filepath.Join(home, "code") {
		t.Fatalf("~/code → %q", got)
	}
	// A tilde that is not a prefix must be left alone: `~user` is not ours to expand.
	if got := ExpandTilde("~other/x"); got != "~other/x" {
		t.Fatalf("~other → %q", got)
	}
	if got := ExpandTilde("/abs"); got != "/abs" {
		t.Fatalf("/abs → %q", got)
	}
}

// Two strings can name the same directory: trailing separator, different case on a
// case-insensitive filesystem, or a symlinked prefix (macOS /tmp → /private/tmp).
func TestAreEquivalent(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "a", "b")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}

	if !AreEquivalent(nested, nested+string(filepath.Separator)) {
		t.Fatal("a trailing separator must not make two paths different")
	}
	if !AreEquivalent(nested, filepath.Join(dir, "a", ".", "b")) {
		t.Fatal("a redundant dot segment must not make two paths different")
	}
	if AreEquivalent(nested, filepath.Join(dir, "a")) {
		t.Fatal("a parent and a child are not equivalent")
	}

	// A symlink resolves to its target.
	link := filepath.Join(dir, "link")
	if err := os.Symlink(nested, link); err != nil {
		t.Skip("cannot create symlinks:", err)
	}
	if !AreEquivalent(link, nested) {
		t.Fatal("a symlink must resolve to its target")
	}

	// A path that does not exist falls back to lexical comparison; a realpath failure must not
	// make two identical strings unequal.
	missing := filepath.Join(dir, "does-not-exist")
	if !AreEquivalent(missing, missing) {
		t.Fatal("identical missing paths must be equivalent")
	}
	if AreEquivalent(missing, missing+"2") {
		t.Fatal("different missing paths must not be equivalent")
	}
	if AreEquivalent("", "x") {
		t.Fatal("an empty path only equals an empty path")
	}
}

func TestEquivalenceMatcher(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "ws")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	matches := EquivalenceMatcher(target)
	if !matches(target + "/") {
		t.Fatal("matcher must accept a trailing separator")
	}
	if matches(filepath.Join(dir, "other")) {
		t.Fatal("matcher must reject a different path")
	}
}

// The separator check is the point: without it /repo/app claims to contain /repo/application.
func TestIsWithin(t *testing.T) {
	cases := []struct {
		parent, child string
		want          bool
	}{
		{"/repo/app", "/repo/app/src", true},
		{"/repo/app", "/repo/app", true},
		{"/repo/app", "/repo/application/src", false},
		{"/repo", "/repo/app", true},
		{"/repo", "/elsewhere", false},
	}
	for _, tc := range cases {
		if got := IsWithin(tc.parent, tc.child); got != tc.want {
			t.Fatalf("IsWithin(%q, %q) = %v, want %v", tc.parent, tc.child, got, tc.want)
		}
	}
	// Windows and macOS fold case; the platform decides.
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		if !IsWithin("/Repo", "/repo/app") {
			t.Fatal("case-insensitive filesystems should fold case")
		}
	}
}
