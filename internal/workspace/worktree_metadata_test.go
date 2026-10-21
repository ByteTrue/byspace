package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func makeRepo(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"config", "user.email", "a@b"},
		{"config", "user.name", "a"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "f"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "f"}, {"commit", "-qm", "init"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	return dir
}

// The metadata lives inside the git directory, not the working tree: a file in the working tree
// would appear in git status and in every diff.
func TestWorktreeMetadataRoundTrip(t *testing.T) {
	repo := makeRepo(t)
	meta := WorktreeMetadata{
		Version:     2,
		BaseRefName: "main",
		BaseRef:     "refs/remotes/origin/main",
		ChangeRequestLookupTarget: &ChangeRequestLookupTarget{
			HeadRef: "feature", ChangeRequestNumber: 42, HeadRepositoryOwner: "acme",
		},
	}
	if err := WriteWorktreeMetadata(repo, meta); err != nil {
		t.Fatal(err)
	}

	// Not visible to git.
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = repo
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Fatalf("metadata leaked into the working tree: %s", out)
	}

	got := ReadWorktreeMetadata(repo)
	if got == nil {
		t.Fatal("metadata not read back")
	}
	if got.BaseRefName != "main" || got.BaseRef != "refs/remotes/origin/main" {
		t.Fatalf("base refs lost: %+v", got)
	}
	if got.ChangeRequestLookupTarget == nil || got.ChangeRequestLookupTarget.ChangeRequestNumber != 42 {
		t.Fatalf("change request target lost: %+v", got.ChangeRequestLookupTarget)
	}
}

// A worktree is still usable without metadata; a corrupt side file must not fail every status
// request.
func TestWorktreeMetadataCorruptReadsAsNone(t *testing.T) {
	repo := makeRepo(t)
	path := WorktreeMetadataPath(repo)
	if path == "" {
		t.Fatal("no metadata path for a repository")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ReadWorktreeMetadata(repo); got != nil {
		t.Fatalf("corrupt metadata should read as none, got %+v", got)
	}
}

// Version 1 files (written before baseRef existed) must still be readable: there are no
// migrations.
func TestWorktreeMetadataReadsVersionOne(t *testing.T) {
	repo := makeRepo(t)
	path := WorktreeMetadataPath(repo)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"baseRefName":"main"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got := ReadWorktreeMetadata(repo)
	if got == nil || got.BaseRefName != "main" || got.BaseRef != "" {
		t.Fatalf("v1 metadata: %+v", got)
	}
}

// A non-repository must not pretend to have metadata.
func TestWorktreeMetadataNonRepo(t *testing.T) {
	dir := t.TempDir()
	if got := ReadWorktreeMetadata(dir); got != nil {
		t.Fatalf("got %+v", got)
	}
	if err := WriteWorktreeMetadata(dir, WorktreeMetadata{BaseRefName: "main"}); err == nil {
		t.Fatal("writing to a non-repository must fail")
	}
}

func TestResolveBaseRef(t *testing.T) {
	cases := map[string]string{
		"main":               "refs/remotes/origin/main",
		"origin/develop":     "refs/remotes/origin/develop",
		"refs/heads/release": "refs/heads/release",
		"":                   "",
	}
	for input, want := range cases {
		if got := resolveBaseRef(input); got != want {
			t.Fatalf("resolveBaseRef(%q) = %q, want %q", input, got, want)
		}
	}
}
