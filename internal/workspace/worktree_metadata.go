package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

// Worktree metadata, ported from utils/worktree-metadata.ts.
//
// A BySpace-owned worktree records what it was cut from, inside the worktree itself
// (`.git/byspace/worktree.json`). Keeping it with the worktree rather than in the registry means
// it survives the registry being lost, copied, or rebuilt — and it is how the daemon knows which
// base to diff against without asking the forge on every request.

// ChangeRequestLookupTarget lets a worktree find its change request again after the branch is
// renamed or the remote changes.
type ChangeRequestLookupTarget struct {
	HeadRef             string `json:"headRef"`
	HeadRepositoryOwner string `json:"headRepositoryOwner,omitempty"`
	ChangeRequestNumber int    `json:"changeRequestNumber,omitempty"`
	LocalBranchName     string `json:"localBranchName,omitempty"`
}

// WorktreeMetadata is the on-disk shape.
//
// baseRefName is the display name; baseRef is the exact ref the worktree was cut from
// ("refs/remotes/upstream/main"). Neither is required for the file to be readable: BaseRef is
// optional because the reader can fall back to the name, and refusing to read a partially
// written file would lose the base entirely.
type WorktreeMetadata struct {
	Version                   int                        `json:"version"`
	BaseRefName               string                     `json:"baseRefName"`
	BaseRef                   string                     `json:"baseRef,omitempty"`
	ChangeRequestLookupTarget *ChangeRequestLookupTarget `json:"changeRequestLookupTarget,omitempty"`
	// FirstAgentBranchAutoName records the pending auto-rename of a generated branch, so a
	// restart mid-flow can finish it instead of leaving the placeholder name forever.
	FirstAgentBranchAutoName *BranchAutoName `json:"firstAgentBranchAutoName,omitempty"`
}

// BranchAutoName is the pending branch rename state.
type BranchAutoName struct {
	Status                string `json:"status"` // "pending" | "applied"
	PlaceholderBranchName string `json:"placeholderBranchName,omitempty"`
	BranchName            string `json:"branchName,omitempty"`
}

// WorktreeMetadataPath is where the metadata lives for a worktree.
//
// It goes under the git directory, not the working tree: a file in the working tree would show up
// in `git status` and in every diff.
func WorktreeMetadataPath(worktreePath string) string {
	gitDir, err := runGit(context.Background(), worktreePath, "rev-parse", "--absolute-git-dir")
	if err != nil || strings.TrimSpace(gitDir) == "" {
		return ""
	}
	return filepath.Join(strings.TrimSpace(gitDir), "byspace", "worktree.json")
}

// WriteWorktreeMetadata stores the metadata for a worktree.
func WriteWorktreeMetadata(worktreePath string, meta WorktreeMetadata) error {
	path := WorktreeMetadataPath(worktreePath)
	if path == "" {
		return fmt.Errorf("not a git worktree: %s", worktreePath)
	}
	if meta.Version == 0 {
		meta.Version = 2
	}
	raw, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(path, append(raw, '\n'), 0o600)
}

// ReadWorktreeMetadata loads the metadata, returning nil when there is none.
//
// A malformed file reads as "no metadata" rather than an error: the worktree is still usable, and
// failing every status request because a small side file is corrupt is worse than losing the
// base-ref hint.
func ReadWorktreeMetadata(worktreePath string) *WorktreeMetadata {
	path := WorktreeMetadataPath(worktreePath)
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var meta WorktreeMetadata
	if json.Unmarshal(raw, &meta) != nil {
		return nil
	}
	if meta.Version != 1 && meta.Version != 2 {
		return nil
	}
	if strings.TrimSpace(meta.BaseRefName) == "" {
		return nil
	}
	return &meta
}
