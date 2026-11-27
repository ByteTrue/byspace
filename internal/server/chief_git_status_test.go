package server

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/proc"
)

func TestParsePorcelainFilesNUL(t *testing.T) {
	input := " M dir with spaces/file name.txt\x00?? \"quoted name.txt\"\x00 D line\nbreak.txt\x00R  new name.txt\x00old name.txt\x00C  copied name.txt\x00copy source.txt\x00??  leading.txt\x00?? trailing \x00"
	want := []string{
		"dir with spaces/file name.txt",
		"\"quoted name.txt\"",
		"line\nbreak.txt",
		"new name.txt",
		"copied name.txt",
		" leading.txt",
		"trailing ",
	}
	if got := parsePorcelainFiles(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("parsePorcelainFiles() = %#v, want %#v", got, want)
	}
}

func TestChiefGitStatusNULRealRepository(t *testing.T) {
	repo := t.TempDir()
	initTestGitRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "old name.txt"), []byte("rename\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runChiefGitStatusCommand(t, repo, "add", "--", "old name.txt")
	runChiefGitStatusCommand(t, repo, "commit", "-m", "add rename source")
	if err := os.Rename(filepath.Join(repo, "old name.txt"), filepath.Join(repo, "new name.txt")); err != nil {
		t.Fatal(err)
	}
	runChiefGitStatusCommand(t, repo, "add", "-A", "--", "old name.txt", "new name.txt")
	if err := os.WriteFile(filepath.Join(repo, "untracked  file.txt"), []byte("untracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	blob := strings.TrimSpace(runChiefGitStatusCommand(t, repo, "rev-parse", "HEAD:README.md"))
	treeInput := runChiefGitStatusCommand(t, repo, "ls-tree", "-z", "HEAD")
	treeInput += "100644 blob " + blob + "\tquote\"name.txt\x00"
	treeInput += "100644 blob " + blob + "\tline\nbreak.txt\x00"
	tree := strings.TrimSpace(runChiefGitStatusInput(t, repo, treeInput, "mktree", "-z"))
	commit := strings.TrimSpace(runChiefGitStatusCommand(t, repo, "commit-tree", tree, "-p", "HEAD", "-m", "special paths"))
	runChiefGitStatusCommand(t, repo, "update-ref", "HEAD", commit)

	snapshot := snapshotGitCheckout(context.Background(), repo)
	if snapshot == nil {
		t.Fatal("snapshotGitCheckout returned nil")
	}
	if !strings.Contains(snapshot.status, "\x00") {
		t.Fatalf("git status was not NUL-delimited: %q", snapshot.status)
	}
	want := []string{"line\nbreak.txt", "new name.txt", "quote\"name.txt", "untracked  file.txt"}
	fromSnapshot := parsePorcelainFiles(snapshot.status)
	sort.Strings(fromSnapshot)
	if !reflect.DeepEqual(fromSnapshot, want) {
		t.Fatalf("snapshot files = %#v, want %#v; status = %q", fromSnapshot, want, snapshot.status)
	}

	srv := newTestServer(t, t.TempDir())
	if got := srv.chief.collectGitChangedFiles(context.Background(), repo, nil); !reflect.DeepEqual(got, want) {
		t.Fatalf("collectGitChangedFiles() = %#v, want %#v", got, want)
	}
}

func TestChiefGitStatusNULUnstagedFirstRealRepository(t *testing.T) {
	repo := t.TempDir()
	initTestGitRepo(t, repo)
	path := filepath.Join(repo, "shared.txt")
	if err := os.WriteFile(path, []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runChiefGitStatusCommand(t, repo, "add", "--", "shared.txt")
	runChiefGitStatusCommand(t, repo, "commit", "-m", "add shared file")
	if err := os.WriteFile(path, []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := newTestServer(t, t.TempDir())
	want := []string{"shared.txt"}
	if got := srv.chief.collectGitChangedFiles(context.Background(), repo, nil); !reflect.DeepEqual(got, want) {
		t.Fatalf("collectGitChangedFiles() = %#v, want %#v", got, want)
	}
	snapshot := snapshotGitCheckout(context.Background(), repo)
	if snapshot == nil {
		t.Fatal("snapshotGitCheckout returned nil")
	}
	if snapshot.status != " M shared.txt\x00" {
		t.Fatalf("snapshot status = %q, want %q", snapshot.status, " M shared.txt\x00")
	}
}

func runChiefGitStatusCommand(t *testing.T, dir string, args ...string) string {
	t.Helper()
	return runChiefGitStatusInput(t, dir, "", args...)
}

func runChiefGitStatusInput(t *testing.T, dir, input string, args ...string) string {
	t.Helper()
	cmd := proc.CommandContext(context.Background(), "git", args...)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(input)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %q failed: %v\n%s", args, err, out)
	}
	return string(out)
}
