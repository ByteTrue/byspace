package execres

import (
	"context"
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

// `exec.LookPath` returns the first match on PATH regardless of whether it is a program. An entry
// that exists but cannot be executed (no execute bit, wrong format) shadows a good install later in
// PATH, and the daemon then reports "provider not installed" for a machine where it plainly is.
//
// Note what this does NOT test: a binary that runs and exits non-zero is not "broken" by the node
// daemon's definition (classifyProbeError returns true for a numeric exit code), so it does win the
// lookup. Encoding the stricter rule here is what made Go disagree with Node about whether a
// provider was installed.
func TestFindSkipsUnusableCandidate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses file modes")
	}
	broken := t.TempDir()
	good := t.TempDir()
	// Exists, but not executable: EACCES after a successful stat.
	if err := os.WriteFile(filepath.Join(broken, "mycli"), []byte("#!/bin/sh\nexit 0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	goodPath := writeScript(t, good, "mycli", "#!/bin/sh\necho ok\nexit 0\n")

	t.Setenv("PATH", broken+string(os.PathListSeparator)+good)
	if got := Find(t.Context(), "mycli"); got != goodPath {
		t.Fatalf("Find = %q, want the usable candidate %q", got, goodPath)
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
	// A literal path that cannot be executed must not be returned.
	broken := filepath.Join(dir, "broken")
	if err := os.WriteFile(broken, []byte("#!/bin/sh\nexit 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Find(t.Context(), broken); got != "" {
		t.Fatalf("an unusable file must not be returned, got %q", got)
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
	// A non-zero exit is NOT a failure to probe: the binary started. See
	// TestProbeAcceptsNonZeroExit for the node reference behind that rule.
	if !Probe(t.Context(), writeScript(t, dir, "nonzero", "#!/bin/sh\nexit 9\n")) {
		t.Fatal("a binary that runs and exits non-zero is available")
	}
	// A file that cannot be executed is not.
	plain := filepath.Join(dir, "plain")
	if err := os.WriteFile(plain, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if Probe(t.Context(), plain) {
		t.Fatal("a non-executable file must probe false")
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

// The question is "does this binary run", not "does --version exit 0".
//
// Node's classifyProbeError returns true for a numeric exit code and for a killed process, and
// false only for ENOENT/EACCES/ENOEXEC. Reporting a provider as "not installed" because its
// --version happens to exit non-zero (or is slow) makes a working install invisible.
func TestProbeAcceptsNonZeroExit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns a /bin/sh script")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "exits-nonzero")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 3\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !Probe(context.Background(), script) {
		t.Fatal("a binary that runs and exits non-zero is available")
	}
}

func TestProbeAcceptsSlowBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns a /bin/sh script")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "slow")
	// Comfortably past ProbeTimeout, then exits 0.
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 5\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !Probe(context.Background(), script) {
		t.Fatal("a binary that started but timed out is available, not absent")
	}
}

// A file that exists but cannot execute is absent: ENOENT/EACCES/ENOEXEC are the three cases Node
// refuses.
func TestProbeRejectsNonExecutable(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain-text")
	if err := os.WriteFile(plain, []byte("not a program\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if Probe(context.Background(), plain) {
		t.Fatal("a non-executable file must not be reported as available")
	}
	if Probe(context.Background(), filepath.Join(dir, "does-not-exist")) {
		t.Fatal("a missing file must not be reported as available")
	}
}
