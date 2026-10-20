package pi

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

func mapSubagentStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "running", "pending", "starting":
		return "running"
	case "completed", "succeeded", "done", "ok":
		return "completed"
	case "failed", "error", "timed_out", "timeout":
		return "failed"
	case "canceled", "cancelled", "stopped", "aborted":
		return "canceled"
	default:
		return "running"
	}
}

// ParseSubagentDetails extracts subagent metadata from a Pi tool result's details or custom message.
func ParseSubagentDetails(toolCallID string, args any, details any) []SubagentDescriptor {
	var records []map[string]any
	switch v := details.(type) {
	case map[string]any:
		if inner, ok := v["details"].(map[string]any); ok {
			records = append(records, inner)
		} else {
			records = append(records, v)
		}
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				records = append(records, m)
			}
		}
	}

	argsMap, _ := args.(map[string]any)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var out []SubagentDescriptor

	for _, rec := range records {
		id, _ := rec["id"].(string)
		if strings.TrimSpace(id) == "" {
			continue
		}
		agentRole, _ := rec["agent"].(string)
		if agentRole == "" {
			agentRole, _ = argsMap["agent"].(string)
		}
		desc, _ := rec["description"].(string)
		if desc == "" {
			desc, _ = argsMap["task"].(string)
		}
		rawStatus, _ := rec["status"].(string)
		sessionID, _ := rec["sessionId"].(string)
		sessionFile, _ := rec["sessionFile"].(string)
		cwd, _ := rec["cwd"].(string)

		var titlePtr, descPtr, tcPtr, cwdPtr *string
		if strings.TrimSpace(agentRole) != "" {
			t := strings.TrimSpace(agentRole)
			titlePtr = &t
		}
		if strings.TrimSpace(desc) != "" {
			d := strings.TrimSpace(desc)
			descPtr = &d
		}
		if strings.TrimSpace(toolCallID) != "" {
			tc := strings.TrimSpace(toolCallID)
			tcPtr = &tc
		}
		if strings.TrimSpace(cwd) != "" {
			c := strings.TrimSpace(cwd)
			cwdPtr = &c
		}

		out = append(out, SubagentDescriptor{
			ID:          id,
			Provider:    "pi",
			Title:       titlePtr,
			Description: descPtr,
			Status:      mapSubagentStatus(rawStatus),
			CreatedAt:   now,
			UpdatedAt:   now,
			ToolCallID:  tcPtr,
			Cwd:         cwdPtr,
			SessionID:   sessionID,
			SessionFile: sessionFile,
		})
	}
	return out
}

// LocateSubagentSessionFile finds the .jsonl transcript for a subagent by sessionFile or sessionId.
func LocateSubagentSessionFile(desc SubagentDescriptor, sessionDirOverride string) string {
	if desc.SessionFile != "" {
		if _, err := os.Stat(desc.SessionFile); err == nil {
			return desc.SessionFile
		}
	}
	if desc.SessionID == "" {
		return ""
	}
	root := ResolveSessionsDir(sessionDirOverride)
	var found string
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(d.Name(), ".jsonl") && strings.Contains(d.Name(), desc.SessionID) {
			found = p
			return filepath.SkipAll
		}
		return nil
	})
	return found
}
