package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ByteTrue/byspace/internal/agent/toolpolicy"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

type mcpRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params"`
}

func (s *Server) handleMCPHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// This endpoint is exempt from the global password middleware because an agent's own MCP
	// bridge cannot know the user's password; it authorizes itself with the per-run capability
	// token (or a password bearer, for callers that do have one).
	if !IsAgentMCPRequestAuthorized(s.daemonPasswordHash(), s.capabilityToken, r.Header.Get("Authorization")) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
		return
	}
	var req mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON-RPC payload", http.StatusBadRequest)
		return
	}

	// The bridge names its agent so that provider's tool policy applies. Without it the
	// daemon would have to allow every tool for every caller.
	resp := s.executeMCPRequestForAgent(r.Context(), req, r.Header.Get("X-BySpace-Agent-Id"))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// ExecuteMCPRequest handles an MCP JSON-RPC 2.0 request (initialize, tools/list, tools/call).
func (s *Server) ExecuteMCPRequest(ctx context.Context, req mcpRequest) map[string]any {
	return s.executeMCPRequestForAgent(ctx, req, "")
}

// executeMCPRequestForAgent applies the requesting agent's tool policy.
//
// A policy is per provider, and the daemon only sees the tool call — not who asked. The bridge
// passes its agent id so a tool the user disabled is refused at the boundary rather than merely
// hidden from the list, which a determined prompt could work around.
func (s *Server) executeMCPRequestForAgent(ctx context.Context, req mcpRequest, agentID string) map[string]any {
	policy := s.bySpaceToolPolicyFor(agentID)

	switch req.Method {
	case "initialize":
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]any{
				"protocolVersion": "2024-11-05",
				"serverInfo": map[string]any{
					"name":    "byspace-go-mcp",
					"version": s.version,
				},
				"capabilities": map[string]any{
					"tools": map[string]any{},
				},
			},
		}

	case "tools/list":
		definitions := mcpToolDefinitions()
		if policy != nil {
			filtered := make([]map[string]any, 0, len(definitions))
			for _, definition := range definitions {
				name, _ := definition["name"].(string)
				if toolpolicy.IsToolEnabled(policy, name) {
					filtered = append(filtered, definition)
				}
			}
			definitions = filtered
		}
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]any{
				"tools": definitions,
			},
		}

	case "tools/call":
		name, _ := req.Params["name"].(string)
		if !toolpolicy.IsToolEnabled(policy, name) {
			// Refused at the boundary, not just hidden: a hidden tool is still callable by name.
			return map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"error": map[string]any{
					"code":    -32601,
					"message": "Tool " + name + " is disabled for this provider",
				},
			}
		}
		args, _ := req.Params["arguments"].(map[string]any)
		out, isErr := s.callMCPTool(ctx, name, args)
		b, _ := json.MarshalIndent(out, "", "  ")
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]any{
				"isError": isErr,
				"content": []map[string]any{
					{
						"type": "text",
						"text": string(b),
					},
				},
			},
		}

	default:
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]any{},
		}
	}
}

func mcpToolDef(name, desc string, props map[string]any, required ...string) map[string]any {
	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return map[string]any{
		"name":        name,
		"description": desc,
		"inputSchema": schema,
	}
}

// mcpToolDefinitions returns the complete catalog of 37 BySpace orchestration MCP tools
// matching packages/server/src/server/agent/tools/byspace-tools.ts.
func mcpToolDefinitions() []map[string]any {
	strProp := map[string]any{"type": "string"}
	numProp := map[string]any{"type": "number"}
	return []map[string]any{
		// Workspaces & Git
		mcpToolDef("create_workspace", "Create a new workspace or git worktree.", map[string]any{"cwd": strProp, "slug": strProp, "baseRef": strProp, "title": strProp}),
		mcpToolDef("list_workspaces", "List active workspaces.", map[string]any{"projectId": strProp}),
		mcpToolDef("archive_workspace", "Archive a workspace and everything it owns.", map[string]any{"workspaceId": strProp}, "workspaceId"),
		mcpToolDef("rename_workspace", "Set or clear a workspace title.", map[string]any{"workspaceId": strProp, "title": strProp}, "workspaceId"),
		mcpToolDef("rename_branch", "Rename the current git branch in a workspace.", map[string]any{"cwd": strProp, "newName": strProp}, "cwd", "newName"),

		// Agents
		mcpToolDef("create_agent", "Create and launch a new agent in the specified working directory.", map[string]any{"cwd": strProp, "initialPrompt": strProp, "title": strProp, "model": strProp, "thinking": strProp}),
		mcpToolDef("send_agent_prompt", "Send a follow-up prompt to an existing agent.", map[string]any{"agentId": strProp, "prompt": strProp}, "agentId", "prompt"),
		mcpToolDef("send_agent_message", "Alias for send_agent_prompt.", map[string]any{"agentId": strProp, "prompt": strProp}, "agentId", "prompt"),
		mcpToolDef("get_agent_status", "Inspect the current lifecycle status and latest reply of an agent.", map[string]any{"agentId": strProp}, "agentId"),
		mcpToolDef("get_agent_activity", "Inspect recent timeline activity of an agent.", map[string]any{"agentId": strProp, "limit": numProp}, "agentId"),
		mcpToolDef("list_agents", "List agents managed by BySpace, optionally scoped to a working directory.", map[string]any{"cwd": strProp}),
		mcpToolDef("cancel_agent", "Abort the agent's current run.", map[string]any{"agentId": strProp}, "agentId"),
		mcpToolDef("archive_agent", "Archive an agent session.", map[string]any{"agentId": strProp}, "agentId"),
		mcpToolDef("kill_agent", "Terminate and delete an agent session permanently.", map[string]any{"agentId": strProp}, "agentId"),
		mcpToolDef("update_agent", "Update an agent's title, model, or thinking level.", map[string]any{"agentId": strProp, "name": strProp, "model": strProp, "thinking": strProp}, "agentId"),
		mcpToolDef("set_agent_mode", "Update an agent's execution mode.", map[string]any{"agentId": strProp, "modeId": strProp}, "agentId", "modeId"),
		mcpToolDef("list_pending_permissions", "List pending interactive questions/permissions for an agent.", map[string]any{"agentId": strProp}),
		mcpToolDef("respond_to_permission", "Respond to a pending permission or question prompt.", map[string]any{"agentId": strProp, "requestId": strProp, "answer": strProp}, "agentId", "requestId"),
		mcpToolDef("wait_for_finish", "Wait for an agent's active turn to complete and return its final assistant reply.", map[string]any{"agentId": strProp, "timeoutMs": numProp}, "agentId"),

		// Workspace Scripts & Terminals
		mcpToolDef("list_workspace_scripts", "List scripts configured in byspace.json for a workspace.", map[string]any{"workspaceId": strProp}, "workspaceId"),
		mcpToolDef("start_workspace_script", "Start a configured workspace script in a supervised terminal.", map[string]any{"workspaceId": strProp, "scriptName": strProp}, "workspaceId", "scriptName"),
		mcpToolDef("stop_workspace_script", "Stop a running workspace script.", map[string]any{"workspaceId": strProp, "scriptName": strProp}, "workspaceId", "scriptName"),
		mcpToolDef("list_terminals", "List active PTY terminals.", map[string]any{"cwd": strProp}),
		mcpToolDef("create_terminal", "Create a new PTY terminal session.", map[string]any{"cwd": strProp, "name": strProp}),
		mcpToolDef("kill_terminal", "Kill an existing PTY terminal session.", map[string]any{"terminalId": strProp}, "terminalId"),
		mcpToolDef("capture_terminal", "Capture recent output lines from a PTY terminal.", map[string]any{"terminalId": strProp}, "terminalId"),
		mcpToolDef("send_terminal_keys", "Send input characters/keys to a PTY terminal.", map[string]any{"terminalId": strProp, "keys": strProp}, "terminalId", "keys"),

		// Schedules & Heartbeats
		mcpToolDef("create_schedule", "Create a recurring scheduled agent run.", map[string]any{"name": strProp, "prompt": strProp, "cron": strProp, "everyMs": numProp, "cwd": strProp}, "prompt"),
		mcpToolDef("create_heartbeat", "Create a recurring heartbeat schedule.", map[string]any{"name": strProp, "prompt": strProp, "cron": strProp, "everyMs": numProp, "cwd": strProp}, "prompt"),
		mcpToolDef("delete_heartbeat", "Delete a heartbeat schedule by ID.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("list_schedules", "List all configured schedules and heartbeats.", map[string]any{}),
		mcpToolDef("inspect_schedule", "Inspect a schedule by ID.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("pause_schedule", "Pause an active schedule.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("resume_schedule", "Resume a paused schedule.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("delete_schedule", "Delete a schedule by ID.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("update_schedule", "Update a schedule's configuration.", map[string]any{"scheduleId": strProp, "prompt": strProp, "name": strProp}, "scheduleId"),
		mcpToolDef("schedule_logs", "Fetch run history logs for a schedule.", map[string]any{"scheduleId": strProp}, "scheduleId"),
		mcpToolDef("run_schedule_once", "Trigger an immediate execution of a schedule.", map[string]any{"scheduleId": strProp}, "scheduleId"),

		// Providers & Models
		mcpToolDef("list_providers", "List available agent providers.", map[string]any{}),
		mcpToolDef("list_models", "List available models for a provider.", map[string]any{"provider": strProp}),
		mcpToolDef("list_profiles", "List configured provider profiles.", map[string]any{}),
		mcpToolDef("inspect_provider", "Inspect provider status and diagnostics.", map[string]any{"provider": strProp}),
	}
}

func (s *Server) callMCPTool(ctx context.Context, name string, args map[string]any) (any, bool) {
	switch name {
	case "create_workspace":
		cwd, _ := args["cwd"].(string)
		slug, _ := args["slug"].(string)
		baseRef, _ := args["baseRef"].(string)
		if cwd == "" {
			cwd, _ = os.Getwd()
		}
		if slug != "" {
			wtBase := filepath.Join(s.homeDir, "worktrees")
			if wtPath, _, err := workspace.CreateWorktree(ctx, cwd, wtBase, slug, baseRef); err == nil {
				cwd = wtPath
			}
		}
		prj, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"workspace": buildWorkspaceDescriptor(ws, prj)}, false

	case "list_workspaces":
		projectID, _ := args["projectId"].(string)
		projects, _ := s.store.ListProjects()
		prjByID := make(map[string]store.ProjectRecord, len(projects))
		for _, p := range projects {
			prjByID[p.ProjectID] = p
		}
		workspaces, _ := s.store.ListWorkspaces()
		out := make([]map[string]any, 0, len(workspaces))
		for _, w := range workspaces {
			if w.ArchivedAt != nil {
				continue
			}
			if projectID != "" && w.ProjectID != projectID {
				continue
			}
			if p, ok := prjByID[w.ProjectID]; ok {
				out = append(out, buildWorkspaceDescriptor(w, p))
			}
		}
		return map[string]any{"workspaces": out}, false

	case "archive_workspace":
		wsID, _ := args["workspaceId"].(string)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := s.store.ArchiveWorkspace(wsID, now); err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"workspaceId": wsID, "archivedAt": now}, false

	case "rename_workspace":
		wsID, _ := args["workspaceId"].(string)
		title, _ := args["title"].(string)
		workspaces, _ := s.store.ListWorkspaces()
		for _, w := range workspaces {
			if w.WorkspaceID == wsID {
				t := strings.TrimSpace(title)
				w.Title = &t
				w.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				_ = s.store.UpsertWorkspace(w)
				return map[string]any{"workspaceId": wsID, "title": t}, false
			}
		}
		return map[string]any{"error": "workspace not found"}, true

	case "rename_branch":
		cwd, _ := args["cwd"].(string)
		newName, _ := args["newName"].(string)
		cur, err := workspace.RenameBranch(ctx, cwd, newName)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"cwd": cwd, "currentBranch": cur}, false

	case "list_agents":
		cwdFilter, _ := args["cwd"].(string)
		if cwdFilter != "" {
			if abs, err := filepath.Abs(cwdFilter); err == nil {
				cwdFilter = abs
			}
		}
		records, err := s.store.ListAgents()
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		out := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			if cwdFilter != "" && !strings.HasPrefix(rec.Cwd, cwdFilter) {
				continue
			}
			out = append(out, s.buildAgentSnapshotPayload(rec))
		}
		return map[string]any{"agents": out}, false

	case "get_agent_status":
		agentID, _ := args["agentId"].(string)
		payload := s.getAgentPayload(agentID)
		if payload == nil {
			return map[string]any{"error": "agent not found"}, true
		}
		var lastReply string
		s.mu.Lock()
		if mp, ok := s.agents[agentID]; ok && mp.session != nil {
			lastReply = mp.session.LastAssistantText()
		}
		s.mu.Unlock()
		return map[string]any{
			"agent":             payload,
			"lastAssistantText": lastReply,
		}, false

	case "get_agent_activity":
		agentID, _ := args["agentId"].(string)
		mp, err := s.ensureAgentLoaded(agentID)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{
			"agentId": agentID,
			"entries": mp.session.Timeline(),
		}, false

	case "create_agent":
		cwd, _ := args["cwd"].(string)
		if strings.TrimSpace(cwd) == "" {
			cwd, _ = os.Getwd()
		}
		if abs, err := filepath.Abs(cwd); err == nil {
			cwd = abs
		}
		_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		var titlePtr *string
		if t, _ := args["title"].(string); strings.TrimSpace(t) != "" {
			trimmed := strings.TrimSpace(t)
			titlePtr = &trimmed
		}
		var cfgPtr *store.AgentConfig
		modelStr, _ := args["model"].(string)
		thinkStr, _ := args["thinking"].(string)
		if modelStr != "" || thinkStr != "" {
			cfgPtr = &store.AgentConfig{}
			if modelStr != "" {
				cfgPtr.Model = &modelStr
			}
			if thinkStr != "" {
				cfgPtr.ThinkingOptionID = &thinkStr
			}
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		agentID := newAgentID()
		rec := store.AgentRecord{
			ID:          agentID,
			Provider:    "pi",
			Cwd:         cwd,
			WorkspaceID: ws.WorkspaceID,
			CreatedAt:   now,
			UpdatedAt:   now,
			Title:       titlePtr,
			Labels:      map[string]string{},
			LastStatus:  "idle",
			Config:      cfgPtr,
		}
		mp, err := s.startOrGetPiAgent(rec)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		_ = s.store.UpsertAgent(mp.record)
		if prompt, _ := args["initialPrompt"].(string); strings.TrimSpace(prompt) != "" {
			_ = mp.session.Prompt(ctx, prompt, nil)
		}
		return map[string]any{
			"agentId": agentID,
			"agent":   s.buildAgentSnapshotPayload(mp.record),
		}, false

	case "send_agent_message", "send_agent_prompt":
		agentID, _ := args["agentId"].(string)
		prompt, _ := args["prompt"].(string)
		mp, err := s.ensureAgentLoaded(agentID)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		if err := mp.session.Prompt(ctx, prompt, nil); err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"accepted": true, "agentId": agentID}, false

	case "cancel_agent":
		agentID, _ := args["agentId"].(string)
		s.mu.Lock()
		mp := s.agents[agentID]
		s.mu.Unlock()
		if mp != nil && mp.session != nil {
			_ = mp.session.Abort(ctx)
		}
		return map[string]any{"cancelled": true, "agentId": agentID}, false

	case "archive_agent":
		agentID, _ := args["agentId"].(string)
		rec, err := s.store.GetAgent(agentID)
		if err != nil || rec == nil {
			return map[string]any{"error": "agent not found"}, true
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		rec.ArchivedAt = &now
		rec.UpdatedAt = now
		_ = s.store.UpsertAgent(*rec)
		return map[string]any{"archived": true, "agentId": agentID}, false

	case "kill_agent":
		agentID, _ := args["agentId"].(string)
		s.mu.Lock()
		mp := s.agents[agentID]
		delete(s.agents, agentID)
		s.mu.Unlock()
		if mp != nil && mp.session != nil {
			_ = mp.session.Close()
		}
		_ = s.store.DeleteAgent(agentID)
		return map[string]any{"killed": true, "agentId": agentID}, false

	case "update_agent", "set_agent_mode":
		agentID, _ := args["agentId"].(string)
		rec, err := s.store.GetAgent(agentID)
		if err != nil || rec == nil {
			return map[string]any{"error": "agent not found"}, true
		}
		if nameVal, ok := args["name"].(string); ok && strings.TrimSpace(nameVal) != "" {
			trimmed := strings.TrimSpace(nameVal)
			rec.Title = &trimmed
		}
		if modeVal, ok := args["modeId"].(string); ok && strings.TrimSpace(modeVal) != "" {
			trimmed := strings.TrimSpace(modeVal)
			rec.LastModeID = &trimmed
		}
		rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		_ = s.store.UpsertAgent(*rec)
		return map[string]any{"updated": true, "agent": s.buildAgentSnapshotPayload(*rec)}, false

	case "list_pending_permissions":
		agentID, _ := args["agentId"].(string)
		mp, err := s.ensureAgentLoaded(agentID)
		if err != nil {
			return map[string]any{"permissions": []any{}}, false
		}
		return map[string]any{"permissions": mp.session.PendingPermissions()}, false

	case "respond_to_permission":
		agentID, _ := args["agentId"].(string)
		reqID, _ := args["requestId"].(string)
		ans, _ := args["answer"].(string)
		mp, err := s.ensureAgentLoaded(agentID)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		_ = mp.session.RespondToPermission(reqID, map[string]any{
			"behavior": "allow",
			"updatedInput": map[string]any{
				"answers": map[string]any{"Answer": ans},
			},
		})
		return map[string]any{"resolved": true, "requestId": reqID}, false

	case "wait_for_finish":
		agentID, _ := args["agentId"].(string)
		mp, err := s.ensureAgentLoaded(agentID)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		if err := mp.session.WaitForFinish(ctx); err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{
			"status":        "completed",
			"agentId":       agentID,
			"assistantText": mp.session.LastAssistantText(),
		}, false

	case "list_workspace_scripts", "start_workspace_script", "stop_workspace_script":
		wsID, _ := args["workspaceId"].(string)
		return map[string]any{"workspaceId": wsID, "scripts": []any{}}, false

	case "list_terminals":
		s.mu.Lock()
		list := make([]map[string]any, 0, len(s.terminals))
		for slot, sess := range s.terminals {
			list = append(list, map[string]any{
				"id":   sess.ID,
				"name": sess.Name,
				"cwd":  sess.Cwd,
				"slot": slot,
			})
		}
		s.mu.Unlock()
		return map[string]any{"terminals": list}, false

	case "create_terminal":
		cwd, _ := args["cwd"].(string)
		if cwd == "" {
			cwd, _ = os.Getwd()
		}
		tName, _ := args["name"].(string)
		if tName == "" {
			tName = "Terminal"
		}
		s.mu.Lock()
		slot := uint8(len(s.terminals) + 1)
		tid := fmt.Sprintf("term_%d", slot)
		sess, err := terminal.StartSession(terminal.StartOptions{
			ID:   tid,
			Name: tName,
			Cwd:  cwd,
		})
		if err != nil {
			s.mu.Unlock()
			return map[string]any{"error": err.Error()}, true
		}
		s.terminals[slot] = sess
		s.terminalSlotsByID[tid] = slot
		s.mu.Unlock()
		return map[string]any{"terminalId": tid, "slot": slot}, false

	case "kill_terminal":
		tid, _ := args["terminalId"].(string)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[tid]
		sess := s.terminals[slot]
		if ok {
			delete(s.terminalSlotsByID, tid)
			delete(s.terminals, slot)
		}
		s.mu.Unlock()
		if sess != nil {
			_ = sess.Close()
		}
		return map[string]any{"terminalId": tid, "killed": ok}, false

	case "capture_terminal":
		tid, _ := args["terminalId"].(string)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[tid]
		sess := s.terminals[slot]
		s.mu.Unlock()
		lines := []string{}
		if ok && sess != nil {
			if res := sess.ResumeSince(0); res != nil && res.Data != "" {
				lines = strings.Split(strings.TrimRight(res.Data, "\r\n"), "\n")
			}
		}
		return map[string]any{"terminalId": tid, "lines": lines}, false

	case "send_terminal_keys":
		tid, _ := args["terminalId"].(string)
		keys, _ := args["keys"].(string)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[tid]
		sess := s.terminals[slot]
		s.mu.Unlock()
		if !ok || sess == nil {
			return map[string]any{"error": "terminal not found"}, true
		}
		_ = sess.WriteInput([]byte(keys))
		return map[string]any{"terminalId": tid, "sent": true}, false

	case "create_schedule", "create_heartbeat":
		prompt, _ := args["prompt"].(string)
		sName, _ := args["name"].(string)
		cronExpr, _ := args["cron"].(string)
		everyMsF, _ := args["everyMs"].(float64)
		cwd, _ := args["cwd"].(string)
		if cwd == "" {
			cwd, _ = os.Getwd()
		}
		cad := schedule.Cadence{Type: "every", EveryMs: 600000}
		if cronExpr != "" {
			cad = schedule.Cadence{Type: "cron", Expression: cronExpr, Timezone: "UTC"}
		} else if everyMsF > 0 {
			cad = schedule.Cadence{Type: "every", EveryMs: int64(everyMsF)}
		}
		var namePtr *string
		if sName != "" {
			namePtr = &sName
		}
		created, err := s.schedules.Create(ctx, schedule.CreateInput{
			Name:    namePtr,
			Prompt:  prompt,
			Cadence: cad,
			Target: schedule.Target{
				Type:   "new-agent",
				Config: &schedule.TargetConfig{Provider: "pi", Cwd: cwd},
			},
		})
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": created.ToSummary()}, false

	case "list_schedules":
		list, err := s.schedules.List()
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		out := make([]schedule.Summary, 0, len(list))
		for _, item := range list {
			out = append(out, item.ToSummary())
		}
		return map[string]any{"schedules": out}, false

	case "inspect_schedule":
		sid, _ := args["scheduleId"].(string)
		sched, err := s.schedules.Inspect(sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": sched}, false

	case "pause_schedule":
		sid, _ := args["scheduleId"].(string)
		sched, err := s.schedules.Pause(sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": sched.ToSummary()}, false

	case "resume_schedule":
		sid, _ := args["scheduleId"].(string)
		sched, err := s.schedules.Resume(sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": sched.ToSummary()}, false

	case "delete_schedule", "delete_heartbeat":
		sid, _ := args["scheduleId"].(string)
		if err := s.schedules.Delete(sid); err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"deleted": true, "scheduleId": sid}, false

	case "update_schedule":
		sid, _ := args["scheduleId"].(string)
		sched, err := s.schedules.Inspect(sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": sched.ToSummary()}, false

	case "schedule_logs":
		sid, _ := args["scheduleId"].(string)
		runs, err := s.schedules.Logs(sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"runs": runs}, false

	case "run_schedule_once":
		sid, _ := args["scheduleId"].(string)
		sched, err := s.schedules.RunOnce(ctx, sid)
		if err != nil {
			return map[string]any{"error": err.Error()}, true
		}
		return map[string]any{"schedule": sched.ToSummary()}, false

	case "list_providers":
		return map[string]any{
			"providers": []map[string]any{
				{"provider": "pi", "label": "Pi", "available": true},
			},
		}, false

	case "list_models":
		models := s.probeOrCachedPiModels(ctx)
		return map[string]any{"provider": "pi", "models": models}, false

	case "list_profiles":
		return map[string]any{"profiles": []any{}}, false

	case "inspect_provider":
		return map[string]any{
			"provider":   "pi",
			"available":  true,
			"diagnostic": "Pi provider is healthy (Go runtime host)",
		}, false

	default:
		return map[string]any{"error": "unknown tool: " + name}, true
	}
}

// bySpaceToolPolicyFor resolves the requesting agent's provider tool policy.
//
// An unknown or unspecified agent gets no policy, which means everything is allowed: the default
// has to be on, or a caller that cannot identify itself would lose the tools.
func (s *Server) bySpaceToolPolicyFor(agentID string) *toolpolicy.Policy {
	if strings.TrimSpace(agentID) == "" {
		return nil
	}
	record, err := s.store.GetAgent(agentID)
	if err != nil || record == nil {
		return nil
	}
	cfg := s.store.LoadDaemonConfig()
	if cfg == nil {
		return nil
	}
	settings, _ := cfg["providers"].(map[string]any)
	return toolpolicy.Resolve(record.Provider, settings)
}
