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
