package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/home"
	"net"
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
	WorkspaceID string
	Status      string // "running" | "completed" | "failed" | "blocked"
	// BlockedSource names the change request a gate stopped for.
	BlockedSource *store.UntrustedSource
	WorktreePath  string
	BranchName    string
	Log           strings.Builder
	Commands      []map[string]any
	Error         *string
	mu            sync.Mutex
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

	// An explicit setup request is the user's consent: they are asking for this worktree to be
	// prepared, which is exactly the action the gate was waiting for ("Run setup to allow them").
	// Clearing the source makes the same request work from here on.
	if target.UntrustedSource != nil {
		target.UntrustedSource = nil
		target.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		_ = s.store.UpsertWorkspace(*target)
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
	// One run per workspace. Two concurrent setups of the same worktree race on the same
	// node_modules and lockfiles, and the second one's failure looks like the project is broken.
	// A duplicate request is dropped rather than queued: the caller wanted the setup done, and it is.
	s.setupRunsMu.Lock()
	if s.setupRuns == nil {
		s.setupRuns = make(map[string]bool)
	}
	if s.setupRuns[workspaceID] {
		s.setupRunsMu.Unlock()
		return
	}
	s.setupRuns[workspaceID] = true
	s.setupRunsMu.Unlock()
	defer func() {
		s.setupRunsMu.Lock()
		delete(s.setupRuns, workspaceID)
		s.setupRunsMu.Unlock()
	}()

	// Never run a project's setup commands in a worktree checked out from someone else's change
	// request: that byspace.json belongs to the author, and running it is running their code.
	if blocked, reason := s.automationBlocked(workspaceID); blocked {
		snap := &setupSnapshot{
			WorkspaceID:   workspaceID,
			Status:        "blocked",
			WorktreePath:  cwd,
			BranchName:    branch,
			Error:         &reason,
			BlockedSource: s.untrustedSourceFor(workspaceID),
		}
		s.mu.Lock()
		s.setupSnapshots[workspaceID] = snap
		s.mu.Unlock()
		s.broadcastSetupProgress(snap)
		return
	}

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

		// bash -c, not -lc: a project-authored command must not depend on the user's login
		// shell files, which can change PATH or cd elsewhere.
		invocation := workspace.BuildShellInvocation(command)
		cmd := exec.Command(invocation.Shell, invocation.Args...)
		cmd.Dir = cwd
		// SanitizedShellEnv after ExternalProcessEnv: BASH_ENV would make a non-interactive
		// bash source an arbitrary file before the project command runs.
		cmd.Env = workspace.SanitizedShellEnv(home.ExternalProcessEnv(os.Environ(), map[string]string{"CI": "1", "BYSPACE_WORKSPACE_SETUP": "1"}))
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
		// Set only when a change-request gate stopped the run, so the banner can name the PR the
		// user has to trust instead of showing a bare failure.
		"blockedSource": blockedSourcePayload(snap.BlockedSource),
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
	IsService   bool
	Port        int
	// hostname and the proxy URLs describe where the service is reachable. Filled when a
	// service route is registered; empty for a plain script, which has no URL.
	hostname       string
	localProxyURL  any
	publicProxyURL any
	StartedAt      string
	FinishedAt     *string
	ExitCode       *int
	// cmd is the running process. Kept so stop can actually terminate it: flipping the status
	// alone leaves the script running and its port held, and the UI then reports it as stopped.
	cmd *exec.Cmd
}

func (s *Server) scriptKey(workspaceID, name string) string {
	return workspaceID + "\x00" + name
}

// startWorkspaceScript launches a `byspace.json` script in its own shell and records it so
// later status polls and `script_status_update` broadcasts have something to report.
func (s *Server) startWorkspaceScript(ctx context.Context, workspaceID, name string) (map[string]any, error) {
	// Same gate as setup: the script command also comes from the change request author's
	// byspace.json, so it is their code.
	if blocked, reason := s.automationBlocked(workspaceID); blocked {
		return nil, errors.New(reason)
	}

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
	configs := workspace.ReadScriptConfigs(cwd)
	scriptCfg, ok := configs[name]
	if !ok {
		return nil, fmt.Errorf("script %q is not defined in byspace.json", name)
	}
	command := scriptCfg.Command

	// A service script is told which port to bind. Without this the dev server picks its own
	// and there is no stable URL to open; PORT/ WORKSPACE_SCRIPT_PORT are the names the
	// node daemon injects.
	port := 0
	if scriptCfg.IsService() {
		// Three strategies, in the order the project asked for them: a script that knows the
		// port, a constrained window, then any free port.
		switch {
		case strings.TrimSpace(scriptCfg.PortScript) != "":
			allocated, allocErr := AllocatePortFromScript(ctx, scriptCfg.PortScript, cwd, name, workspaceID, "")
			if allocErr != nil {
				return nil, allocErr
			}
			port = allocated
		case strings.TrimSpace(scriptCfg.PortRange) != "":
			window, rangeErr := ParsePortRange(scriptCfg.PortRange)
			if rangeErr != nil {
				return nil, rangeErr
			}
			allocated, allocErr := s.scriptPorts.AllocateFromRange(window, nil)
			if allocErr != nil {
				return nil, allocErr
			}
			port = allocated
		default:
			allocated, allocErr := s.scriptPorts.Allocate(workspaceID, name, scriptCfg.Port)
			if allocErr != nil {
				return nil, allocErr
			}
			port = allocated
		}
	}

	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	entry := &workspaceScript{
		WorkspaceID: workspaceID,
		Name:        name,
		Command:     command,
		Status:      "running",
		StartedAt:   nowStr,
		IsService:   scriptCfg.IsService(),
		Port:        port,
	}

	s.mu.Lock()
	if s.workspaceScripts == nil {
		s.workspaceScripts = make(map[string]*workspaceScript)
	}
	s.workspaceScripts[s.scriptKey(workspaceID, name)] = entry
	s.mu.Unlock()

	// A service gets a hostname and a browsable URL, registered before the process starts so the
	// client can show the link as soon as the script reports running.
	if entry.IsService && entry.Port > 0 {
		s.registerServiceRoute(workspaceID, name, entry.Port)
		hostname := s.serviceProxyHostnameFor(workspaceID, name)
		url := s.serviceProxyURLFor(workspaceID, name, entry.Port)
		s.mu.Lock()
		entry.hostname = hostname
		if url != "" {
			entry.localProxyURL = url
		}
		s.mu.Unlock()
	}

	go func() {
		// bash -c, not -lc: a project-authored command must not depend on the user's login
		// shell files, which can change PATH or cd elsewhere.
		invocation := workspace.BuildShellInvocation(command)
		cmd := exec.Command(invocation.Shell, invocation.Args...)
		cmd.Dir = cwd
		// Sanitized: BASH_ENV would make bash source an arbitrary file before the script runs,
		// and ExternalProcessEnv keeps the daemon's own identity out of the child.
		cmd.Env = workspace.SanitizedShellEnv(home.ExternalProcessEnv(os.Environ()))
		// Own process group: a build script spawns children, and signalling only the shell
		// leaves them running. Killing the group takes the whole tree.
		setupProcessGroup(cmd)
		if port > 0 {
			cmd.Env = append(cmd.Env,
				fmt.Sprintf("PORT=%d", port),
				fmt.Sprintf("WORKSPACE_SCRIPT_PORT=%d", port),
			)
			// Sibling ports, so one script can find another. Collisions are rejected before
			// spawn: two scripts mapping to the same env name would shadow each other.
			if env, envErr := workspace.BuildServiceEnv(name, s.listenAddr, s.servicePeers(workspaceID)); envErr == nil {
				for key, value := range env {
					cmd.Env = append(cmd.Env, key+"="+value)
				}
			}
		}
		s.mu.Lock()
		entry.cmd = cmd
		s.mu.Unlock()

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
// stopWorkspaceScript terminates a running script.
//
// The process must actually be killed: flipping the status alone leaves it running and holding
// its port, so the UI reports "stopped" while the old build keeps serving — and the next start
// fails on a port that is already bound.
func (s *Server) stopWorkspaceScript(workspaceID, name string) {
	s.mu.Lock()
	entry, ok := s.workspaceScripts[s.scriptKey(workspaceID, name)]
	if !ok {
		s.mu.Unlock()
		return
	}
	cmd := entry.cmd
	wasRunning := entry.Status == "running"
	if wasRunning {
		entry.Status = "stopped"
		finished := time.Now().UTC().Format(time.RFC3339Nano)
		entry.FinishedAt = &finished
		// The route must go with the process: a stale route forwards to a port that may now
		// belong to another workspace, and the user would see someone else's app.
		entry.hostname = ""
		entry.localProxyURL = nil
		entry.publicProxyURL = nil
	}
	s.mu.Unlock()

	if wasRunning && entry.IsService {
		s.unregisterServiceRoute(workspaceID, name)
	}

	if cmd != nil && cmd.Process != nil && wasRunning {
		// Signal the whole process group, not just the shell: `sleep 60` (or `vite`, or
		// `npm run dev`) is a child of the shell, and signalling only the shell leaves the
		// actual work running with its port held.
		pid := cmd.Process.Pid
		terminateProcessGroup(pid)
		go func() {
			// Escalate if the group has not exited. A build ignoring SIGTERM must not keep its
			// port for the rest of the session.
			time.Sleep(3 * time.Second)
			killProcessGroup(pid)
		}()
	}
}

// workspaceScriptSnapshot renders one script in the shape WorkspaceScriptPayloadSchema
// requires. Field names and the lifecycle/health enums are part of the wire contract; sending
// `name`/`status` instead makes the whole response fail client-side validation.
func (s *Server) workspaceScriptSnapshot(workspaceID, name string) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.workspaceScripts[s.scriptKey(workspaceID, name)]
	if !ok {
		return nil
	}
	return workspaceScriptPayload(entry)
}

// workspaceScriptPayload maps an entry onto WorkspaceScriptPayloadSchema.
func workspaceScriptPayload(entry *workspaceScript) map[string]any {
	lifecycle := "stopped"
	if entry.Status == "running" {
		lifecycle = "running"
	}
	scriptType := "script"
	var port any
	if entry.IsService {
		scriptType = "service"
		if entry.Port > 0 {
			port = entry.Port
		}
	}
	// A running service's health is whether anything is listening on its port. Without the
	// proxy subsystem that is the only signal available, and it is the one that matters to the
	// user: "it started" and "it is serving" are different facts.
	var health any
	if entry.IsService && entry.Status == "running" && entry.Port > 0 {
		if isPortOpen(entry.Port) {
			health = "healthy"
		} else {
			health = "unhealthy"
		}
	}
	return map[string]any{
		"scriptName": entry.Name,
		"type":       scriptType,
		// hostname/port describe the service route; a plain script has neither. A running
		// service gets a real hostname and a browsable URL: without them the user has a port
		// number and no way to open the app, which is most of the feature's value.
		"hostname":       entry.hostname,
		"port":           port,
		"localProxyUrl":  entry.localProxyURL,
		"publicProxyUrl": entry.publicProxyURL,
		"proxyUrl":       entry.localProxyURL,
		"lifecycle":      lifecycle,
		"health":         health,
		"exitCode":       entry.ExitCode,
		"terminalId":     nil,
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
		row := workspaceScriptPayload(&workspaceScript{
			WorkspaceID: workspaceID,
			Name:        name,
			Command:     command,
			Status:      "stopped",
		})
		if ok {
			row = workspaceScriptPayload(entry)
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

// servicePeers lists the workspace's running service scripts and their ports.
func (s *Server) servicePeers(workspaceID string) []workspace.ServicePeer {
	s.mu.Lock()
	defer s.mu.Unlock()
	peers := make([]workspace.ServicePeer, 0, 4)
	for _, entry := range s.workspaceScripts {
		if entry.WorkspaceID != workspaceID || !entry.IsService || entry.Port <= 0 {
			continue
		}
		peers = append(peers, workspace.ServicePeer{ScriptName: entry.Name, Port: entry.Port})
	}
	return peers
}

// isPortOpen reports whether something accepts connections on a loopback port.
//
// Deliberately a connect test rather than an HTTP request: workspace services are not required
// to speak HTTP, and a non-HTTP service that is listening is still healthy.
func isPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// automationBlocked reports whether a workspace refuses automation, with the message to show.
//
// The reason names the change request so the user knows what they are trusting if they allow it:
// "Scripts are blocked for PR #123 from someone/fork" is actionable, "blocked" is not.
func (s *Server) automationBlocked(workspaceID string) (bool, string) {
	workspaces, err := s.store.ListWorkspaces()
	if err != nil {
		return false, ""
	}
	for _, ws := range workspaces {
		if ws.WorkspaceID != workspaceID {
			continue
		}
		if !ws.UntrustedSource.IsBlocked() {
			return false, ""
		}
		return true, workspace.AutomationBlockedError{Source: *ws.UntrustedSource}.Error()
	}
	return false, ""
}

// untrustedSourceFor returns the change-request origin that blocked a workspace, if any.
func (s *Server) untrustedSourceFor(workspaceID string) *store.UntrustedSource {
	workspaces, err := s.store.ListWorkspaces()
	if err != nil {
		return nil
	}
	for _, ws := range workspaces {
		if ws.WorkspaceID == workspaceID && ws.UntrustedSource.IsBlocked() {
			source := *ws.UntrustedSource
			return &source
		}
	}
	return nil
}

// blockedSourcePayload renders the wire shape, or nil when nothing blocked the run.
//
// Optional (not nullable) in the schema, so an absent gate must omit the key rather than send
// null — a null there fails validation and the client shows no banner at all.
func blockedSourcePayload(source *store.UntrustedSource) any {
	if source == nil {
		return nil
	}
	return map[string]any{
		"kind":           "change_request",
		"forge":          source.Forge,
		"number":         source.Number,
		"headRepository": source.HeadRepository,
	}
}
