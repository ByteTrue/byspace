package workspace

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
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
	Type    string `json:"type"` // "context" | "add" | "del"
	Content string `json:"content"`
	OldLine *int   `json:"oldLine,omitempty"`
	NewLine *int   `json:"newLine,omitempty"`
}

type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Header   string     `json:"header"`
	Lines    []DiffLine `json:"lines"`
}

type ParsedDiffFile struct {
	Path      string     `json:"path"`
	OldPath   string     `json:"oldPath,omitempty"`
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

// GetWorkingDiff computes modified files and line counts against HEAD.
func GetWorkingDiff(ctx context.Context, cwd string) ([]ParsedDiffFile, error) {
	out, err := runGit(ctx, cwd, "diff", "--numstat", "HEAD")
	if err != nil {
		return []ParsedDiffFile{}, nil
	}
	if out == "" {
		return []ParsedDiffFile{}, nil
	}
	lines := strings.Split(out, "\n")
	files := make([]ParsedDiffFile, 0, len(lines))
	for _, line := range lines {
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		adds, _ := strconv.Atoi(parts[0])
		dels, _ := strconv.Atoi(parts[1])
		files = append(files, ParsedDiffFile{
			Path:      parts[2],
			Additions: adds,
			Deletions: dels,
			Hunks:     []DiffHunk{},
			Status:    "ok",
		})
	}
	return files, nil
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
	if create {
		_, err := runGit(ctx, cwd, "checkout", "-b", branch)
		return err
	}
	_, err := runGit(ctx, cwd, "checkout", branch)
	return err
}

// RenameBranch renames the current branch to newName.
func RenameBranch(ctx context.Context, cwd, newName string) (string, error) {
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
