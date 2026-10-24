package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// stubGHRepo builds a repo whose origin is GitHub, with a stub gh on PATH.
func stubGHRepo(t *testing.T, ghBody string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"remote", "add", "origin", "https://github.com/acme/repo.git"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "gh"), []byte("#!/bin/sh\n"+ghBody+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir
}

// Without these guards the merge button is offered whenever the branch has a PR, and the user
// finds out from gh's raw error — or merges in a state the repository did not intend.
func TestCheckMergeReadiness(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{
			"clean and allowed",
			`echo '{"mergeStateStatus":"CLEAN","mergeCommitAllowed":true}'`,
			true,
		},
		{
			"hooks but allowed",
			`echo '{"mergeStateStatus":"HAS_HOOKS","mergeCommitAllowed":true}'`,
			true,
		},
		{
			"blocked",
			`echo '{"mergeStateStatus":"BLOCKED","mergeCommitAllowed":true}'`,
			false,
		},
		{
			"behind",
			`echo '{"mergeStateStatus":"BEHIND","mergeCommitAllowed":true}'`,
			false,
		},
		{
			"in merge queue",
			`echo '{"mergeStateStatus":"CLEAN","isInMergeQueue":true,"mergeCommitAllowed":true}'`,
			false,
		},
		{
			"auto-merge already on",
			`echo '{"mergeStateStatus":"CLEAN","autoMergeRequest":{"enabledAt":"x"},"mergeCommitAllowed":true}'`,
			false,
		},
		{
			"requested method disabled",
			`echo '{"mergeStateStatus":"CLEAN","mergeCommitAllowed":false,"squashMergeAllowed":true}'`,
			false,
		},
		{
			// A forge we cannot query must not be blocked: refusing on missing information stops
			// every merge on every forge we do not support.
			"no facts",
			`exit 1`,
			true,
		},
	}
	for _, tc := range cases {
		repo := stubGHRepo(t, tc.body)
		got := CheckMergeReadiness(t.Context(), repo, "merge")
		if got.Ready != tc.want {
			t.Fatalf("%s: Ready=%v reason=%q", tc.name, got.Ready, got.Reason)
		}
		if !got.Ready && got.Reason == "" {
			t.Fatalf("%s: a refusal must explain itself", tc.name)
		}
	}
}
