package server

import (
	"context"
	"github.com/ByteTrue/byspace/internal/proc"
	"os"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// archiveWorkspaces archives workspace records and then deletes the BySpace-owned worktree behind
// them once nothing references it any more.
//
// Ported from archiveByScope in the archived Node daemon. Three rules are load-bearing:
//
//   - Whether the directory is deleted is derived from the records on disk every time, never from
//     the client's request. A request-time flag cannot see the sibling workspace the user created
//     on the same checkout ten seconds ago, and deleting the directory takes that workspace's
//     working tree with it.
//   - Only BySpace-owned worktrees are deleted. A checkout the user made by hand is not ours.
//   - The teardown commands run before the delete and a failure keeps the directory. Deleting on a
//     failed teardown removes the evidence needed to fix it.
//
// Returns a message describing why the directory is still on disk, or nil when it is gone (or was
// never ours to remove).
func (s *Server) archiveWorkspaces(ctx context.Context, ids []string, now string) *string {
	archived := make([]store.WorkspaceRecord, 0, len(ids))
	for _, id := range ids {
		rec, ok := s.workspaceRecord(id)
		if !ok {
			continue
		}
		already := rec.ArchivedAt != nil
		if !already {
			s.teardownArchivedWorkspace(id, now)
			if _, err := s.store.ArchiveWorkspace(id, now); err != nil {
				continue
			}
			rec.ArchivedAt = &now
			s.archiveWorkspaceContents(ctx, id, now)
			if prj, ok := s.projectForWorkspace(rec.ProjectID); ok {
				s.broadcastWorkspaceUpsert(rec, prj)
			}
		}
		archived = append(archived, rec)
	}
	if len(archived) == 0 {
		return nil
	}
	return s.removeArchivedWorktree(ctx, archived[0])
}

// adoptWorktreePlacement gives a workspace created on a BySpace worktree directory the worktree
// facts the record would have had if the worktree had been created through the worktree RPC.
//
// Without them a second workspace on the same checkout calls itself an ordinary local checkout:
// the sidebar loses the worktree badge, and archiving either workspace cannot tell that the
// directory is BySpace's to delete once both are gone.
func (s *Server) adoptWorktreePlacement(ctx context.Context, rec *store.WorkspaceRecord) {
	ownership := workspace.ResolveWorktreeOwnership(s.worktreesBaseDir(), rec.Cwd)
	if !ownership.Owned || rec.IsBySpaceOwnedWorktree {
		return
	}
	rec.Kind = "worktree"
	rec.IsBySpaceOwnedWorktree = true
	rec.WorktreeRoot = &ownership.Path
	if repoRoot := workspace.WorktreeMainRepoRoot(ctx, ownership.Path); repoRoot != "" {
		rec.MainRepoRoot = &repoRoot
	}
	_ = s.store.UpsertWorkspace(*rec)
}

// workspaceRecord reads one workspace record, archived or not.
func (s *Server) workspaceRecord(workspaceID string) (store.WorkspaceRecord, bool) {
	list, err := s.store.ListWorkspaces()
	if err != nil {
		return store.WorkspaceRecord{}, false
	}
	for _, rec := range list {
		if rec.WorkspaceID == workspaceID {
			return rec, true
		}
	}
	return store.WorkspaceRecord{}, false
}

// removeArchivedWorktree deletes the BySpace-owned worktree behind an archived workspace when no
// active workspace still uses it.
func (s *Server) removeArchivedWorktree(ctx context.Context, rec store.WorkspaceRecord) *string {
	ownership := workspace.ResolveWorktreeOwnership(s.worktreesBaseDir(), rec.Cwd)
	if !ownership.Owned && !rec.IsBySpaceOwnedWorktree {
		return nil
	}
	path := ownership.Path
	if path == "" {
		if rec.WorktreeRoot != nil && strings.TrimSpace(*rec.WorktreeRoot) != "" {
			path = *rec.WorktreeRoot
		} else {
			path = rec.Cwd
		}
	}

	// A second workspace can be created on the same checkout (Model B). Deleting the directory
	// while one of them is still open destroys a working tree nothing archived.
	remaining, err := s.store.ListWorkspaces()
	if err != nil {
		message := "cannot read workspaces: " + err.Error()
		return &message
	}
	if worktreeStillReferenced(remaining, path) {
		return nil
	}

	if message := s.runWorktreeTeardownCommands(ctx, path); message != nil {
		return message
	}

	repoRoot := ""
	if rec.MainRepoRoot != nil {
		repoRoot = strings.TrimSpace(*rec.MainRepoRoot)
	}
	if repoRoot == "" {
		repoRoot = workspace.WorktreeMainRepoRoot(ctx, path)
	}
	if err := workspace.DeleteOwnedWorktree(ctx, repoRoot, path); err != nil {
		message := err.Error()
		return &message
	}
	return nil
}

// worktreeStillReferenced reports whether an active workspace is checked out at path.
//
// The check runs over the records on disk rather than over the caller's intent: the request names
// the workspace it wants archived, and the directory only becomes garbage when nothing else (for
// example a second workspace created on the same checkout) still uses it.
func worktreeStillReferenced(records []store.WorkspaceRecord, path string) bool {
	for _, rec := range records {
		if rec.ArchivedAt != nil {
			continue
		}
		if pathutil.AreEquivalent(rec.Cwd, path) {
			return true
		}
		if rec.WorktreeRoot != nil && pathutil.AreEquivalent(*rec.WorktreeRoot, path) {
			return true
		}
	}
	return false
}

// runWorktreeTeardownCommands runs `worktree.teardown` from the worktree's byspace.json.
//
// The commands belong to the project, so a failure is reported rather than swallowed: the archive
// itself already succeeded, and the client shows the two separately.
func (s *Server) runWorktreeTeardownCommands(ctx context.Context, worktreePath string) *string {
	commands := workspace.ReadTeardownCommands(worktreePath)
	for _, command := range commands {
		if ctx.Err() != nil {
			message := "teardown cancelled"
			return &message
		}
		invocation := workspace.BuildShellInvocation(command)
		cmd := proc.CommandContext(ctx, invocation.Shell, invocation.Args...)
		cmd.Dir = worktreePath
		// SanitizedShellEnv after ExternalProcessEnv: BASH_ENV would make a non-interactive bash
		// source an arbitrary file before the project command runs.
		cmd.Env = workspace.SanitizedShellEnv(home.ExternalProcessEnv(os.Environ(), map[string]string{"CI": "1"}))
		if out, err := cmd.CombinedOutput(); err != nil {
			message := "teardown command failed: " + command
			if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
				message += "\n" + trimmed
			}
			return &message
		}
	}
	return nil
}
