package cli

import (
	"os"
	"path/filepath"
	"testing"
)

// Only path-like arguments are probed on disk, so a mistyped command does not cost a stat per
// run and cannot resolve to a directory that happens to share its name.
func TestIsPathLikeArg(t *testing.T) {
	pathLike := []string{".", "..", "~", "./x", "../x", "/abs", "~/code", `C:\x`, "C:/x"}
	for _, arg := range pathLike {
		if !isPathLikeArg(arg) {
			t.Fatalf("%q should be path-like", arg)
		}
	}
	notPath := []string{"ls", "daemon", "run", "my-project", "", "-x", "a/b"}
	for _, arg := range notPath {
		if isPathLikeArg(arg) {
			t.Fatalf("%q should not be path-like", arg)
		}
	}
}

// A bare path opens that project; a typo still reports "unknown command" rather than a confusing
// open failure.
func TestClassifyInvocation(t *testing.T) {
	dir := t.TempDir()
	project := filepath.Join(dir, "myapp")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}

	// A path-like argument naming a directory is an open.
	if resolved, err := resolveExistingDirectory(project); err != nil || resolved != project {
		t.Fatalf("resolveExistingDirectory: %q %v", resolved, err)
	}

	// A path-like argument naming nothing is not.
	missing := filepath.Join(dir, "nope")
	if _, err := resolveExistingDirectory(missing); err == nil {
		t.Fatal("a missing directory must not resolve")
	}

	// A file is not a directory.
	file := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveExistingDirectory(file); err == nil {
		t.Fatal("a file must not resolve as a project")
	}

	// A plain word is never a path, even when a directory of that name exists — otherwise
	// `byspace ls` in a repo with a directory called "ls" would open it instead of listing.
	if isPathLikeArg("ls") {
		t.Fatal("a bare command word is not path-like")
	}
}

// Every command the dispatcher accepts must be in the known set, or a directory of that name in
// the working directory would shadow it.
func TestKnownCommandCoversDispatcher(t *testing.T) {
	for _, name := range []string{
		"serve", "web", "relay", "ls", "run", "logs", "attach", "wait",
		"daemon", "agent", "project", "workspace", "terminal", "script",
		"schedule", "heartbeat", "permit", "provider", "worktree",
		"clone", "open", "pair", "onboard", "hooks", "mcp-bridge",
	} {
		if !knownCommand(name) {
			t.Fatalf("%q is a command but not in knownCommandNames", name)
		}
	}
	// Flags are never paths.
	if !knownCommand("-v") {
		t.Fatal("a flag must be treated as a command, not a path")
	}
}

func TestExpandUserPath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	if got := expandUserPath("~"); got != home {
		t.Fatalf("~ → %q", got)
	}
	if got := expandUserPath("~/code"); got != filepath.Join(home, "code") {
		t.Fatalf("~/code → %q", got)
	}
	if got := expandUserPath("/abs"); got != "/abs" {
		t.Fatalf("/abs → %q", got)
	}
	if got := expandUserPath("rel"); got != "rel" {
		t.Fatalf("rel → %q", got)
	}
}
