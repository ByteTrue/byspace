package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// reconcileWorkspacePlacement refreshes a workspace record's git facts from what is actually on
// disk, and reports whether anything changed.
//
// Ported from reconcileWorkspacePlacement in workspace-registry-model.ts. Git facts belong to
// the checkout, not to the workspace identity: a user switching branches in a terminal, or a
// script turning a plain directory into a repository, otherwise leaves the record describing a
// state that no longer exists — the sidebar keeps showing the old branch and the diff panel
// keeps querying the wrong base.
func reconcileWorkspacePlacement(ctx context.Context, rec store.WorkspaceRecord) (store.WorkspaceRecord, bool) {
	status := workspace.GetCheckoutStatus(ctx, rec.Cwd, "")

	next := rec
	changed := false

	kind := "directory"
	if status.IsGit {
		kind = "local_checkout"
		if rec.IsBySpaceOwnedWorktree {
			kind = "worktree"
		}
	}
	if next.Kind != kind {
		next.Kind = kind
		changed = true
	}

	var branch *string
	if status.IsGit && status.CurrentBranch != nil && strings.TrimSpace(*status.CurrentBranch) != "" {
		b := strings.TrimSpace(*status.CurrentBranch)
		branch = &b
	}
	if !ptrEqual(next.Branch, branch) {
		next.Branch = branch
		changed = true
	}

	// Adopt the repository root only when the record does not already claim one: a worktree
	// record's root is the worktree itself, and overwriting it would move the checkout.
	if next.WorktreeRoot == nil && status.IsGit && status.RepoRoot != nil && *status.RepoRoot != "" {
		root := *status.RepoRoot
		next.WorktreeRoot = &root
		changed = true
	}

	if changed {
		next.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return next, changed
}

// refreshWorkspacePlacementAtCwd re-reads the git facts for every active workspace on a checkout
// and broadcasts the ones that changed.
//
// Called right after an action the daemon itself performed (switching or renaming a branch), where
// waiting for the five-minute rescan is wrong: the user just watched the branch change, and the
// workspace name is derived from that branch, so the header would keep showing the old one.
func (s *Server) refreshWorkspacePlacementAtCwd(ctx context.Context, cwd string) {
	if strings.TrimSpace(cwd) == "" {
		return
	}
	records, err := s.store.ListWorkspaces()
	if err != nil {
		return
	}
	for _, rec := range records {
		if rec.ArchivedAt != nil || !pathutil.AreEquivalent(rec.Cwd, cwd) {
			continue
		}
		next, changed := reconcileWorkspacePlacement(ctx, rec)
		if !changed {
			continue
		}
		if err := s.store.UpsertWorkspace(next); err != nil {
			continue
		}
		if prj, ok := s.projectForWorkspace(next.ProjectID); ok {
			s.broadcastWorkspaceUpsert(next, prj)
		}
	}
}

func ptrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// reconcileAllWorkspacePlacements refreshes every live workspace and broadcasts the changes.
//
// This is the rescan the node daemon runs on a timer (`DEFAULT_RESCAN_INTERVAL_MS`). Without it
// the only path to updated git facts is a full page reload.
func (s *Server) reconcileAllWorkspacePlacements(ctx context.Context) int {
	records, err := s.store.ListWorkspaces()
	if err != nil {
		return 0
	}
	projects, _ := s.store.ListProjects()
	prjByID := make(map[string]store.ProjectRecord, len(projects))
	for _, prj := range projects {
		prjByID[prj.ProjectID] = prj
	}

	updated := 0
	for _, rec := range records {
		if rec.ArchivedAt != nil || strings.TrimSpace(rec.Cwd) == "" {
			continue
		}
		if _, statErr := os.Stat(rec.Cwd); statErr != nil {
			// The directory is gone (removed outside the app). Keep the record so the user can
			// see the workspace and archive it, but do not invent git facts for it.
			continue
		}
		if filepath.Clean(rec.Cwd) == "" {
			continue
		}
		next, changed := reconcileWorkspacePlacement(ctx, rec)
		if !changed {
			continue
		}
		if err := s.store.UpsertWorkspace(next); err != nil {
			continue
		}
		updated++
		if prj, ok := prjByID[next.ProjectID]; ok {
			s.broadcastWorkspaceUpsert(next, prj)
		}
	}
	return updated
}
