package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
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
	var req mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON-RPC payload", http.StatusBadRequest)
		return
	}

	resp := s.ExecuteMCPRequest(r.Context(), req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// ExecuteMCPRequest handles an MCP JSON-RPC 2.0 request (initialize, tools/list, tools/call).
func (s *Server) ExecuteMCPRequest(ctx context.Context, req mcpRequest) map[string]any {
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
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]any{
				"tools": mcpToolDefinitions(),
			},
		}

	case "tools/call":
		name, _ := req.Params["name"].(string)
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

func mcpToolDefinitions() []map[string]any {
	return []map[string]any{
		{
			"name":        "list_agents",
			"description": "List agents managed by BySpace, optionally scoped to a working directory.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"cwd": map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "get_agent_status",
			"description": "Inspect the current lifecycle status and latest assistant reply of an agent.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"agentId"},
				"properties": map[string]any{
					"agentId": map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "create_agent",
			"description": "Create and launch a new Pi agent in the specified working directory.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"cwd":           map[string]any{"type": "string"},
					"initialPrompt": map[string]any{"type": "string"},
					"title":         map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "send_agent_message",
			"description": "Send a follow-up prompt to an existing agent.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"agentId", "prompt"},
				"properties": map[string]any{
					"agentId": map[string]any{"type": "string"},
					"prompt":  map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "wait_for_finish",
			"description": "Wait for an agent's active turn to complete and return its final assistant reply.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"agentId"},
				"properties": map[string]any{
					"agentId":   map[string]any{"type": "string"},
					"timeoutMs": map[string]any{"type": "number"},
				},
			},
		},
	}
}

func (s *Server) callMCPTool(ctx context.Context, name string, args map[string]any) (any, bool) {
	switch name {
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

	case "send_agent_message":
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

	default:
		return map[string]any{"error": "unknown tool: " + name}, true
	}
}
