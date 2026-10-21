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
			_, _ = s.store.ArchiveWorkspace(w.WorkspaceID, now)
			removedWS = append(removedWS, w.WorkspaceID)
		}
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
		"workspace": buildWorkspaceDescriptor(ws, prj),
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
		}
		_ = json.Unmarshal(raw, &req)

		workspaces, _ := s.store.ListWorkspaces()
		// A caller may pass a subdirectory of the worktree, so the path is resolved to its owning
		// workspace first.
		resolvedID := ""
		if strings.TrimSpace(req.WorktreePath) != "" {
			resolvedID = s.store.ResolveWorkspaceIDForPath(req.WorktreePath)
		}
		for _, w := range workspaces {
			if !worktreeMatches(w, req.WorktreePath, resolvedID, req.RepoRoot, req.BranchName) {
				continue
			}
			_, _ = s.store.ArchiveWorkspace(w.WorkspaceID, now)
		}
		if req.DeleteWorktreeFromDisk && strings.TrimSpace(req.WorktreePath) != "" {
			_ = workspace.RemoveWorktreeFromDisk(ctx, req.WorktreePath)
		}
		_ = sendSessionMsg(ctx, sink, "byspace_worktree_archive_response", map[string]any{
			"requestId":     req.RequestID,
			"success":       true,
			"removedAgents": []string{},
			"error":         nil,
		})
		return
	}

	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)
	// Capture the record before archiving so the removal delta can name its project.
	var archived store.WorkspaceRecord
	hasArchived := false
	if list, _ := s.store.ListWorkspaces(); true {
		for _, w := range list {
			if w.WorkspaceID == req.WorkspaceID {
				archived, hasArchived = w, true
				break
			}
		}
	}
	if _, err := s.store.ArchiveWorkspace(req.WorkspaceID, now); err != nil {
		_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"archivedAt":  nil,
			// Archiving can succeed at the registry level while the directory delete fails;
			// the client reports that separately from a hard error.
			"directoryError": nil,
			"error":          err.Error(),
		})
		return
	}
	if hasArchived {
		archived.ArchivedAt = &now
		s.archiveWorkspaceContents(ctx, req.WorkspaceID, now)
		if prj, ok := s.projectForWorkspace(archived.ProjectID); ok {
			s.broadcastWorkspaceUpsert(archived, prj)
		}
	}
	_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
		"requestId":      req.RequestID,
		"workspaceId":    req.WorkspaceID,
		"archivedAt":     now,
		"directoryError": nil,
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
		_ = sendSessionMsg(ctx, sink, "workspace.recovery.inspect.response", map[string]any{
			"requestId": req.RequestID,
			"state": map[string]any{
				"kind":          "recoverable",
				"workspaceId":   req.WorkspaceID,
				"workspaceName": req.WorkspaceID,
				"action":        "recreate_directory",
				"branch":        nil,
			},
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "workspace.recovery.restore.response", map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"accepted":    true,
		"error":       nil,
	})
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
			_ = sendSessionMsg(ctx, sink, "read_project_config_response", map[string]any{
				"requestId": req.RequestID,
				"repoRoot":  req.RepoRoot,
				"ok":        true,
				"config":    nil,
				"revision":  nil,
			})
			return
		}
		var parsed map[string]any
		_ = json.Unmarshal(b, &parsed)
		info, _ := os.Stat(cfgPath)
		var mtimeMs int64
		if info != nil {
			mtimeMs = info.ModTime().UnixMilli()
		}
		_ = sendSessionMsg(ctx, sink, "read_project_config_response", map[string]any{
			"requestId": req.RequestID,
			"repoRoot":  req.RepoRoot,
			"ok":        true,
			"config":    parsed,
			"revision": map[string]any{
				"mtimeMs": mtimeMs,
				"size":    len(b),
			},
		})
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
	_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
		"requestId": req.RequestID,
		"repoRoot":  req.RepoRoot,
		"ok":        true,
		"config":    req.Config,
		"revision": map[string]any{
			"mtimeMs": mtimeMs,
			"size":    size,
		},
	})
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
		if wsCwd == "" {
			return []map[string]any{}
		}
		b, err := os.ReadFile(filepath.Join(wsCwd, "byspace.json"))
		if err != nil {
			return []map[string]any{}
		}
		var cfg struct {
			Scripts map[string]any `json:"scripts"`
		}
		if json.Unmarshal(b, &cfg) != nil || cfg.Scripts == nil {
			return []map[string]any{}
		}
		out := make([]map[string]any, 0, len(cfg.Scripts))
		for name, val := range cfg.Scripts {
			cmdStr := ""
			switch v := val.(type) {
			case string:
				cmdStr = v
			case map[string]any:
				cmdStr, _ = v["command"].(string)
			}
			if cmdStr == "" {
				continue
			}
			out = append(out, map[string]any{
				"name":    name,
				"command": cmdStr,
				"status":  "stopped",
			})
		}
		return out
	}

	switch msgType {
	case "start_workspace_script_request":
		var termID any
		if wsCwd != "" {
			for _, sc := range readScripts() {
				if sc["name"] == req.ScriptName {
					cmdStr, _ := sc["command"].(string)
					s.mu.Lock()
					slot := uint8(len(s.terminals) + 1)
					tid := fmt.Sprintf("term_%d", slot)
					if sess, err := terminal.StartSession(terminal.StartOptions{
						ID:          tid,
						Name:        req.ScriptName,
						Cwd:         wsCwd,
						WorkspaceID: req.WorkspaceID,
					}); err == nil {
						s.terminals[slot] = sess
						s.terminalSlotsByID[tid] = slot
						_ = sess.WriteInput([]byte(cmdStr + "\n"))
						termID = tid
					}
					s.mu.Unlock()
					break
				}
			}
		}
		_ = sendSessionMsg(ctx, sink, "start_workspace_script_response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"terminalId":  termID,
			"error":       nil,
		})
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
func worktreeMatches(record store.WorkspaceRecord, worktreePath, resolvedID, repoRoot, branchName string) bool {
	if strings.TrimSpace(worktreePath) != "" {
		// Exact match first, then the workspace that encloses the given path — a caller may pass
		// a subdirectory of the worktree.
		if record.Cwd == worktreePath || (resolvedID != "" && record.WorkspaceID == resolvedID) {
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
