package store

import (
	"os"
	"path/filepath"
	"strings"
)

// BackfillWorkspaceOwnership stamps a workspace id onto agent records that predate the field.
//
// Ported from migrations/backfill-workspace-id. Every other code path treats a record's
// WorkspaceID as authoritative, so a legacy record with no owner is invisible: it appears in no
// workspace, and History cannot restore it. This runs once at startup and writes the id back, so
// nothing downstream needs a fallback.
//
// Resolution rules, in order:
//
//   - an exact cwd match wins, oldest workspace first
//   - otherwise the deepest enclosing workspace directory
//   - the home directory never owns its descendants, or every stray agent would land there
//   - a live record only resolves to a live workspace; an archived record may resolve to an
//     archived one so History keeps its ownership
func (s *Store) BackfillWorkspaceOwnership() int {
	// The exported accessors take the lock themselves; holding it here would deadlock.
	agents, err := s.ListAgents()
	if err != nil || len(agents) == 0 {
		return 0
	}
	workspaces, err := s.ListWorkspaces()
	if err != nil || len(workspaces) == 0 {
		return 0
	}

	updated := 0
	for i := range agents {
		if strings.TrimSpace(agents[i].WorkspaceID) != "" {
			continue
		}
		owner := resolveLegacyWorkspaceOwner(agents[i].Cwd, workspaces, agents[i].ArchivedAt != nil)
		if owner == "" {
			continue
		}
		agents[i].WorkspaceID = owner
		_ = s.UpsertAgent(agents[i])
		updated++
	}
	return updated
}

// resolveLegacyWorkspaceOwner picks the workspace that owned a legacy agent's directory.
func resolveLegacyWorkspaceOwner(cwd string, workspaces []WorkspaceRecord, includeArchived bool) string {
	cleaned := filepath.Clean(cwd)
	if cleaned == "" || cleaned == "." {
		return ""
	}

	var deepest WorkspaceRecord
	haveDeepest := false

	for _, workspace := range workspaces {
		if !includeArchived && workspace.ArchivedAt != nil {
			continue
		}
		workspacePath := filepath.Clean(workspace.Cwd)
		if workspacePath == "" || workspacePath == "." {
			continue
		}

		// Exact match: oldest wins, so a duplicate workspace row does not take ownership just
		// because it is later in the file.
		if workspacePath == cleaned {
			if !haveDeepest || workspace.CreatedAt < deepest.CreatedAt {
				deepest = workspace
				haveDeepest = true
			}
			continue
		}

		// Enclosing directory. A prefix match without a separator would let /repo/app match
		// /repo/application.
		if strings.HasPrefix(cleaned, workspacePath+string(filepath.Separator)) {
			if !haveDeepest || len(workspacePath) > len(filepath.Clean(deepest.Cwd)) {
				deepest = workspace
				haveDeepest = true
			}
		}
	}

	if !haveDeepest {
		return ""
	}
	// The home directory never owns its descendants: every unrelated agent lives somewhere under
	// it, so attributing them all to one workspace is worse than leaving them unowned.
	if isHomeDirectory(filepath.Clean(deepest.Cwd)) {
		return ""
	}
	return deepest.WorkspaceID
}

// isHomeDirectory reports whether a path is the user's home directory itself.
func isHomeDirectory(path string) bool {
	home, err := userHomeDir()
	if err != nil || home == "" {
		return false
	}
	return filepath.Clean(home) == path
}

// userHomeDir is a seam so the test does not depend on the machine's home directory.
var userHomeDir = func() (string, error) { return os.UserHomeDir() }
