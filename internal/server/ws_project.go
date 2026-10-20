package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

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
	prj, _, err := s.store.EnsureWorkspaceForCwd(cwd)
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
		RequestID       string `json:"requestId"`
		ParentDirectory string `json:"parentDirectory"`
		Name            string `json:"name"`
	}
	_ = json.Unmarshal(raw, &req)
	name := strings.TrimSpace(req.Name)
	if name == "" || strings.ContainsAny(name, `/\`) {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         "Invalid directory name",
			"errorCode":     "invalid_name",
		})
		return
	}
	parent := expandUserPath(req.ParentDirectory)
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
	if err := os.MkdirAll(target, 0o755); err != nil {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": nil,
			"project":       nil,
			"error":         err.Error(),
			"errorCode":     "filesystem_error",
		})
		return
	}
	prj, _, err := s.store.EnsureWorkspaceForCwd(target)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "project.create_directory.response", map[string]any{
			"requestId":     req.RequestID,
			"directoryPath": target,
			"project":       nil,
			"error":         err.Error(),
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
	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	includeFiles := req.IncludeFiles == nil || *req.IncludeFiles
	includeDirs := req.IncludeDirs == nil || *req.IncludeDirs
	matchMode := strings.ToLower(strings.TrimSpace(req.MatchMode))
	if matchMode == "" {
		matchMode = "prefix"
	}

	baseDir := expandUserPath(req.Cwd)
	if strings.TrimSpace(req.Cwd) == "" {
		baseDir, _ = os.UserHomeDir()
	}
	queryPath := expandUserPath(req.Query)
	searchDir := baseDir
	prefix := ""
	if strings.HasPrefix(strings.TrimSpace(req.Query), "/") || strings.HasPrefix(strings.TrimSpace(req.Query), "~") {
		if info, err := os.Stat(queryPath); err == nil && info.IsDir() {
			searchDir = queryPath
		} else {
			searchDir = filepath.Dir(queryPath)
			prefix = strings.ToLower(filepath.Base(queryPath))
		}
	} else if strings.TrimSpace(req.Query) != "" {
		prefix = strings.ToLower(strings.TrimSpace(req.Query))
	}

	matches := func(name string) bool {
		if matchMode == "contains" {
			return strings.Contains(name, prefix)
		}
		return strings.HasPrefix(name, prefix)
	}
	dirEntries, _ := os.ReadDir(searchDir)
	dirs := make([]string, 0)
	entries := make([]map[string]any, 0)
	for _, de := range dirEntries {
		name := de.Name()
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(prefix, ".") {
			continue
		}
		if prefix != "" && !matches(strings.ToLower(name)) {
			continue
		}
		fullPath := filepath.Join(searchDir, name)
		if de.IsDir() {
			if !includeDirs {
				continue
			}
			dirs = append(dirs, fullPath)
			entries = append(entries, map[string]any{"path": fullPath, "kind": "directory"})
		} else {
			if !includeFiles {
				continue
			}
			entries = append(entries, map[string]any{"path": fullPath, "kind": "file"})
		}
		if len(entries) >= limit {
			break
		}
	}

	_ = sendSessionMsg(ctx, sink, "directory_suggestions_response", map[string]any{
		"requestId":   req.RequestID,
		"directories": dirs,
		"entries":     entries,
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
		}
		_ = json.Unmarshal(raw, &req)
		workspaces, _ := s.store.ListWorkspaces()
		for _, w := range workspaces {
			if w.Cwd == req.WorktreePath {
				_, _ = s.store.ArchiveWorkspace(w.WorkspaceID, now)
			}
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
	if _, err := s.store.ArchiveWorkspace(req.WorkspaceID, now); err != nil {
		_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"archivedAt":  nil,
			"error":       err.Error(),
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "archive_workspace_response", map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"archivedAt":  now,
		"error":       nil,
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
		_ = sendSessionMsg(ctx, sink, "workspace.mark_unread.response", map[string]any{
			"requestId":     req.RequestID,
			"workspaceId":   req.WorkspaceID,
			"markedAgentId": nil,
			"success":       true,
			"error":         nil,
		})
		return
	}
	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID any    `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)
	_ = sendSessionMsg(ctx, sink, "workspace.clear_attention.response", map[string]any{
		"requestId":       req.RequestID,
		"workspaceId":     req.WorkspaceID,
		"clearedAgentIds": []string{},
		"results":         []any{},
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
		labels, _ := s.store.ListLabels()
		_ = sendSessionMsg(ctx, sink, "workspace.label.list.response", map[string]any{
			"requestId": base.RequestID,
			"labels":    labels,
			"sync": map[string]any{
				"mode":       "snapshot",
				"generation": "gen_1",
				"headSeq":    len(labels),
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

	b, _ := json.MarshalIndent(req.Config, "", "  ")
	_ = home.WriteAtomic(cfgPath, append(b, '\n'), 0o644)
	_ = sendSessionMsg(ctx, sink, "write_project_config_response", map[string]any{
		"requestId": req.RequestID,
		"repoRoot":  req.RepoRoot,
		"ok":        true,
		"config":    req.Config,
		"revision": map[string]any{
			"mtimeMs": time.Now().UnixMilli(),
			"size":    len(b) + 1,
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
		_ = sendSessionMsg(ctx, sink, "workspace.script.start.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"script":      nil,
			"error":       nil,
		})
	case "workspace.script.stop.request":
		_ = sendSessionMsg(ctx, sink, "workspace.script.stop.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"scriptName":  req.ScriptName,
			"script":      nil,
			"error":       nil,
		})
	}
}

func (s *Server) handleEditors(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		EditorID  string `json:"editorId"`
		Path      string `json:"path"`
	}
	_ = json.Unmarshal(raw, &req)
	if msgType == "list_available_editors_request" {
		editors := make([]map[string]any, 0)
		for _, cand := range []struct{ id, label string }{
			{"cursor", "Cursor"},
			{"code", "VS Code"},
			{"zed", "Zed"},
		} {
			if _, err := exec.LookPath(cand.id); err == nil {
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
	if req.EditorID != "" && req.Path != "" {
		_ = exec.Command(req.EditorID, req.Path).Start()
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
		var req struct {
			RequestID  string   `json:"requestId"`
			Name       string   `json:"name"`
			MimeType   string   `json:"mimeType"`
			Data       string   `json:"data"`
			ModifiedAt *float64 `json:"modifiedAt"`
		}
		_ = json.Unmarshal(raw, &req)
		decoded, err := base64.StdEncoding.DecodeString(req.Data)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "file.upload.response", map[string]any{
				"requestId": req.RequestID,
				"file":      nil,
				"error":     err.Error(),
			})
			return
		}
		uploadDir := filepath.Join(s.homeDir, "uploads")
		_ = os.MkdirAll(uploadDir, 0o700)
		safeName := filepath.Base(req.Name)
		if safeName == "" || safeName == "." {
			safeName = "upload.bin"
		}
		dst := filepath.Join(uploadDir, safeName)
		_ = os.WriteFile(dst, decoded, 0o600)
		if req.ModifiedAt != nil && *req.ModifiedAt > 0 {
			mtime := time.UnixMilli(int64(*req.ModifiedAt))
			_ = os.Chtimes(dst, mtime, mtime)
		}
		var idBytes [8]byte
		_, _ = rand.Read(idBytes[:])
		_ = sendSessionMsg(ctx, sink, "file.upload.response", map[string]any{
			"requestId": req.RequestID,
			"file": map[string]any{
				"type":     "uploaded_file",
				"id":       "up_" + hex.EncodeToString(idBytes[:]),
				"fileName": safeName,
				"mimeType": req.MimeType,
				"size":     len(decoded),
				"path":     dst,
			},
			"error": nil,
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
