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
		IsBySpaceOwnedWorktree: strings.Contains(absCwd, ".byspace/worktrees"),
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
