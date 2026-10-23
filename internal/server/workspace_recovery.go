package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// Workspace recovery: deciding what can be done for an archived workspace, and doing it.
//
// Ported from workspace-recovery-service.ts. An archived workspace is not simply "unarchived":
// a worktree whose directory was deleted comes back only by recreating the checkout from the
// branch and source repository recorded on the record. The client decides which word to put on
// the button from `action`, and refuses to offer recovery at all for an action it does not know
// (`getSupportedRecovery` accepts only "restore" and "unarchive"), so the action must be one of
// those two or the recovery UI never renders.
const (
	recoveryActionUnarchive = "unarchive"
	recoveryActionRestore   = "restore"
)

// RecoveryUnavailable describes why nothing can be done. The message is shown to the user as-is,
// so it names what is missing rather than what the daemon failed to do.
type recoveryUnavailable struct {
	Reason  string
	Message string
}

func unavailable(reason, message string) *recoveryUnavailable {
	return &recoveryUnavailable{Reason: reason, Message: message}
}

// isDirectory reports whether path exists and is a directory.
func isDirectory(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// resolveWorkspaceRecovery inspects an archived workspace and reports what the user can do.
//
// The order of the checks is the contract: a workspace that is not archived has no recovery to
// offer, and a missing directory means something different for a worktree (recreatable) than for
// a plain checkout (gone for good).
func (s *Server) resolveWorkspaceRecovery(workspaceID string) (map[string]any, *recoveryUnavailable) {
	rec, ok := s.workspaceRecord(workspaceID)
	if !ok {
		return nil, unavailable("workspace_not_found",
			"This workspace is no longer known to the host.")
	}
	if rec.ArchivedAt == nil {
		return nil, unavailable("workspace_not_archived",
			"This workspace is not archived, but it is unavailable from the host.")
	}
	prj, prjOK := s.projectForWorkspace(rec.ProjectID)
	if !prjOK {
		return nil, unavailable("project_not_found",
			"The project for this archived workspace no longer exists.")
	}

	action := recoveryActionRestore
	if isDirectory(rec.Cwd) {
		action = recoveryActionUnarchive
	} else if rec.Kind != "worktree" {
		return nil, unavailable("workspace_directory_missing",
			"The archived workspace directory no longer exists and cannot be recreated.")
	} else {
		if rec.Branch == nil || strings.TrimSpace(*rec.Branch) == "" {
			return nil, unavailable("worktree_branch_missing",
				"The archived worktree has no branch recorded, so it cannot be restored.")
		}
		// COMPAT(worktreeRestoreMissingMainRepoRoot): records written before the main repository
		// root was persisted fall back to the project root, which is correct for every checkout
		// that is not itself the worktree.
		sourceRepoRoot := ""
		if rec.MainRepoRoot != nil {
			sourceRepoRoot = strings.TrimSpace(*rec.MainRepoRoot)
		}
		if sourceRepoRoot == "" {
			sourceRepoRoot = strings.TrimSpace(prj.RootPath)
		}
		if !isDirectory(sourceRepoRoot) {
			return nil, unavailable("project_directory_missing",
				"The source repository needed to restore this worktree no longer exists.")
		}
	}

	return map[string]any{
		"kind":          "recoverable",
		"workspaceId":   rec.WorkspaceID,
		"workspaceName": workspaceDisplayName(rec),
		"action":        action,
		// The wire schema declares `branch` as `string | null`, so a *string must not reach
		// json.Marshal — the client would read an object and drop the whole state.
		"branch": nullableStringValue(rec.Branch),
	}, nil
}

// nullableStringValue renders an optional string for the wire: either the value or an explicit
// null, which is what the protocol's `string | null` fields accept.
func nullableStringValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// workspaceDisplayName matches resolveWorkspaceDisplayName: the user's title wins over the
// derived name.
func workspaceDisplayName(rec store.WorkspaceRecord) string {
	if rec.Title != nil && strings.TrimSpace(*rec.Title) != "" {
		return strings.TrimSpace(*rec.Title)
	}
	return rec.DisplayName
}

// restoreWorkspace brings an archived workspace back, recreating a deleted worktree first.
func (s *Server) restoreWorkspace(ctx context.Context, workspaceID string) error {
	state, refusal := s.resolveWorkspaceRecovery(workspaceID)
	if refusal != nil {
		return fmt.Errorf("%s", refusal.Message)
	}
	rec, ok := s.workspaceRecord(workspaceID)
	if !ok {
		return fmt.Errorf("Workspace not found: %s", workspaceID)
	}
	if state["action"] == recoveryActionRestore {
		if err := s.recreateArchivedWorktree(ctx, rec); err != nil {
			return err
		}
	}
	return s.unarchiveWorkspaceRecord(ctx, rec)
}

// recreateArchivedWorktree rebuilds the checkout for an archived worktree from its branch.
//
// The directory is recreated at the path the record already names: clients hold that cwd in
// their routing state, agents keep it as their working directory, and a worktree restored at a
// new path would look like a different workspace to every one of them.
func (s *Server) recreateArchivedWorktree(ctx context.Context, rec store.WorkspaceRecord) error {
	if rec.Branch == nil || strings.TrimSpace(*rec.Branch) == "" {
		return fmt.Errorf("The archived worktree has no branch recorded, so it cannot be restored.")
	}
	branch := strings.TrimSpace(*rec.Branch)

	sourceRepoRoot := ""
	if rec.MainRepoRoot != nil {
		sourceRepoRoot = strings.TrimSpace(*rec.MainRepoRoot)
	}
	if sourceRepoRoot == "" {
		if prj, ok := s.projectForWorkspace(rec.ProjectID); ok {
			sourceRepoRoot = strings.TrimSpace(prj.RootPath)
		}
	}
	if !isDirectory(sourceRepoRoot) {
		return fmt.Errorf("The source repository needed to restore this worktree no longer exists.")
	}

	// A stale admin entry left behind by an interrupted archive makes `worktree add` refuse the
	// path it just freed. Pruning is best-effort: it fails harmlessly when there is nothing stale.
	_ = workspace.PruneWorktrees(ctx, sourceRepoRoot)

	previousWorktreePath := ""
	if rec.WorktreeRoot != nil {
		previousWorktreePath = strings.TrimSpace(*rec.WorktreeRoot)
	}
	if previousWorktreePath == "" {
		ownership := workspace.ResolveWorktreeOwnership(s.worktreesBaseDir(), rec.Cwd)
		if ownership.Owned {
			previousWorktreePath = ownership.Path
		}
	}
	if previousWorktreePath == "" {
		previousWorktreePath = rec.Cwd
	}

	slug := filepath.Base(previousWorktreePath)
	intent := workspace.WorktreeIntent{Kind: workspace.IntentCheckoutBranch, BranchName: branch}
	targetPath, _, err := workspace.CreateWorktreeFromIntent(ctx, sourceRepoRoot, s.worktreesBaseDir(), intent, slug)
	if err != nil {
		return err
	}
	// The recreated path has to be the one the record names. Anything else means the branch is
	// checked out somewhere the client is not looking, so undo it rather than half-restore.
	if !pathutil.AreEquivalent(targetPath, rec.Cwd) {
		_ = workspace.DeleteOwnedWorktree(ctx, sourceRepoRoot, targetPath)
		return fmt.Errorf("Restored worktree landed at %s instead of %s", targetPath, rec.Cwd)
	}
	return nil
}

// unarchiveWorkspaceRecord clears the archive flag and re-reads the placement from disk.
func (s *Server) unarchiveWorkspaceRecord(ctx context.Context, rec store.WorkspaceRecord) error {
	next, _ := reconcileWorkspacePlacement(ctx, rec)
	next.ArchivedAt = nil
	next.AutoArchivedChangeRequestURL = nil
	next.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	// The recreated worktree is BySpace's again: an archive that removed it also cleared the
	// facts pointing at it, and the reconciliation above cannot recover them from a fresh clone.
	ownership := workspace.ResolveWorktreeOwnership(s.worktreesBaseDir(), next.Cwd)
	if ownership.Owned {
		next.Kind = "worktree"
		next.IsBySpaceOwnedWorktree = true
		next.WorktreeRoot = &ownership.Path
		if next.MainRepoRoot == nil {
			if repoRoot := workspace.WorktreeMainRepoRoot(ctx, ownership.Path); repoRoot != "" {
				next.MainRepoRoot = &repoRoot
			}
		}
	}
	if err := s.store.UpsertWorkspace(next); err != nil {
		return err
	}
	// A project archived alongside its last workspace has to come back too: restoring the
	// workspace alone would put it in an archived project, which the sidebar does not render.
	if prj, ok := s.projectForWorkspace(next.ProjectID); ok {
		if prj.ArchivedAt != nil {
			prj.ArchivedAt = nil
			prj.UpdatedAt = next.UpdatedAt
			_ = s.store.UpsertProject(prj)
		}
		s.broadcastWorkspaceUpsert(next, prj)
	}
	return nil
}
