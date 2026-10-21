package execres

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func writeScript(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// `exec.LookPath` returns the first match, which is not the same as a working binary: a stale
// install earlier in PATH shadows a good one later, and the daemon then reports "provider not
// installed" for a machine where it plainly is.
func TestFindSkipsBrokenCandidate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	broken := t.TempDir()
	good := t.TempDir()
	writeScript(t, broken, "mycli", "#!/bin/sh\nexit 1\n")
	goodPath := writeScript(t, good, "mycli", "#!/bin/sh\necho ok\nexit 0\n")

	t.Setenv("PATH", broken+string(os.PathListSeparator)+good)
	if got := Find(t.Context(), "mycli"); got != goodPath {
		t.Fatalf("Find = %q, want the working candidate %q", got, goodPath)
	}
}

// A name with a separator is a literal path, not a PATH lookup.
func TestFindLiteralPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	dir := t.TempDir()
	path := writeScript(t, dir, "tool", "#!/bin/sh\nexit 0\n")
	if got := Find(t.Context(), path); got != path {
		t.Fatalf("got %q", got)
	}
	// A literal path that does not run must not be returned.
	broken := writeScript(t, dir, "broken", "#!/bin/sh\nexit 3\n")
	if got := Find(t.Context(), broken); got != "" {
		t.Fatalf("a failing binary must not be returned, got %q", got)
	}
}

// Nothing on PATH means nothing found — not an error, and not the bare name.
func TestFindMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if got := Find(t.Context(), "definitely-not-a-command-xyz"); got != "" {
		t.Fatalf("got %q", got)
	}
	if Find(t.Context(), "") != "" {
		t.Fatal("an empty name must resolve to nothing")
	}
}

// A non-executable file on PATH is not a candidate.
func TestEnumerateSkipsNonExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("mode bits are not meaningful")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "plain"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if got := Enumerate("plain"); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

// Duplicate PATH entries must not produce duplicate candidates.
func TestEnumerateDeduplicates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	dir := t.TempDir()
	writeScript(t, dir, "dup", "#!/bin/sh\nexit 0\n")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+dir)
	if got := Enumerate("dup"); len(got) != 1 {
		t.Fatalf("got %d candidates", len(got))
	}
}

func TestProbe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	dir := t.TempDir()
	if !Probe(t.Context(), writeScript(t, dir, "ok", "#!/bin/sh\nexit 0\n")) {
		t.Fatal("a working binary should probe true")
	}
	if Probe(t.Context(), writeScript(t, dir, "bad", "#!/bin/sh\nexit 9\n")) {
		t.Fatal("a failing binary should probe false")
	}
	if Probe(t.Context(), "") {
		t.Fatal("an empty path must probe false")
	}
}

// "(--version failed)" is the difference between "not installed" and "installed but broken",
// which need different fixes.
func TestVersionReportsFailureDistinctly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	dir := t.TempDir()
	good := writeScript(t, dir, "good", "#!/bin/sh\necho 1.2.3\necho extra line\nexit 0\n")
	version, err := Version(t.Context(), good)
	if err != nil {
		t.Fatal(err)
	}
	// Only the first line: some CLIs print more after the version.
	if version != "1.2.3" {
		t.Fatalf("version = %q", version)
	}

	broken := writeScript(t, dir, "broken", "#!/bin/sh\nexit 1\n")
	if _, err := Version(t.Context(), broken); err == nil {
		t.Fatal("a binary that exits non-zero must report an error")
	}
	if _, err := Version(t.Context(), ""); err == nil {
		t.Fatal("an empty path must report an error")
	}
}
