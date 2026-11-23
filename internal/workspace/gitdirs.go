package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ResolveGitDirs reports where a checkout keeps its git metadata: its own administrative
// directory and the shared directory of the repository it belongs to.
//
// The two differ for a linked worktree. Its index and HEAD live under
// .git/worktrees/<name>, while refs, objects and config live in the repository's .git, so a
// watcher of one alone misses half of what changes. Both returned paths are absolute and
// cleaned; for a main worktree they are the same directory.
func ResolveGitDirs(ctx context.Context, cwd string) (worktreeDir string, commonDir string, err error) {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return "", "", fmt.Errorf("workspace: no directory to resolve git metadata for")
	}
	out, err := runGit(ctx, cwd, "rev-parse", "--absolute-git-dir", "--git-common-dir")
	if err != nil {
		return "", "", err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 2 {
		return "", "", fmt.Errorf("workspace: rev-parse returned %q, want both git directories", out)
	}
	worktreeDir = cleanGitDir(cwd, lines[0])
	commonDir = cleanGitDir(cwd, lines[1])
	// On Windows, --absolute-git-dir may expand a short 8.3 path while --git-common-dir stays
	// relative to the caller. Keep one spelling for the same directory or a main worktree would
	// look like two watch roots.
	worktreeInfo, worktreeErr := os.Stat(worktreeDir)
	commonInfo, commonErr := os.Stat(commonDir)
	if worktreeErr == nil && commonErr == nil && os.SameFile(worktreeInfo, commonInfo) {
		worktreeDir = commonDir
	}
	return worktreeDir, commonDir, nil
}

// cleanGitDir resolves a rev-parse path against the checkout. --git-common-dir is relative
// (".git") when the checkout is already in the repository, and absolute when it is a worktree.
// Windows may answer with forward slashes; filepath picks the right separator on the way in.
func cleanGitDir(cwd, value string) string {
	value = strings.TrimSpace(strings.TrimSuffix(value, "\r"))
	if !filepath.IsAbs(value) {
		value = filepath.Join(cwd, value)
	}
	return filepath.Clean(value)
}
