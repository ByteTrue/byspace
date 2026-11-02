package workspace

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HeadFingerprint is a cheap reading of where a checkout's HEAD points: the HEAD file and, on a
// branch, the branch's ref. It moves on a branch switch, a commit, a reset, a rebase or a pull, and
// it is read without starting git, so it can be taken for every checkout every few seconds. ""
// means the directory is not in a git repository.
func HeadFingerprint(cwd string) string {
	gitDir, commonDir := findGitDirs(cwd)
	if gitDir == "" {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return ""
	}
	fingerprint := strings.TrimSpace(string(raw))
	ref, symbolic := strings.CutPrefix(fingerprint, "ref: ")
	if !symbolic {
		return fingerprint
	}
	// Branch refs live in the common dir, shared by every worktree of the repository. A ref that
	// is not a loose file is packed: packed-refs changes when it does.
	loose, err := os.ReadFile(filepath.Join(commonDir, filepath.FromSlash(strings.TrimSpace(ref))))
	if err == nil {
		return fingerprint + "|" + strings.TrimSpace(string(loose))
	}
	if info, err := os.Stat(filepath.Join(commonDir, "packed-refs")); err == nil {
		return fmt.Sprintf("%s|packed:%d:%d", fingerprint, info.ModTime().UnixNano(), info.Size())
	}
	return fingerprint
}

// findGitDirs locates the git dir for cwd (the `.git` directory, or for a worktree the directory a
// `.git` file points at) and the common dir that holds the refs.
func findGitDirs(cwd string) (gitDir, commonDir string) {
	dir := filepath.Clean(cwd)
	for {
		dotGit := filepath.Join(dir, ".git")
		info, err := os.Stat(dotGit)
		if err == nil {
			if info.IsDir() {
				gitDir = dotGit
			} else if gitDir = readGitDirFile(dotGit); gitDir == "" {
				return "", ""
			}
			return gitDir, readCommonDir(gitDir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", ""
		}
		dir = parent
	}
}

// readGitDirFile reads a worktree's `.git` file: "gitdir: <path>", relative to the file.
func readGitDirFile(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	target, ok := strings.CutPrefix(strings.TrimSpace(string(raw)), "gitdir:")
	if !ok {
		return ""
	}
	target = strings.TrimSpace(target)
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(path), target)
	}
	return filepath.Clean(target)
}

// readCommonDir is the repository's common dir: a worktree's git dir names it in `commondir`.
func readCommonDir(gitDir string) string {
	raw, err := os.ReadFile(filepath.Join(gitDir, "commondir"))
	if err != nil {
		return gitDir
	}
	common := strings.TrimSpace(string(raw))
	if !filepath.IsAbs(common) {
		common = filepath.Join(gitDir, common)
	}
	return filepath.Clean(common)
}
