package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ByteTrue/byspace/internal/projecticon"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/dirstream"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func expandUserPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "~" || strings.HasPrefix(trimmed, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			if trimmed == "~" {
				return h
			}
			return filepath.Join(h, trimmed[2:])
		}
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		return abs
	}
	return trimmed
}

func (s *Server) handleProjectAdd(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	cwd := expandUserPath(req.Cwd)
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		_ = sendSessionMsg(ctx, sink, "project.add.response", map[string]any{
			"requestId": req.RequestID,
			"project":   nil,
			"error":     "Directory not found: " + cwd,
			"errorCode": "directory_not_found",
		})
		return
	}
	// Add project creates a project, not a workspace (Node: findOrCreateProjectForDirectory).
	prj, err := s.store.FindOrCreateProjectForDirectory(cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "project.add.response", map[string]any{
			"requestId": req.RequestID,
			"project":   nil,
			"error":     err.Error(),
			"errorCode": nil,
		})
		return
	}
	desc := buildProjectDescriptor(prj)
	_ = sendSessionMsg(ctx, sink, "project.add.response", map[string]any{
		"requestId": req.RequestID,
		"project":   desc,
		"error":     nil,
		"errorCode": nil,
	})
	s.broadcastSessionMsg("project.update", map[string]any{
		"kind":    "upsert",
		"project": desc,
	})
}

func (s *Server) handleProjectCreateDirectory(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		// The protocol calls this `parentPath` (ProjectCreateDirectoryRequestMessageSchema);
		// `parentDirectory` is accepted for older clients that predate the rename.
		ParentPath      string `json:"parentPath"`
		ParentDirectory string `json:"parentDirectory"`
		Name            string `json:"name"`
	}
	_ = json.Unmarshal(raw, &req)
	parentPath := strings.TrimSpace(req.ParentPath)
	if parentPath == "" {
		parentPath = req.ParentDirectory
	}
	// Validate the name by the node rules before touching the filesystem: an absolute path, a
	// drive letter or `..` would otherwise create a directory outside the chosen parent.
	if err := ValidateProjectDirectoryName(req.Name); err != nil {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         err.Error(),
			"errorCode":     "invalid_name",
		})
		return
	}
	name := req.Name
	parent := expandUserPath(parentPath)
	// The parent must already exist: `MkdirAll` would silently create a whole tree for a typo.
	if info, statErr := os.Stat(parent); statErr != nil || !info.IsDir() {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         "Parent directory does not exist",
			"errorCode":     "parent_directory_not_found",
		})
		return
	}
	target := filepath.Join(parent, name)
	if _, err := os.Stat(target); err == nil {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         "Directory already exists",
			"errorCode":     "directory_exists",
		})
		return
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		code := "filesystem_error"
		if os.IsPermission(err) {
			code = "permission_denied"
		}
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         err.Error(),
			"errorCode":     code,
		})
		return
	}
	// Creating the directory registers a project; the workspace appears when the user opens it.
	prj, err := s.store.FindOrCreateProjectForDirectory(target)
	if err != nil {
		// Roll back: leaving an empty directory behind after a failed registration is a mess
		// the user has to clean up, and the response says the operation failed.
		rollbackErr := os.Remove(target)
		msg := fmt.Sprintf("Failed to register project: %v", err)
		if rollbackErr != nil {
			msg += fmt.Sprintf(" (and could not remove %s: %v)", target, rollbackErr)
		}
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": target,
			"project":       nil,
			"error":         msg,
			"errorCode":     "registration_failed",
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
		"requestId":     req.RequestID,
		"directoryPath": target,
		"project":       buildProjectDescriptor(prj),
		"error":         nil,
		"errorCode":     nil,
	})
}

func (s *Server) handleProjectRename(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string  `json:"requestId"`
		ProjectID  string  `json:"projectId"`
		CustomName *string `json:"customName"`
	}
	_ = json.Unmarshal(raw, &req)
	projects, _ := s.store.ListProjects()
	for _, p := range projects {
		if p.ProjectID == req.ProjectID {
			var next *string
			if req.CustomName != nil && strings.TrimSpace(*req.CustomName) != "" {
				trimmed := strings.TrimSpace(*req.CustomName)
				next = &trimmed
			}
			p.CustomName = next
			p.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = s.store.UpsertProject(p)
			// The response only answers the caller. Without the broadcast the sidebar keeps the old name until a
			// full refetch, so renaming a project looked like it did nothing.
			renamed := buildProjectDescriptor(p)
			s.broadcastSessionMsg("project.update", map[string]any{
				"kind":    "upsert",
				"project": renamed,
			})
			_ = sendSessionMsg(ctx, sink, "project.rename.response", map[string]any{
				"requestId":  req.RequestID,
				"projectId":  req.ProjectID,
				"accepted":   true,
				"customName": next,
				"error":      nil,
			})
			return
		}
	}
	_ = sendSessionMsg(ctx, sink, "project.rename.response", map[string]any{
		"requestId":  req.RequestID,
		"projectId":  req.ProjectID,
		"accepted":   false,
		"customName": nil,
		"error":      "Project not found",
	})
}

func (s *Server) handleProjectRemove(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		ProjectID string `json:"projectId"`
	}
	_ = json.Unmarshal(raw, &req)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	projects, _ := s.store.ListProjects()
	var found bool
	for _, p := range projects {
		if p.ProjectID == req.ProjectID {
			p.ArchivedAt = &now
			p.UpdatedAt = now
			_ = s.store.UpsertProject(p)
			found = true
			break
		}
	}
	workspaces, _ := s.store.ListWorkspaces()
	removedWS := make([]string, 0)
	for _, w := range workspaces {
		if w.ProjectID == req.ProjectID && w.ArchivedAt == nil {
			s.teardownArchivedWorkspace(w.WorkspaceID, now)
			_, _ = s.store.ArchiveWorkspace(w.WorkspaceID, now)
			removedWS = append(removedWS, w.WorkspaceID)
		}
	}
	// The response alone is not enough: a removal the client is not told about leaves the sidebar showing a project the
	// daemon has archived, which reads as the click doing nothing.
	for _, wsID := range removedWS {
		s.broadcastSessionMsg("workspace_update", map[string]any{
			"kind":             "remove",
			"id":               wsID,
			"projectId":        req.ProjectID,
			"removedProjectId": req.ProjectID,
		})
	}
	if len(removedWS) == 0 {
		s.broadcastProjectRemoved(req.ProjectID, nil)
	}

	_ = sendSessionMsg(ctx, sink, "project.remove.response", map[string]any{
		"requestId":           req.RequestID,
		"projectId":           req.ProjectID,
		"accepted":            found,
		"removedWorkspaceIds": removedWS,
		"error":               nil,
	})
}

func (s *Server) handleProjectIcon(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	switch msgType {
	case "project.icon.set.request":
		var req struct {
			RequestID string         `json:"requestId"`
			ProjectID string         `json:"projectId"`
			Source    map[string]any `json:"source"`
		}
		_ = json.Unmarshal(raw, &req)
		srcType, _ := req.Source["type"].(string)
		if srcType == "upload" {
			dataStr, _ := req.Source["data"].(string)
			_ = s.store.SaveProjectIcon(req.ProjectID, map[string]any{
				"data":     dataStr,
				"mimeType": "image/png",
			})
		} else {
			_ = s.store.SaveProjectIcon(req.ProjectID, nil)
		}
		// The icon shows in the sidebar and the project header; without the broadcast it changes only after a
		// reload, which reads as the upload having failed.
		if projects, listErr := s.store.ListProjects(); listErr == nil {
			for _, project := range projects {
				if project.ProjectID == req.ProjectID {
					s.broadcastSessionMsg("project.update", map[string]any{
						"kind":    "upsert",
						"project": buildProjectDescriptor(project),
					})
					break
				}
			}
		}
		_ = sendSessionMsg(ctx, sink, "project.icon.set.response", map[string]any{
			"requestId": req.RequestID,
			"projectId": req.ProjectID,
			"accepted":  true,
			"error":     nil,
		})
	case "project.icon.get.request":
		var req struct {
			RequestID string `json:"requestId"`
			ProjectID string `json:"projectId"`
		}
		_ = json.Unmarshal(raw, &req)
		icon := s.store.LoadProjectIcon(req.ProjectID)
		_ = sendSessionMsg(ctx, sink, "project.icon.get.response", map[string]any{
			"requestId": req.RequestID,
			"projectId": req.ProjectID,
			"icon":      icon,
			"error":     nil,
		})
	case "project_icon_request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
		}
		_ = json.Unmarshal(raw, &req)
		var icon map[string]any
		projects, _ := s.store.ListProjects()
		for _, p := range projects {
			if p.RootPath == req.Cwd {
				icon = s.store.LoadProjectIcon(p.ProjectID)
				break
			}
		}
		// No custom icon: use the one the project already ships. A repository with
		// `public/favicon.svg` should not show a placeholder until the user uploads something.
		if icon == nil {
			icon = detectShippedIcon(req.Cwd)
		}
		_ = sendSessionMsg(ctx, sink, "project_icon_response", map[string]any{
			"requestId": req.RequestID,
			"cwd":       req.Cwd,
			"icon":      icon,
			"error":     nil,
		})
	}
}

func (s *Server) handleOpenProject(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	cwd := expandUserPath(req.Cwd)
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		_ = sendSessionMsg(ctx, sink, "open_project_response", map[string]any{
			"requestId": req.RequestID,
			"workspace": nil,
			"error":     "Directory not found",
			"errorCode": "directory_not_found",
		})
		return
	}
	prj, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "open_project_response", map[string]any{
			"requestId": req.RequestID,
			"workspace": nil,
			"error":     err.Error(),
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "open_project_response", map[string]any{
		"requestId": req.RequestID,
		"workspace": s.workspaceDescriptor(ws, prj),
		"error":     nil,
	})
}

// handleDirectorySuggestions ports DirectorySuggestionsRequest handling from
// archive/packages/server/src/server/session.ts:4260. Everything that decides *what* to show
// lives in internal/dirstream, which is a translation of utils/directory-suggestions.ts.
func (s *Server) handleDirectorySuggestions(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID    string `json:"requestId"`
		Query        string `json:"query"`
		Cwd          string `json:"cwd"`
		Limit        int    `json:"limit"`
		IncludeFiles *bool  `json:"includeFiles"`
		IncludeDirs  *bool  `json:"includeDirectories"`
		MatchMode    string `json:"matchMode"`
	}
	_ = json.Unmarshal(raw, &req)

	// With a cwd the search is workspace-scoped: relative paths, slash means path query, an
	// empty query lists children, hidden dot-directories stay traversable, gitignore applies.
	// Without one it browses the home directory in absolute form and only ranks shallowly.
	workspaceCwd := strings.TrimSpace(req.Cwd)
	searchesWorkspace := workspaceCwd != ""

	opts := dirstream.Options{
		Query: req.Query,
		Limit: req.Limit,
	}
	opts.IncludeDirectories = req.IncludeDirs == nil || *req.IncludeDirs
	opts.IncludeFiles = req.IncludeFiles != nil && *req.IncludeFiles
	switch strings.ToLower(strings.TrimSpace(req.MatchMode)) {
	case "suffix":
		opts.MatchMode = dirstream.ModeSuffix
	case "fuzzy":
		opts.MatchMode = dirstream.ModeFuzzy
	}

	if searchesWorkspace {
		opts.Root = expandUserPath(workspaceCwd)
		opts.PathFormat = dirstream.FormatRelative
		opts.PathQueryPolicy = dirstream.PolicySlashes
		opts.BlankQueryBehavior = dirstream.BlankChildren
		opts.TraversableHiddenDirectoryNames = dirstream.WorkspaceSearchHiddenDirectories
		opts.RespectGitIgnore = true
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "directory_suggestions_response", map[string]any{
				"requestId":   req.RequestID,
				"directories": []string{},
				"entries":     []any{},
				"error":       err.Error(),
			})
			return
		}
		opts.Root = home
		opts.PathFormat = dirstream.FormatAbsolute
		opts.PathQueryPolicy = dirstream.PolicyRooted
		opts.BlankQueryBehavior = dirstream.BlankNone
		opts.RootAliases = []string{"~"}
		opts.ConfidentResultScanThreshold = 5000
	}

	entries := dirstream.Search(opts)
	dirs := make([]string, 0, len(entries))
	rows := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if entry.Kind == dirstream.KindDirectory {
			dirs = append(dirs, entry.Path)
		}
		rows = append(rows, map[string]any{"path": entry.Path, "kind": string(entry.Kind)})
	}

	_ = sendSessionMsg(ctx, sink, "directory_suggestions_response", map[string]any{
		"requestId":   req.RequestID,
		"directories": dirs,
		"entries":     rows,
		"error":       nil,
	})
}

func (s *Server) handleArchiveWorkspace(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if msgType == "byspace_worktree_archive_request" {
		var req struct {
			RequestID              string `json:"requestId"`
			WorktreePath           string `json:"worktreePath"`
			Scope                  string `json:"scope"`
			DeleteWorktreeFromDisk bool   `json:"deleteWorktreeFromDisk"`
			// RepoRoot and BranchName disambiguate when the caller identifies a worktree by its
			// branch rather than a path — the sidebar knows the branch, and the path may have
			// moved. Without them a stale path archives nothing and the response still says ok.
			RepoRoot   string `json:"repoRoot"`
			BranchName string `json:"branchName"`
			// WorkspaceID names one record exactly. A directory can back several workspaces, so
			// resolving by cwd alone picks an arbitrary one of them.
			WorkspaceID string `json:"workspaceId"`
		}
		_ = json.Unmarshal(raw, &req)

		// The scope decides what the caller is archiving, and the directory delete is derived from
		// the records rather than from the request: a client cannot see the sibling workspace on
		// the same checkout. Node's worktree RPC used to ignore scope entirely, so "worktree"
		// behaves as "every active workspace on this directory" and "workspace" as one record.
		targets := s.worktreeArchiveTargets(req.WorktreePath, req.RepoRoot, req.BranchName, req.WorkspaceID, req.Scope)
		directoryError := s.archiveWorkspaces(ctx, targets, now)
		_ = sendSessionMsg(ctx, sink, "byspace_worktree_archive_response", map[string]any{
			"requestId":     req.RequestID,
			"success":       true,
			"removedAgents": []string{},
			"error":         nil,
		})
		// The client reports a directory that survived separately from a hard error, the same
		// way archive_workspace_response carries directoryError. The worktree response schema has
		// no field for it yet, so the fact goes to the daemon log rather than being dropped.
		if directoryError != nil {
			fmt.Fprintf(os.Stderr, "byspace_worktree_archive: worktree left on disk: %s\n", *directoryError)
		}
		return
	}

	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)
	// Archiving one workspace removes its worktree only when nothing else references it, which is
	// what keeps a sibling workspace on the same checkout alive.
	directoryError := s.archiveWorkspaces(ctx, []string{req.WorkspaceID}, now)
	_, found := s.workspaceRecord(req.WorkspaceID)
	if !found {
		_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
			"requestId":      req.RequestID,
			"workspaceId":    req.WorkspaceID,
			"archivedAt":     nil,
			"directoryError": nil,
			"error":          "Workspace not found: " + req.WorkspaceID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
		"requestId":      req.RequestID,
		"workspaceId":    req.WorkspaceID,
		"archivedAt":     now,
		"directoryError": directoryError,
		"error":          nil,
	})
}

func (s *Server) handleWorkspaceTitleSet(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string  `json:"requestId"`
		WorkspaceID string  `json:"workspaceId"`
		Title       *string `json:"title"`
	}
	_ = json.Unmarshal(raw, &req)
	workspaces, _ := s.store.ListWorkspaces()
	for _, w := range workspaces {
		if w.WorkspaceID == req.WorkspaceID {
			var next *string
			if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
				t := strings.TrimSpace(*req.Title)
				next = &t
			}
			w.Title = next
			w.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = s.store.UpsertWorkspace(w)
			if prj, ok := s.projectForWorkspace(w.ProjectID); ok {
				s.broadcastWorkspaceUpsert(w, prj)
			}
			_ = sendSessionMsg(ctx, sink, "workspace.title.set.response", map[string]any{
				"requestId":   req.RequestID,
				"workspaceId": req.WorkspaceID,
				"accepted":    true,
				"title":       next,
				"error":       nil,
			})
			return
		}
	}
	_ = sendSessionMsg(ctx, sink, "workspace.title.set.response", map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"accepted":    false,
		"title":       nil,
		"error":       "Workspace not found",
	})
}

func (s *Server) handleWorkspacePinSet(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
		Pinned      bool   `json:"pinned"`
	}
	_ = json.Unmarshal(raw, &req)
	workspaces, _ := s.store.ListWorkspaces()
	for _, w := range workspaces {
		if w.WorkspaceID == req.WorkspaceID {
			now := time.Now().UTC().Format(time.RFC3339Nano)
			var pinnedAt *string
			if req.Pinned {
				pinnedAt = &now
			}
			w.PinnedAt = pinnedAt
			w.UpdatedAt = now
			_ = s.store.UpsertWorkspace(w)
			if prj, ok := s.projectForWorkspace(w.ProjectID); ok {
				s.broadcastWorkspaceUpsert(w, prj)
			}
			_ = sendSessionMsg(ctx, sink, "workspace.pin.set.response", map[string]any{
				"requestId":   req.RequestID,
				"workspaceId": req.WorkspaceID,
				"accepted":    true,
				"pinnedAt":    pinnedAt,
				"error":       nil,
			})
			return
		}
	}
	_ = sendSessionMsg(ctx, sink, "workspace.pin.set.response", map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"accepted":    false,
		"pinnedAt":    nil,
		"error":       "Workspace not found",
	})
}

func (s *Server) handleWorkspaceAttention(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	if msgType == "workspace.mark_unread.request" {
		var req struct {
			RequestID   string `json:"requestId"`
			WorkspaceID string `json:"workspaceId"`
		}
		_ = json.Unmarshal(raw, &req)

		// Flag the most recently active finished agent in this workspace. The precondition is
		// what stops a running agent (or one already flagged) from being marked: marking either
		// would move the timestamp forward and re-notify the user about nothing new.
		var markedID any
		var errText any
		if rec, ok := s.firstMarkableAgent(req.WorkspaceID); ok {
			if s.markAgentAttention(rec.ID, AttentionReasonFinished, "") {
				markedID = rec.ID
			} else {
				errText = "Agent is no longer finished and read"
			}
		} else {
			errText = "No finished agent to mark in this workspace"
		}
		_ = sendSessionMsg(ctx, sink, "workspace.mark_unread.response", map[string]any{
			"requestId":     req.RequestID,
			"workspaceId":   req.WorkspaceID,
			"markedAgentId": markedID,
			"success":       markedID != nil,
			"error":         errText,
		})
		return
	}

	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID any    `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)

	// Both a single id and a list are accepted by the protocol; normalize to one list.
	var workspaceIDs []string
	switch v := req.WorkspaceID.(type) {
	case string:
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			workspaceIDs = []string{trimmed}
		}
	case []any:
		for _, item := range v {
			if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
				workspaceIDs = append(workspaceIDs, strings.TrimSpace(str))
			}
		}
	}

	cleared := make([]string, 0, 4)
	results := make([]any, 0, len(workspaceIDs))
	for _, wsID := range workspaceIDs {
		clearedHere := make([]string, 0, 4)
		for _, rec := range s.workspaceAttentionCandidates(wsID) {
			if s.clearAgentAttention(rec.ID) {
				clearedHere = append(clearedHere, rec.ID)
			}
		}
		cleared = append(cleared, clearedHere...)
		results = append(results, map[string]any{
			"workspaceId":     wsID,
			"clearedAgentIds": clearedHere,
			"success":         true,
			"error":           nil,
		})
	}
	_ = sendSessionMsg(ctx, sink, "workspace.clear_attention.response", map[string]any{
		"requestId":       req.RequestID,
		"workspaceId":     req.WorkspaceID,
		"clearedAgentIds": cleared,
		"results":         results,
		"success":         true,
		"error":           nil,
	})
}

func (s *Server) handleWorkspaceLabels(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID string `json:"requestId"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "workspace.label.list.request":
		// `subscribe` asks for incremental updates after the snapshot: the client keeps a cursor
		// and applies `workspace.label.update` frames instead of re-reading the whole catalog. It
		// is what makes a label rename cheap on a slow link, and without it the client has to poll
		// the full list.
		var listReq struct {
			Subscribe bool `json:"subscribe"`
		}
		_ = json.Unmarshal(raw, &listReq)
		if listReq.Subscribe {
			s.addLabelSubscriber(sink)
		}
		catalog := s.store.LoadLabelCatalog()
		_ = sendSessionMsg(ctx, sink, "workspace.label.list.response", map[string]any{
			"requestId": base.RequestID,
			"labels":    catalog.Labels,
			"sync": map[string]any{
				"mode":       "snapshot",
				"generation": catalog.Generation,
				"headSeq":    catalog.HeadSeq,
				"removals":   []any{},
			},
		})
	case "workspace.label.assignment.set.request":
		var req struct {
			RequestID   string                `json:"requestId"`
			WorkspaceID string                `json:"workspaceId"`
			Label       store.LabelDefinition `json:"label"`
			Assigned    bool                  `json:"assigned"`
		}
		_ = json.Unmarshal(raw, &req)
		wsLabels, _ := s.store.SetWorkspaceLabelAssignment(req.WorkspaceID, req.Label, req.Assigned)
		// Assigning an unknown label creates it, which is how the picker's "create" page
		// commits (one RPC, not two). The catalog must advance so other clients see the row.
		if req.Assigned && req.Label.Name != "" {
			s.pushLabelUpdate(req.Label.Name, req.Label, "upsert")
		}
		// The workspace now carries a different label set. Emitting the workspace is what makes the picker's
		// checkbox and the sidebar's label chips change: the response only answers this caller, and the picker
		// re-derives its checked state from the workspace record.
		if workspaces, listErr := s.store.ListWorkspaces(); listErr == nil {
			for _, workspace := range workspaces {
				if workspace.WorkspaceID != req.WorkspaceID {
					continue
				}
				if prj, ok := s.projectForWorkspace(workspace.ProjectID); ok {
					s.broadcastWorkspaceUpsert(workspace, prj)
				}
				break
			}
		}
		_ = sendSessionMsg(ctx, sink, "workspace.label.assignment.set.response", map[string]any{
			"requestId":       req.RequestID,
			"label":           req.Label,
			"workspaceLabels": wsLabels,
		})
	case "workspace.label.update.request":
		var req struct {
			RequestID string `json:"requestId"`
			Name      string `json:"name"`
			NewName   string `json:"newName"`
			Color     string `json:"color"`
		}
		_ = json.Unmarshal(raw, &req)
		updatedDef, affected, _ := s.store.UpdateLabel(req.Name, req.NewName, req.Color)
		s.pushLabelUpdate(req.Name, updatedDef, "upsert")
		_ = sendSessionMsg(ctx, sink, "workspace.label.update.response", map[string]any{
			"requestId":              req.RequestID,
			"label":                  updatedDef,
			"affectedWorkspaceCount": affected,
		})
	case "workspace.label.delete.request":
		var req struct {
			RequestID string `json:"requestId"`
			Name      string `json:"name"`
		}
		_ = json.Unmarshal(raw, &req)
		affected := s.store.DeleteLabel(req.Name)
		s.pushLabelUpdate(req.Name, store.LabelDefinition{}, "remove")
		_ = sendSessionMsg(ctx, sink, "workspace.label.delete.response", map[string]any{
			"requestId":              req.RequestID,
			"affectedWorkspaceCount": affected,
		})
	case "workspace.label.delete.inspect.request":
		var req struct {
			RequestID string `json:"requestId"`
			Name      string `json:"name"`
		}
		_ = json.Unmarshal(raw, &req)
		affected := s.store.InspectLabelUsage(req.Name)
		_ = sendSessionMsg(ctx, sink, "workspace.label.delete.inspect.response", map[string]any{
			"requestId":              req.RequestID,
			"affectedWorkspaceCount": affected,
		})
	}
}

func (s *Server) handleWorkspaceRecovery(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)
	if msgType == "workspace.recovery.inspect.request" {
		payload := map[string]any{"requestId": req.RequestID}
		if state, refusal := s.resolveWorkspaceRecovery(req.WorkspaceID); refusal != nil {
			payload["state"] = map[string]any{
				"kind":        "unavailable",
				"workspaceId": req.WorkspaceID,
				"reason":      refusal.Reason,
				"message":     refusal.Message,
			}
		} else {
			payload["state"] = state
		}
		_ = sendSessionMsg(ctx, sink, "workspace.recovery.inspect.response", payload)
		return
	}
	resp := map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"accepted":    true,
		"error":       nil,
	}
	if err := s.restoreWorkspace(ctx, req.WorkspaceID); err != nil {
		resp["accepted"] = false
		resp["error"] = err.Error()
	}
	_ = sendSessionMsg(ctx, sink, "workspace.recovery.restore.response", resp)
}

func (s *Server) handleProjectConfig(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID string         `json:"requestId"`
		RepoRoot  string         `json:"repoRoot"`
		Config    map[string]any `json:"config"`
		// expectedRevision is the optimistic lock the editor holds. Comparing it before the
		// write is what stops two open editors from silently overwriting each other — the
		// second save would otherwise discard the first with no indication.
		ExpectedRevision *struct {
			MtimeMs int64 `json:"mtimeMs"`
			Size    int   `json:"size"`
		} `json:"expectedRevision"`
	}
	_ = json.Unmarshal(raw, &req)
	cfgPath := filepath.Join(req.RepoRoot, "byspace.json")

	if msgType == "read_project_config_request" {
		b, err := os.ReadFile(cfgPath)
		if err != nil {
			missing := map[string]any{
				"requestId": req.RequestID,
				"repoRoot":  req.RepoRoot,
				"ok":        true,
				"config":    nil,
				"revision":  nil,
			}
			addUncommittedSetupFlag(missing, ctx, req.RepoRoot)
			_ = sendSessionMsg(ctx, sink, "read_project_config_response", missing)
			return
		}
		var parsed map[string]any
		if unmarshalErr := json.Unmarshal(b, &parsed); unmarshalErr != nil {
			// A broken byspace.json is a state the editor has to show, not one to paper over: answering `ok: true` with
			// a null config told the client the project simply had no config, so the form opened empty and the user's
			// next save overwrote the file they were trying to fix. The error union is keyed on `code`, and
			// `invalid_project_config` is what renders the read-error callout.
			_ = sendSessionMsg(ctx, sink, "read_project_config_response", map[string]any{
				"requestId": req.RequestID,
				"repoRoot":  req.RepoRoot,
				"ok":        false,
				"error": map[string]any{
					"code":    "invalid_project_config",
					"message": unmarshalErr.Error(),
				},
			})
			return
		}
		info, _ := os.Stat(cfgPath)
		var mtimeMs int64
		if info != nil {
			mtimeMs = info.ModTime().UnixMilli()
		}
		present := map[string]any{
			"requestId": req.RequestID,
			"repoRoot":  req.RepoRoot,
			"ok":        true,
			"config":    parsed,
			"revision": map[string]any{
				"mtimeMs": mtimeMs,
				"size":    len(b),
			},
		}
		addUncommittedSetupFlag(present, ctx, req.RepoRoot)
		_ = sendSessionMsg(ctx, sink, "read_project_config_response", present)
		return
	}

	// Optimistic lock: refuse the write when the file moved since the client read it.
	if req.ExpectedRevision != nil {
		if info, statErr := os.Stat(cfgPath); statErr == nil {
			if info.ModTime().UnixMilli() != req.ExpectedRevision.MtimeMs || int(info.Size()) != req.ExpectedRevision.Size {
				// The error shape is a discriminated union keyed on `code`, and the client uses
				// `currentRevision` to offer "reload and retry" without a second fetch.
				_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
					"requestId": req.RequestID,
					"repoRoot":  req.RepoRoot,
					"ok":        false,
					"error": map[string]any{
						"code": "stale_project_config",
						"currentRevision": map[string]any{
							"mtimeMs": info.ModTime().UnixMilli(),
							"size":    int(info.Size()),
						},
					},
				})
				return
			}
		} else if !os.IsNotExist(statErr) {
			// A stat failure other than "no file yet" means we cannot verify the lock.
			_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
				"requestId": req.RequestID,
				"repoRoot":  req.RepoRoot,
				"ok":        false,
				"error":     map[string]any{"code": "write_failed"},
			})
			return
		}
	}

	// Validate before writing: the daemon reads this file to run setup and scripts, so a wrong
	// shape silently disables them long after the edit that caused it.
	if validationErr := workspace.ValidateProjectConfig(req.Config); validationErr != nil {
		fmt.Fprintf(os.Stderr, "project config rejected for %s: %v\n", req.RepoRoot, validationErr)
		_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
			"requestId": req.RequestID,
			"repoRoot":  req.RepoRoot,
			"ok":        false,
			// The protocol's error union has no message field for this code, so the detail is
			// logged rather than invented on the wire.
			"error": map[string]any{"code": workspace.ConfigErrInvalidConfig},
		})
		return
	}

	b, _ := json.MarshalIndent(req.Config, "", "  ")
	if err := home.WriteAtomic(cfgPath, append(b, '\n'), 0o644); err != nil {
		_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
			"requestId": req.RequestID,
			"repoRoot":  req.RepoRoot,
			"ok":        false,
			"error":     map[string]any{"code": "write_failed"},
		})
		return
	}
	// Report the revision the file actually has now, so the editor's next save is locked to
	// the content it just wrote.
	var mtimeMs int64
	var size int
	if info, statErr := os.Stat(cfgPath); statErr == nil {
		mtimeMs = info.ModTime().UnixMilli()
		size = int(info.Size())
	} else {
		mtimeMs = time.Now().UnixMilli()
		size = len(b) + 1
	}
	written := map[string]any{
		"requestId": req.RequestID,
		"repoRoot":  req.RepoRoot,
		"ok":        true,
		"config":    req.Config,
		"revision": map[string]any{
			"mtimeMs": mtimeMs,
			"size":    size,
		},
	}
	// Reported after the write, so the warning clears the moment the user commits rather than needing a reload.
	addUncommittedSetupFlag(written, ctx, req.RepoRoot)
	_ = sendSessionMsg(ctx, sink, "write_project_config_response", written)
}

func (s *Server) handleWorkspaceScripts(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
		ScriptName  string `json:"scriptName"`
	}
	_ = json.Unmarshal(raw, &req)

	var wsCwd string
	workspaces, _ := s.store.ListWorkspaces()
	for _, w := range workspaces {
		if w.WorkspaceID == req.WorkspaceID {
			wsCwd = w.Cwd
			break
		}
	}

	readScripts := func() []map[string]any {
		return s.workspaceScriptsPayload(req.WorkspaceID, wsCwd)
	}

	switch msgType {
	// COMPAT(workspaceScriptStartFlat): the flat name predates `workspace.script.start.request`. It is routed
	// here so an old client still works; the implementation below is the same one, and the response type is
	// chosen by the request's own type so each caller gets the shape it asked for.
	case "start_workspace_script_request":
		script, err := s.startWorkspaceScript(ctx, req.WorkspaceID, req.ScriptName)
		var errText any
		if err != nil {
			errText = err.Error()
		}
		// terminalId is what the flat response has always carried, and the protocol still requires it: a script
		// started through the old path was shown in a terminal, and the caller attaches to that terminal by id.
		var terminalID any
		if script != nil {
			terminalID = script["terminalId"]
		}
		_ = sendSessionMsg(ctx, sink, "start_workspace_script_response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"terminalId":  terminalID,
			"script":      script,
			"error":       errText,
		})
		s.broadcastScriptStatus(req.WorkspaceID)

	case "workspace.script.list.request":
		_ = sendSessionMsg(ctx, sink, "workspace.script.list.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scripts":     readScripts(),
			"error":       nil,
		})
	case "workspace.script.start.request":
		script, err := s.startWorkspaceScript(ctx, req.WorkspaceID, req.ScriptName)
		var errText any
		if err != nil {
			errText = err.Error()
		}
		_ = sendSessionMsg(ctx, sink, "workspace.script.start.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"script":      script,
			"error":       errText,
		})
		s.broadcastScriptStatus(req.WorkspaceID)
	case "workspace.script.stop.request":
		s.stopWorkspaceScript(req.WorkspaceID, req.ScriptName)
		script := s.workspaceScriptSnapshot(req.WorkspaceID, req.ScriptName)
		_ = sendSessionMsg(ctx, sink, "workspace.script.stop.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"script":      script,
			"error":       nil,
		})
		s.broadcastScriptStatus(req.WorkspaceID)
	}
}

func (s *Server) handleEditors(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		EditorID  string `json:"editorId"`
		Path      string `json:"path"`
		// `mode: "reveal"` opens the file and scrolls to it; "open" just opens the target.
		Mode string `json:"mode"`
		Cwd  string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	if msgType == "list_available_editors_request" {
		editors := make([]map[string]any, 0)
		// Same allow-list as open_in_editor, so the picker never offers something the open
		// path would refuse.
		for _, cand := range []struct{ id, label string }{
			{"cursor", "Cursor"},
			{"code", "VS Code"},
			{"zed", "Zed"},
			{"windsurf", "Windsurf"},
			{"idea", "IntelliJ IDEA"},
			{"subl", "Sublime Text"},
			{"nvim", "Neovim"},
		} {
			if _, err := exec.LookPath(knownEditors[cand.id]); err == nil {
				editors = append(editors, map[string]any{"id": cand.id, "label": cand.label})
			}
		}
		_ = sendSessionMsg(ctx, sink, "list_available_editors_response", map[string]any{
			"requestId": req.RequestID,
			"editors":   editors,
			"error":     nil,
		})
		return
	}
	// `editorId` comes from the client and used to be executed verbatim, so any string was a
	// command. Only launch an editor this build actually detected.
	if target, ok := resolveEditorCommand(req.EditorID); ok && req.Path != "" {
		args := []string{}
		if req.Mode == "reveal" {
			args = append(args, "--goto", req.Path)
		} else {
			args = append(args, req.Path)
		}
		cmd := exec.Command(target, args...)
		if strings.TrimSpace(req.Cwd) != "" {
			cmd.Dir = req.Cwd
		}
		_ = cmd.Start()
	}
	_ = sendSessionMsg(ctx, sink, "open_in_editor_response", map[string]any{
		"requestId": req.RequestID,
		"error":     nil,
	})
}

func (s *Server) handleFileExtraOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	switch msgType {
	case "fs.entry.duplicate.request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Path      string `json:"path"`
		}
		_ = json.Unmarshal(raw, &req)
		dup, err := workspace.DuplicateEntry(req.Cwd, req.Path)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "fs.entry.duplicate.response", map[string]any{
				"cwd":            req.Cwd,
				"path":           req.Path,
				"duplicatedPath": nil,
				"success":        false,
				"error":          err.Error(),
				"requestId":      req.RequestID,
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "fs.entry.duplicate.response", map[string]any{
			"cwd":            req.Cwd,
			"path":           req.Path,
			"duplicatedPath": dup,
			"success":        true,
			"error":          nil,
			"requestId":      req.RequestID,
		})

	case "file_download_token_request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Path      string `json:"path"`
		}
		_ = json.Unmarshal(raw, &req)
		fc, err := workspace.ReadFile(req.Cwd, req.Path)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "file_download_token_response", map[string]any{
				"cwd":       req.Cwd,
				"path":      req.Path,
				"token":     nil,
				"fileName":  nil,
				"mimeType":  nil,
				"size":      nil,
				"error":     err.Error(),
				"requestId": req.RequestID,
			})
			return
		}
		var b [12]byte
		_, _ = rand.Read(b[:])
		tok := "dl_" + hex.EncodeToString(b[:])
		fileName := filepath.Base(req.Path)
		s.mu.Lock()
		// Expired tokens are only *checked* on use, so without this they accumulate for the
		// life of the daemon: every file preview the user ever opened leaves an entry. Pruning
		// on issue is cheap because the map is tiny at any moment.
		s.pruneDownloadTokensLocked()
		s.downloadTokens[tok] = downloadTokenEntry{
			absPath:   filepath.Join(req.Cwd, req.Path),
			fileName:  fileName,
			mimeType:  fc.MimeType,
			size:      fc.Size,
			expiresAt: time.Now().Add(5 * time.Minute),
		}
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, sink, "file_download_token_response", map[string]any{
			"cwd":       req.Cwd,
			"path":      req.Path,
			"token":     tok,
			"fileName":  fileName,
			"mimeType":  fc.MimeType,
			"size":      fc.Size,
			"error":     nil,
			"requestId": req.RequestID,
		})

	case "file.upload.request":
		// The protocol sends only metadata here; the bytes follow as binary
		// FileBegin/FileChunk/FileEnd frames on the same socket. Reading a `data` field (which
		// the schema does not have) produced an empty file every time.
		var req struct {
			RequestID  string  `json:"requestId"`
			FileName   string  `json:"fileName"`
			MimeType   string  `json:"mimeType"`
			Size       float64 `json:"size"`
			ModifiedAt string  `json:"modifiedAt"`
		}
		_ = json.Unmarshal(raw, &req)

		upload, uploadErr := s.beginUpload(req.RequestID, req.FileName, req.MimeType, int64(req.Size))
		if uploadErr != nil {
			_ = sendSessionMsg(ctx, sink, "file.upload.response", map[string]any{
				"requestId": req.RequestID,
				"file":      nil,
				"error":     uploadErr.Error(),
			})
			return
		}
		// Acknowledge so the client starts streaming chunks; the completed file is reported
		// when the FileEnd frame arrives.
		_ = sendSessionMsg(ctx, sink, "file.upload.accepted", map[string]any{
			"requestId": req.RequestID,
			"uploadId":  upload.id,
		})
	}
}

func (s *Server) handleHTTPFileDownload(w http.ResponseWriter, r *http.Request) {
	tok := strings.TrimSpace(r.URL.Query().Get("token"))
	if tok == "" {
		http.Error(w, `{"error":"Missing download token"}`, http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	entry, ok := s.downloadTokens[tok]
	if ok {
		delete(s.downloadTokens, tok)
	}
	s.mu.Unlock()

	if !ok || time.Now().After(entry.expiresAt) {
		http.Error(w, `{"error":"Invalid or expired token"}`, http.StatusForbidden)
		return
	}
	data, err := os.ReadFile(entry.absPath)
	if err != nil {
		http.Error(w, `{"error":"File not found"}`, http.StatusNotFound)
		return
	}
	safeName := strings.NewReplacer(`"`, "_", "\r", "_", "\n", "_").Replace(entry.fileName)
	w.Header().Set("Content-Type", entry.mimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// pushLabelUpdate advances the label catalog sequence and broadcasts the incremental frame.
//
// The app's host-replica only applies `workspace.label.update` when
// `update.seq === cursor.afterSeq + 1` inside the same generation, so the catalog's headSeq
// must be the authority for both the snapshot and every subsequent frame. Emitting a fixed
// generation/seq — or skipping the update entirely — leaves every other connected client
// showing stale labels until a full reload.
func (s *Server) pushLabelUpdate(previousName string, label store.LabelDefinition, kind string) {
	catalog, update := s.store.MutateLabelCatalog(func(c *store.LabelCatalog) (map[string]any, bool) {
		switch kind {
		case "remove":
			next := make([]store.LabelDefinition, 0, len(c.Labels))
			for _, l := range c.Labels {
				if l.Name != previousName {
					next = append(next, l)
				}
			}
			c.Labels = next
			return map[string]any{"kind": "remove", "name": previousName}, true
		default:
			replaced := false
			for i := range c.Labels {
				if c.Labels[i].Name == previousName || c.Labels[i].Name == label.Name {
					c.Labels[i] = label
					replaced = true
					break
				}
			}
			if !replaced {
				c.Labels = append(c.Labels, label)
			}
			frame := map[string]any{"kind": "upsert", "label": label}
			if previousName != "" && previousName != label.Name {
				frame["previousName"] = previousName
			}
			return frame, true
		}
	})
	_ = catalog
	if update != nil {
		s.broadcastSessionMsg("workspace.label.update", update)
	}
}

// archiveWorkspaceContents tears down everything that belongs to a workspace.
//
// Ported from archiveWorkspaceContents in workspace-archive-service.ts. Archiving only the
// workspace record leaves its agents running: they keep consuming tokens against a workspace
// the user just removed from the sidebar, and their terminals keep holding PTYs.
func (s *Server) archiveWorkspaceContents(ctx context.Context, workspaceID, archivedAt string) {
	agents, _ := s.store.ListAgents()

	s.mu.Lock()
	type liveAgent struct {
		id     string
		sess   interface{ Close() error }
		record store.AgentRecord
	}
	var toClose []liveAgent
	for _, rec := range agents {
		if rec.WorkspaceID != workspaceID {
			continue
		}
		if mp, ok := s.agents[rec.ID]; ok && mp.session != nil {
			toClose = append(toClose, liveAgent{id: rec.ID, sess: mp.session, record: mp.record})
			delete(s.agents, rec.ID)
		}
	}
	// Terminals are keyed by slot and carry their owning workspace.
	var termSlots []uint8
	var closedTerms []*terminal.Session
	for slot, term := range s.terminals {
		if term == nil || term.WorkspaceID != workspaceID {
			continue
		}
		termSlots = append(termSlots, slot)
		closedTerms = append(closedTerms, term)
	}
	s.mu.Unlock()

	for _, la := range toClose {
		_ = la.sess.Close()
		rec := store.BuildArchivedAgentRecord(la.record, archivedAt)
		_ = s.store.UpsertAgent(rec)
		s.broadcastAgentUpdate(rec)
	}

	for i, slot := range termSlots {
		_ = closedTerms[i].Close()
		s.mu.Lock()
		delete(s.terminals, slot)
		s.mu.Unlock()
	}
	if len(termSlots) > 0 {
		s.broadcastTerminalsChanged("", workspaceID)
	}

	// A setup run still writing into the worktree outlives the archive: it keeps node_modules and
	// lockfiles moving in a directory that is no longer shown, and if the user asked to delete the
	// worktree it is writing into a directory that is about to disappear.
	s.stopWorkspaceSetup(workspaceID)

	// Records that were already stopped still need archiving.
	for _, rec := range agents {
		if rec.WorkspaceID != workspaceID || rec.ArchivedAt != nil {
			continue
		}
		rec.ArchivedAt = &archivedAt
		rec.UpdatedAt = archivedAt
		_ = s.store.UpsertAgent(rec)
		s.broadcastAgentUpdate(rec)
	}
	_ = ctx
}

// knownEditors is the allow-list of editor launchers. `open_in_editor_request` carries an
// editorId from the client; executing it directly would run any string as a command.
var knownEditors = map[string]string{
	"cursor":   "cursor",
	"code":     "code",
	"zed":      "zed",
	"windsurf": "windsurf",
	"nvim":     "nvim",
	"vim":      "vim",
	"idea":     "idea",
	"subl":     "subl",
}

// resolveEditorCommand maps an editor id to a binary that exists on this machine.
func resolveEditorCommand(editorID string) (string, bool) {
	binary, ok := knownEditors[strings.ToLower(strings.TrimSpace(editorID))]
	if !ok {
		return "", false
	}
	if _, err := exec.LookPath(binary); err != nil {
		return "", false
	}
	return binary, true
}

// ValidateProjectDirectoryName applies the node rules for a new directory name.
//
// Ported from validateDirectoryName. An absolute path, a Windows drive prefix or `..` would
// place the directory outside the parent the user selected, so they are rejected here rather
// than surviving as a surprising path.
func ValidateProjectDirectoryName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("directory name cannot be empty")
	}
	if name != strings.TrimSpace(name) {
		return fmt.Errorf("directory name cannot start or end with whitespace")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("directory name cannot be . or ..")
	}
	if strings.ContainsAny(name, "/\\\x00") {
		return fmt.Errorf("directory name must be a single name without path separators")
	}
	if filepath.IsAbs(name) || (len(name) >= 2 && name[1] == ':') {
		return fmt.Errorf("directory name must not be an absolute path")
	}
	return nil
}

// detectShippedIcon returns a project's own favicon as an icon payload, or nil.
//
// The file is read and base64-encoded rather than served by path: the client renders the icon in
// many places and a filesystem path would only work for a local connection.
func detectShippedIcon(projectDir string) map[string]any {
	if strings.TrimSpace(projectDir) == "" {
		return nil
	}
	path := projecticon.Find(projectDir)
	if path == "" {
		return nil
	}
	mime := projecticon.MimeTypeFor(path)
	if mime == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	// Icons are small; anything larger is not one, and shipping a megabyte per project through
	// the directory listing would be worse than showing nothing.
	const maxIconBytes = 512 * 1024
	if len(raw) > maxIconBytes {
		return nil
	}
	return map[string]any{
		"data":     base64.StdEncoding.EncodeToString(raw),
		"mimeType": mime,
		"source":   "detected",
	}
}

// pruneDownloadTokensLocked drops expired download tokens. Callers hold s.mu.
func (s *Server) pruneDownloadTokensLocked() {
	now := time.Now()
	for token, entry := range s.downloadTokens {
		if now.After(entry.expiresAt) {
			delete(s.downloadTokens, token)
		}
	}
}

// addLabelSubscriber records that a sink has the label catalog in hand.
//
// `workspace.label.update` is broadcast to every client, so the subscription is not a filter — it
// records that this client's cursor is current, which is what the client asked for by sending
// `subscribe: true`. Keeping the set means a future per-client cursor does not have to re-derive it.
func (s *Server) addLabelSubscriber(sink frameSink) {
	if sink == nil {
		return
	}
	s.mu.Lock()
	if s.labelSubscribers == nil {
		s.labelSubscribers = make(map[frameSink]bool)
	}
	s.labelSubscribers[sink] = true
	s.mu.Unlock()
}

// removeLabelSubscriber drops a sink when its connection ends.
func (s *Server) removeLabelSubscriber(sink frameSink) {
	s.mu.Lock()
	delete(s.labelSubscribers, sink)
	s.mu.Unlock()
}

// labelSubscriberCount reports how many clients hold a current label cursor.
func (s *Server) labelSubscriberCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.labelSubscribers)
}

// worktreeMatches decides whether a workspace record is the worktree the caller named.
//
// Three ways to name one, tried in order of specificity: an exact path, a path this workspace
// encloses, or a (repo root, branch) pair. The last one exists because the sidebar addresses a
// worktree by branch, and matching only on path left the request archiving nothing.
// worktreeArchiveTargets resolves which workspace records a byspace_worktree_archive_request
// names.
//
// scope "worktree" takes every active workspace checked out at the target directory, because the
// caller is closing the worktree rather than one row. scope "workspace" (the default, and what an
// old client sends) takes exactly one record: the named workspaceId, otherwise the record that
// resolves from the path, preferring the worktree-kind record on a cwd tie.
func (s *Server) worktreeArchiveTargets(worktreePath, repoRoot, branchName, workspaceID, scope string) []string {
	trimmedPath := strings.TrimSpace(worktreePath)
	if strings.TrimSpace(workspaceID) != "" {
		return []string{strings.TrimSpace(workspaceID)}
	}
	resolvedID := ""
	if trimmedPath != "" {
		// A caller may pass a subdirectory of the worktree, so the path is resolved to its owning
		// workspace first.
		resolvedID = s.store.ResolveWorkspaceIDForPath(trimmedPath)
	}
	workspaces, _ := s.store.ListWorkspaces()

	matches := make([]store.WorkspaceRecord, 0, 1)
	for _, w := range workspaces {
		if w.ArchivedAt != nil {
			continue
		}
		if worktreeMatches(w, trimmedPath, resolvedID, repoRoot, branchName) {
			matches = append(matches, w)
		}
	}
	if len(matches) == 0 {
		return nil
	}
	if strings.TrimSpace(scope) == "worktree" {
		ids := make([]string, 0, len(matches))
		for _, w := range matches {
			ids = append(ids, w.WorkspaceID)
		}
		return ids
	}
	preferred := matches[0]
	for _, w := range matches {
		if w.Kind == "worktree" {
			preferred = w
			break
		}
	}
	return []string{preferred.WorkspaceID}
}

func worktreeMatches(record store.WorkspaceRecord, worktreePath, resolvedID, repoRoot, branchName string) bool {
	if strings.TrimSpace(worktreePath) != "" {
		// Exact match first, then the workspace that encloses the given path — a caller may pass
		// a subdirectory of the worktree.
		if pathutil.AreEquivalent(record.Cwd, worktreePath) || (resolvedID != "" && record.WorkspaceID == resolvedID) {
			return true
		}
	}
	if strings.TrimSpace(repoRoot) != "" && strings.TrimSpace(branchName) != "" {
		recordRoot := ""
		if record.WorktreeRoot != nil {
			recordRoot = *record.WorktreeRoot
		}
		recordBranch := ""
		if record.Branch != nil {
			recordBranch = *record.Branch
		}
		return recordRoot == repoRoot && recordBranch == branchName
	}
	return false
}

// teardownArchivedWorkspace stops the work a workspace was doing before it is archived.
//
// Ported from workspace-archive-service.ts and workspace-setup-runtime.ts's stop(). Archiving used to
// write ArchivedAt and nothing else, which left three things running against a directory that is
// about to be removed or is no longer shown anywhere:
//
//   - the setup run, still writing node_modules into a worktree that may be deleted;
//   - the terminals, whose shells keep the pty and its processes alive;
//   - the agents, which keep spending tokens on a conversation the user just archived.
//
// Order matters: agents first (they can spawn terminals and setup), then terminals, then the setup
// run's own commands.
func (s *Server) teardownArchivedWorkspace(workspaceID, archivedAt string) {
	agents, err := s.store.ListByWorkspace(workspaceID)
	if err == nil {
		for _, agent := range agents {
			if agent.ArchivedAt != nil {
				continue
			}
			s.mu.Lock()
			mp := s.agents[agent.ID]
			delete(s.agents, agent.ID)
			s.mu.Unlock()
			if mp != nil && mp.session != nil {
				if turnID, _ := mp.session.ActiveTurn(); turnID != "" {
					s.broadcastTurnCanceled(mp.record, turnID, "workspace archived")
				}
				_ = mp.session.Close()
			}
			archived := store.BuildArchivedAgentRecord(agent, archivedAt)
			_ = s.store.UpsertAgent(archived)
			s.broadcastAgentUpdate(archived)
			s.cascadeArchiveChildren(agent.ID)
		}
	}

	s.stopWorkspaceTerminals(workspaceID)
	s.stopWorkspaceSetup(workspaceID)
}

// stopWorkspaceTerminals closes every terminal attached to a workspace.
func (s *Server) stopWorkspaceTerminals(workspaceID string) {
	s.mu.Lock()
	terminals := make([]*terminal.Session, 0, 2)
	var termCwd string
	for slot, session := range s.terminals {
		if session.WorkspaceID != workspaceID {
			continue
		}
		if termCwd == "" {
			termCwd = session.Cwd
		}
		terminals = append(terminals, session)
		delete(s.terminals, slot)
	}
	s.mu.Unlock()

	for _, session := range terminals {
		_ = session.Close()
	}
	if len(terminals) > 0 {
		s.broadcastTerminalsChanged(termCwd, workspaceID)
	}
}

// stopWorkspaceSetup marks a running setup as stopped.
//
// The goroutine running the commands is not killed: it holds an exec.Cmd chain whose children are the
// project's own build tools, and the honest outcome is that the snapshot says stopped while whatever
// already started finishes. What matters is that the UI stops claiming it is running.
func (s *Server) stopWorkspaceSetup(workspaceID string) {
	s.setupRunsMu.Lock()
	delete(s.setupRuns, workspaceID)
	s.setupRunsMu.Unlock()

	s.mu.Lock()
	snap, ok := s.setupSnapshots[workspaceID]
	s.mu.Unlock()
	if !ok || snap == nil {
		return
	}
	snap.mu.Lock()
	if snap.Status == "running" {
		// "stopped" is not on the wire: WorkspaceSetupSnapshotSchema accepts only
		// running/completed/failed/blocked, and an unknown status makes the client drop the whole
		// message — leaving the setup tab claiming it is still running.
		reason := "workspace archived"
		snap.Status = "failed"
		snap.Error = &reason
	}
	snap.mu.Unlock()
	s.broadcastSetupProgress(snap)
}

// normalizeClientMessageID trims a client message id, returning "" when it carries nothing.
//
// Ported from client-message-id.ts. The id is what lets the client match its optimistic bubble to the
// confirmed user_message, so a whitespace-only id must be treated as absent rather than used — two
// messages with id " " would collide and one would be silently dropped as a duplicate.
func normalizeClientMessageID(raw string) string {
	return strings.TrimSpace(raw)
}

// resolveClientMessageID returns the id the user_message should carry.
//
// Ported from resolveClientMessageId: the client's id when it sent one, a generated one otherwise. A
// user_message without an id cannot be matched to the optimistic bubble, which is what made a sent
// message render twice.
func resolveClientMessageID(raw, fallback string) string {
	if trimmed := normalizeClientMessageID(raw); trimmed != "" {
		return trimmed
	}
	return fallback
}

// addUncommittedSetupFlag sets `hasUncommittedWorktreeSetupChanges` only when it is true.
//
// The field is optional but NOT nullable, so writing `nil` into the payload makes the whole response fail validation —
// the client then discards it and the project config panel shows nothing at all. A key that is absent means "not
// checked", which is the honest answer when there is no config file to compare against; `false` would assert the setup
// is committed, which the daemon has not established.
func addUncommittedSetupFlag(payload map[string]any, ctx context.Context, repoRoot string) {
	if strings.TrimSpace(repoRoot) == "" {
		return
	}
	if workspace.HasUncommittedSetupChanges(ctx, repoRoot) {
		payload["hasUncommittedWorktreeSetupChanges"] = true
	}
}

// projectRootByID returns a project's root path, or "" when the id is unknown.
func (s *Server) projectRootByID(projectID string) string {
	trimmed := strings.TrimSpace(projectID)
	if trimmed == "" {
		return ""
	}
	projects, err := s.store.ListProjects()
	if err != nil {
		return ""
	}
	for _, project := range projects {
		if project.ProjectID == trimmed {
			return project.RootPath
		}
	}
	return ""
}

// sourceCheckoutSource is the wire shape of `source.checkoutSource` on workspace.create.
type sourceCheckoutSource struct {
	Number      int    `json:"number"`
	Forge       string `json:"forge"`
	ProjectPath string `json:"projectPath"`
}

// worktreeSourceIntentInput maps a workspace.create worktree source onto the shared resolver input.
//
// baseBranch is the client's override for the repository's default branch: the resolver asks
// DefaultBranch only when no ref was named, and workspace.create carries the resolved base
// separately from the picked ref.
func worktreeSourceIntentInput(
	action, refName, baseBranch, branchName, worktreeSlug string,
	checkoutSource *sourceCheckoutSource,
	githubPRNumber *int,
) workspace.WorktreeIntentInput {
	input := workspace.WorktreeIntentInput{
		WorktreeSlug:   strings.TrimSpace(worktreeSlug),
		BranchName:     strings.TrimSpace(branchName),
		RefName:        strings.TrimSpace(refName),
		Action:         strings.TrimSpace(action),
		GithubPRNumber: githubPRNumber,
	}
	// A branch-off with no explicit ref starts from the base the client resolved; without this the
	// resolver would ask git for the default branch and ignore a base the user had already pinned.
	if input.RefName == "" && input.Action == "branch-off" {
		input.RefName = strings.TrimSpace(baseBranch)
	}
	if checkoutSource != nil {
		input.CheckoutSource = &workspace.CheckoutSource{
			Number:      checkoutSource.Number,
			Forge:       checkoutSource.Forge,
			ProjectPath: checkoutSource.ProjectPath,
		}
	}
	return input
}

// handleWorkspaceCreateFromWorktree creates a workspace whose source is a worktree.
//
// The worktree source names a project and a branch, not a directory — the directory is what this call produces. It reuses
// the worktree creation path so a workspace created from the command center gets a real git worktree, the same
// untrusted-source guard for a change request checkout, and the same setup scheduling, instead of a second
// implementation that would drift.
//
// The worktree handler answers on `create_byspace_worktree_response`; the caller here asked for a workspace, so the
// result is translated into that response rather than making the client listen on two channels for one operation.
func (s *Server) handleWorkspaceCreateFromWorktree(
	ctx context.Context,
	sink frameSink,
	requestID string,
	projectRoot string,
	title *string,
	intentInput workspace.WorktreeIntentInput,
) {
	// Resolve through the same resolver the worktree RPCs use: the client speaks action + refName +
	// checkoutSource, and reading only some of those fields silently dropped the branch the user
	// picked in the starting-ref picker.
	intent, intentErr := workspace.ResolveWorktreeIntent(ctx, intentInput, projectRoot, workspace.WorktreeIntentDeps{
		Forge:         workspace.DetectForge(ctx, projectRoot),
		DefaultBranch: workspace.ResolveDefaultBranch,
	})
	if intentErr != nil {
		_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
			"requestId":       requestID,
			"workspace":       nil,
			"setupTerminalId": nil,
			"error":           intentErr.Error(),
		})
		return
	}
	worktreeSlug := intentInput.WorktreeSlug

	wtBase := filepath.Join(s.homeDir, "worktrees")
	wtPath, branch, err := workspace.CreateWorktreeFromIntent(ctx, projectRoot, wtBase, intent, worktreeSlug)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
			"requestId":       requestID,
			"workspace":       nil,
			"setupTerminalId": nil,
			"error":           err.Error(),
		})
		return
	}

	prj, _, err := s.store.EnsureWorkspaceForCwd(projectRoot)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
			"requestId":       requestID,
			"workspace":       nil,
			"setupTerminalId": nil,
			"error":           err.Error(),
		})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	repoRoot := prj.RootPath
	displayName := branch
	if title != nil && strings.TrimSpace(*title) != "" {
		displayName = strings.TrimSpace(*title)
	}
	wsRec := store.WorkspaceRecord{
		WorkspaceID:            store.NewWorkspaceID(),
		ProjectID:              prj.ProjectID,
		Cwd:                    wtPath,
		Kind:                   "worktree",
		DisplayName:            displayName,
		Branch:                 &branch,
		WorktreeRoot:           &wtPath,
		MainRepoRoot:           &repoRoot,
		IsBySpaceOwnedWorktree: true,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	_ = s.store.UpsertWorkspace(wsRec)
	s.broadcastWorkspaceUpsert(wsRec, prj)

	// Setup runs before the response is considered complete by the client, but it must not block the response: a
	// worktree whose setup is slow is still openable, and the timeline carries the progress.
	//
	// Run even when there is nothing to run: a project with no setup still needs a "completed"
	// snapshot, otherwise a client waiting for progress waits forever. Node emits the empty
	// completed progress for exactly this case.
	var setupTerminalID any
	go s.runWorkspaceSetup(wsRec.WorkspaceID, wtPath, branch, workspace.ReadSetupCommands(wtPath))
	_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
		"requestId":       requestID,
		"workspace":       s.workspaceDescriptor(wsRec, prj),
		"setupTerminalId": setupTerminalID,
		"error":           nil,
	})
}
