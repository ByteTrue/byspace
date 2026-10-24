package server

import (
	"context"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// Auto-archive a worktree once its pull request is merged.
//
// Ported from auto-archive-on-merge/archive-if-safe.ts. The feature saves the user from tidying
// up by hand after every merged PR, but it deletes a worktree, so every guard matters:
//
//   - the PR must be merged (not closed, not open)
//   - the working tree must be clean — uncommitted work is not in the PR and would be lost
//   - nothing may be unpushed — an amended commit after the PR was opened is also not in it
//   - the worktree must be BySpace-owned, or we would delete a checkout the user created
//   - it must not already be archived, so a repeated poll does not churn

// autoArchiveState is what a snapshot needs to decide.
type autoArchiveState struct {
	PullRequestMerged bool
	PullRequestURL    string
	IsDirty           bool
	AheadOfOrigin     int
}

// autoArchiveAfterMerge checks one workspace and archives it when safe.
//
// Returns true when it archived, so the caller can report it.
func (s *Server) autoArchiveAfterMerge(ctx context.Context, rec store.WorkspaceRecord) bool {
	if rec.ArchivedAt != nil || !rec.IsBySpaceOwnedWorktree {
		return false
	}
	if !s.autoArchiveEnabled() {
		return false
	}

	state := s.autoArchiveStateFor(ctx, rec)
	if !shouldAutoArchive(state) {
		return false
	}
	// A workspace the user already archived by hand must not be re-archived, and the recorded
	// URL is what stops the poll from repeating the work on every tick.
	if rec.AutoArchivedChangeRequestURL != nil && *rec.AutoArchivedChangeRequestURL == state.PullRequestURL {
		return false
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	rec.AutoArchivedChangeRequestURL = &state.PullRequestURL
	rec.ArchivedAt = &now
	rec.UpdatedAt = now
	if err := s.store.UpsertWorkspace(rec); err != nil {
		return false
	}
	// Free the agents and terminals the workspace was holding: an archived worktree with a live
	// provider keeps spending tokens.
	s.archiveWorkspaceContents(ctx, rec.WorkspaceID, now)
	if projects, listErr := s.store.ListProjects(); listErr == nil {
		for _, prj := range projects {
			if prj.ProjectID == rec.ProjectID {
				s.broadcastWorkspaceUpsert(rec, prj)
				break
			}
		}
	}
	return true
}

// shouldAutoArchive applies the safety guards to a snapshot.
//
// Separated from the IO so the rules are testable without a git repository or a forge.
func shouldAutoArchive(state autoArchiveState) bool {
	if !state.PullRequestMerged {
		return false
	}
	if state.IsDirty {
		// Uncommitted work is not in the PR; archiving would delete it.
		return false
	}
	// Any positive count means commits made after the PR was opened are not in it. A negative
	// count means the check itself failed, and an unverifiable state must not delete a worktree.
	if state.AheadOfOrigin != 0 {
		return false
	}
	return true
}

// autoArchiveEnabled reads `daemon.autoArchiveAfterMerge`.
func (s *Server) autoArchiveEnabled() bool {
	cfg := s.store.LoadDaemonConfig()
	if cfg == nil {
		return false
	}
	value, ok := cfg["autoArchiveAfterMerge"].(bool)
	return ok && value
}

// autoArchiveStateFor reads the git and forge facts the decision needs.
func (s *Server) autoArchiveStateFor(ctx context.Context, rec store.WorkspaceRecord) autoArchiveState {
	state := autoArchiveState{}

	status := workspace.GetCheckoutStatus(ctx, rec.Cwd, "")
	if status.IsDirty != nil {
		state.IsDirty = *status.IsDirty
	} else {
		// Unknown cleanliness must block: archiving on an unverifiable state risks deleting
		// work that is not in the PR.
		state.IsDirty = true
	}
	state.AheadOfOrigin = aheadOfOrigin(ctx, rec.Cwd)

	pr, prErr := workspace.GetPRStatus(ctx, rec.Cwd)
	if prErr != nil || pr == nil {
		return state
	}
	if merged, ok := pr["isMerged"].(bool); ok {
		state.PullRequestMerged = merged
	}
	if url, ok := pr["url"].(string); ok {
		state.PullRequestURL = strings.TrimSpace(url)
	}
	// A merged PR is only actionable together with its URL: the URL is the idempotency key.
	if state.PullRequestURL == "" {
		state.PullRequestMerged = false
	}
	return state
}

// aheadOfOrigin reports how many local commits are not pushed.
//
// A failure returns -1 so the caller treats it as "unknown" and refuses: archiving on an
// unverifiable state risks deleting unpushed commits.
func aheadOfOrigin(ctx context.Context, cwd string) int {
	count, err := workspace.CountAheadOfOrigin(ctx, cwd)
	if err != nil {
		return -1
	}
	return count
}

// runAutoArchivePass checks every live BySpace worktree once.
func (s *Server) runAutoArchivePass(ctx context.Context) int {
	records, err := s.store.ListWorkspaces()
	if err != nil {
		return 0
	}
	archived := 0
	for _, rec := range records {
		if ctx.Err() != nil {
			break
		}
		if s.autoArchiveAfterMerge(ctx, rec) {
			archived++
		}
	}
	return archived
}
