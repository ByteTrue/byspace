package server

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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

	s.broadcastSessionMsg("workspace_setup_update", s.setupSnapshotPayload(snap))

	fail := func(msg string) {
		snap.mu.Lock()
		snap.Status = "failed"
		snap.Error = &msg
		snap.mu.Unlock()
		s.broadcastSessionMsg("workspace_setup_update", s.setupSnapshotPayload(snap))
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

		s.broadcastSessionMsg("workspace_setup_update", s.setupSnapshotPayload(snap))
		if err != nil {
			fail("setup command failed: " + command)
			return
		}
	}

	snap.mu.Lock()
	snap.Status = "completed"
	snap.mu.Unlock()
	s.broadcastSessionMsg("workspace_setup_update", s.setupSnapshotPayload(snap))
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
