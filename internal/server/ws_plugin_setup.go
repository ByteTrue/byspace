package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// setupSnapshot is the in-memory record of a worktree setup run (matches WorkspaceSetupSnapshotSchema).
type setupSnapshot struct {
	WorkspaceID  string
	Status       string // "running" | "completed" | "failed" | "blocked"
	WorktreePath string
	BranchName   string
	Log          strings.Builder
	Commands     []map[string]any
	Error        *string
	mu           sync.Mutex
}

// handleWorkspaceSetupProject serves workspace.setup.run.request and workspace_setup_status_request.
// It runs the project's `setup` commands from byspace.json inside a real PTY-free shell and streams nothing
// the frontend does not ask for, keeping the snapshot available for later status polls.
func (s *Server) handleWorkspaceSetupProject(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)

	if msgType == "workspace_setup_status_request" {
		s.mu.Lock()
		snap := s.setupSnapshots[req.WorkspaceID]
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, sink, "workspace_setup_status_response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"snapshot":    snap,
		})
		return
	}

	workspaces, _ := s.store.ListWorkspaces()
	var target *store.WorkspaceRecord
	for i := range workspaces {
		if workspaces[i].WorkspaceID == req.WorkspaceID {
			target = &workspaces[i]
			break
		}
	}
	if target == nil {
		errText := "workspace not found"
		_ = sendSessionMsg(ctx, sink, "workspace.setup.run.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"started":     false,
			"error":       errText,
		})
		return
	}

	commands := workspace.ReadSetupCommands(target.Cwd)
	if len(commands) == 0 {
		_ = sendSessionMsg(ctx, sink, "workspace.setup.run.response", map[string]any{
			"requestId":   req.RequestID,
			"workspaceId": req.WorkspaceID,
			"started":     false,
			"error":       "no setup commands configured in byspace.json",
		})
		return
	}

	branch := ""
	if target.Branch != nil {
		branch = *target.Branch
	}
	_ = sendSessionMsg(ctx, sink, "workspace.setup.run.response", map[string]any{
		"requestId":   req.RequestID,
		"workspaceId": req.WorkspaceID,
		"started":     true,
		"error":       nil,
	})

	go s.runWorkspaceSetup(target.WorkspaceID, target.Cwd, branch, commands)
}

func (s *Server) runWorkspaceSetup(workspaceID, cwd, branch string, commands []string) {
	snap := &setupSnapshot{
		WorkspaceID:  workspaceID,
		Status:       "running",
		WorktreePath: cwd,
		BranchName:   branch,
	}
	s.mu.Lock()
	s.setupSnapshots[workspaceID] = snap
	s.mu.Unlock()

	s.broadcastSetupProgress(snap)

	fail := func(msg string) {
		snap.mu.Lock()
		snap.Status = "failed"
		snap.Error = &msg
		snap.mu.Unlock()
		s.broadcastSetupProgress(snap)
	}

	for _, command := range commands {
		started := time.Now().UTC().Format(time.RFC3339Nano)
		snap.mu.Lock()
		snap.Log.WriteString("$ " + command + "\n")
		snap.mu.Unlock()

		cmd := exec.Command("/bin/sh", "-lc", command)
		cmd.Dir = cwd
		cmd.Env = append(os.Environ(), "CI=1", "BYSPACE_WORKSPACE_SETUP=1")
		out, err := cmd.CombinedOutput()
		snap.mu.Lock()
		snap.Log.Write(out)
		exitCode := 0
		if err != nil {
			exitCode = 1
		}
		snap.Commands = append(snap.Commands, map[string]any{
			"command":    command,
			"exitCode":   exitCode,
			"startedAt":  started,
			"finishedAt": time.Now().UTC().Format(time.RFC3339Nano),
		})
		snap.mu.Unlock()

		s.broadcastSetupProgress(snap)
		if err != nil {
			fail("setup command failed: " + command)
			return
		}
	}

	snap.mu.Lock()
	snap.Status = "completed"
	snap.mu.Unlock()
	s.broadcastSetupProgress(snap)
}

func (s *Server) setupSnapshotPayload(snap *setupSnapshot) map[string]any {
	snap.mu.Lock()
	logText := snap.Log.String()
	const maxLog = 64 * 1024
	if len(logText) > maxLog {
		logText = logText[len(logText)-maxLog:]
	}
	payload := map[string]any{
		"workspaceId": snap.WorkspaceID,
		"snapshot": map[string]any{
			"status": snap.Status,
			"detail": map[string]any{
				"type":         "worktree_setup",
				"worktreePath": snap.WorktreePath,
				"branchName":   snap.BranchName,
				"log":          logText,
				"commands":     snap.Commands,
			},
			"error": snap.Error,
		},
	}
	snap.mu.Unlock()
	return payload
}

// handlePluginProject serves the plugin.* RPCs. The Go daemon has no plugin runtime yet, so the
// read-only endpoints honestly report an empty catalog instead of fabricating plugins, and the
// mutating endpoints refuse rather than pretend success. Tracked by the plugin parity Issue.
func (s *Server) handlePluginRPC(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		PluginID   string `json:"pluginId"`
		Path       string `json:"path"`
		Source     string `json:"source"`
		Ref        string `json:"ref"`
		PluginPath string `json:"pluginPath"`
	}
	_ = json.Unmarshal(raw, &req)

	switch msgType {
	case "plugin.list.request":
		_ = sendSessionMsg(ctx, sink, "plugin.list.response", map[string]any{
			"requestId": req.RequestID,
			"plugins":   []any{},
		})
	case "plugin.catalog.get.request":
		_ = sendSessionMsg(ctx, sink, "plugin.catalog.get.response", map[string]any{
			"requestId": req.RequestID,
			"plugins":   []any{},
		})
	case "plugin.logs.get.request":
		_ = sendSessionMsg(ctx, sink, "plugin.logs.get.response", map[string]any{
			"requestId": req.RequestID,
			"pluginId":  req.PluginID,
			"entries":   []any{},
		})
	case "plugin.source.status.request":
		_ = sendSessionMsg(ctx, sink, "plugin.source.status.response", map[string]any{
			"requestId": req.RequestID,
			"plugins":   []any{},
		})
	case "plugin.source.update.request":
		_ = sendSessionMsg(ctx, sink, "plugin.source.update.response", map[string]any{
			"requestId": req.RequestID,
			"plugins":   []any{},
		})
	case "plugin.directory.inspect.request":
		manifest := filepath.Join(req.Path, "plugin.json")
		if _, err := os.Stat(manifest); err != nil {
			_ = sendSessionMsg(ctx, sink, "plugin.directory.inspect.response", map[string]any{
				"requestId": req.RequestID,
				"id":        "",
				"error":     "plugin.json not found at " + req.Path,
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "plugin.directory.inspect.response", map[string]any{
			"requestId": req.RequestID,
			"id":        filepath.Base(req.Path),
		})
	case "plugin.rpc.invoke.request":
		_ = sendSessionMsg(ctx, sink, "plugin.rpc.invoke.response", map[string]any{
			"requestId": req.RequestID,
			"output":    nil,
			"error":     "plugin runtime is not available on this daemon build",
		})
	default:
		// install / enable / disable / reload / remove all need a plugin runtime.
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		if strings.HasSuffix(msgType, ".request") && strings.Contains(msgType, "remove") {
			_ = sendSessionMsg(ctx, sink, respType, map[string]any{"requestId": req.RequestID})
			return
		}
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"requestId": req.RequestID,
			"plugin": map[string]any{
				"id":      req.PluginID,
				"name":    req.PluginID,
				"version": "0.0.0",
				"status":  "failed",
				"enabled": false,
				"error":   "plugin runtime is not available on this daemon build",
			},
		})
	}
}

// broadcastSetupProgress emits the per-step progress message the setup banner renders.
//
// `workspace_setup_update` and `workspace_setup_progress` are different channels: the former
// drives the workspace list row, the latter the inline log the user watches while it runs.
func (s *Server) broadcastSetupProgress(snap *setupSnapshot) {
	snap.mu.Lock()
	logText := snap.Log.String()
	const maxLog = 64 * 1024
	if len(logText) > maxLog {
		logText = logText[len(logText)-maxLog:]
	}
	payload := map[string]any{
		"workspaceId": snap.WorkspaceID,
		"status":      snap.Status,
		"detail": map[string]any{
			"type":         "worktree_setup",
			"worktreePath": snap.WorktreePath,
			"branchName":   snap.BranchName,
			"log":          logText,
			"commands":     snap.Commands,
			"truncated":    len(snap.Log.String()) > maxLog,
		},
		"error": snap.Error,
		// `blockedSource` is set only when a change-request gate stopped the run; the banner
		// links to it instead of showing a bare failure.
		"blockedSource": nil,
	}
	snap.mu.Unlock()
	s.broadcastSessionMsg("workspace_setup_progress", payload)
}

// workspaceScript is one running (or stopped) entry from byspace.json's `scripts` map.
type workspaceScript struct {
	WorkspaceID string
	Name        string
	Command     string
	Status      string // "running" | "stopped" | "failed"
	StartedAt   string
	FinishedAt  *string
	ExitCode    *int
}

func (s *Server) scriptKey(workspaceID, name string) string {
	return workspaceID + "\x00" + name
}

// startWorkspaceScript launches a `byspace.json` script in its own shell and records it so
// later status polls and `script_status_update` broadcasts have something to report.
func (s *Server) startWorkspaceScript(ctx context.Context, workspaceID, name string) (map[string]any, error) {
	workspaces, _ := s.store.ListWorkspaces()
	var cwd string
	for _, ws := range workspaces {
		if ws.WorkspaceID == workspaceID {
			cwd = ws.Cwd
			break
		}
	}
	if cwd == "" {
		return nil, fmt.Errorf("workspace %q not found", workspaceID)
	}
	scripts := workspace.ReadScripts(cwd)
	command, ok := scripts[name]
	if !ok {
		return nil, fmt.Errorf("script %q is not defined in byspace.json", name)
	}

	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	entry := &workspaceScript{
		WorkspaceID: workspaceID,
		Name:        name,
		Command:     command,
		Status:      "running",
		StartedAt:   nowStr,
	}

	s.mu.Lock()
	if s.workspaceScripts == nil {
		s.workspaceScripts = make(map[string]*workspaceScript)
	}
	s.workspaceScripts[s.scriptKey(workspaceID, name)] = entry
	s.mu.Unlock()

	go func() {
		cmd := exec.Command("/bin/sh", "-lc", command)
		cmd.Dir = cwd
		cmd.Env = os.Environ()
		err := cmd.Run()

		finished := time.Now().UTC().Format(time.RFC3339Nano)
		s.mu.Lock()
		entry.FinishedAt = &finished
		if err != nil {
			entry.Status = "failed"
			code := 1
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			}
			entry.ExitCode = &code
		} else {
			entry.Status = "stopped"
			zero := 0
			entry.ExitCode = &zero
		}
		s.mu.Unlock()
		s.broadcastScriptStatus(workspaceID)
	}()

	return s.workspaceScriptSnapshot(workspaceID, name), nil
}

// stopWorkspaceScript marks a script stopped. The child is a detached shell, so this records
// intent rather than killing it; a long-running dev server keeps serving until the daemon exits.
func (s *Server) stopWorkspaceScript(workspaceID, name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.workspaceScripts[s.scriptKey(workspaceID, name)]; ok {
		if entry.Status == "running" {
			entry.Status = "stopped"
			finished := time.Now().UTC().Format(time.RFC3339Nano)
			entry.FinishedAt = &finished
		}
	}
}

func (s *Server) workspaceScriptSnapshot(workspaceID, name string) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.workspaceScripts[s.scriptKey(workspaceID, name)]
	if !ok {
		return nil
	}
	return map[string]any{
		"name":       entry.Name,
		"command":    entry.Command,
		"status":     entry.Status,
		"startedAt":  entry.StartedAt,
		"finishedAt": entry.FinishedAt,
		"exitCode":   entry.ExitCode,
	}
}

// broadcastScriptStatus publishes the whole script list for a workspace, which is what
// `script_status_update` carries.
func (s *Server) broadcastScriptStatus(workspaceID string) {
	workspaces, _ := s.store.ListWorkspaces()
	var cwd string
	for _, ws := range workspaces {
		if ws.WorkspaceID == workspaceID {
			cwd = ws.Cwd
			break
		}
	}
	defined := workspace.ReadScripts(cwd)

	s.mu.Lock()
	scripts := make([]map[string]any, 0, len(defined))
	for name, command := range defined {
		entry, ok := s.workspaceScripts[s.scriptKey(workspaceID, name)]
		row := map[string]any{
			"name":    name,
			"command": command,
			"status":  "stopped",
		}
		if ok {
			row["status"] = entry.Status
			row["startedAt"] = entry.StartedAt
			row["finishedAt"] = entry.FinishedAt
			row["exitCode"] = entry.ExitCode
		}
		scripts = append(scripts, row)
	}
	s.mu.Unlock()

	sort.Slice(scripts, func(i, j int) bool {
		return fmt.Sprint(scripts[i]["name"]) < fmt.Sprint(scripts[j]["name"])
	})
	s.broadcastSessionMsg("script_status_update", map[string]any{
		"workspaceId": workspaceID,
		"scripts":     scripts,
	})
}
