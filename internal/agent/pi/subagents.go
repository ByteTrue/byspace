package pi

import (
	"bufio"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// restoreSubagents rebuilds the roster from the same launch and exit records used live.
//
// Two passes keep memory at one small head struct per line: only the leaf branch's entries are
// ever fully parsed, so a session with hundreds of MB of history costs an index, not a copy.
func (s *Session) restoreSubagents(path string) {
	f, err := os.Open(path)
	if err != nil {
		slog.Warn("pi subagent restore: cannot open session file", "path", path, "error", err)
		return
	}
	defer f.Close()
	type head struct {
		Type     string `json:"type"`
		ID       string `json:"id"`
		ParentID string `json:"parentId"`
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	var heads []head
	byID := make(map[string]int)
	leafID := ""
	for scanner.Scan() {
		var h head
		if json.Unmarshal(scanner.Bytes(), &h) != nil || h.Type == "session" {
			continue
		}
		if h.ID != "" {
			byID[h.ID] = len(heads)
			leafID = h.ID
		}
		heads = append(heads, h)
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("pi subagent restore: transcript scan failed", "path", path, "error", err)
		return
	}
	// Mark the leaf branch; file order is already time order, so no reverse is needed. A broken
	// parent chain degrades to a linear replay instead of silently restoring nothing.
	branch := make(map[int]bool, len(heads))
	if leafID != "" {
		for limit := len(heads); leafID != ""; {
			idx, ok := byID[leafID]
			if !ok || idx >= limit {
				slog.Warn("pi subagent restore: broken parent chain, replaying whole transcript", "path", path)
				branch = nil
				break
			}
			branch[idx] = true
			leafID, limit = heads[idx].ParentID, idx
		}
	}
	if _, err := f.Seek(0, 0); err != nil {
		slog.Warn("pi subagent restore: cannot rewind transcript", "path", path, "error", err)
		return
	}
	scanner = bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	args := make(map[string]any)
	idx := -1
	for scanner.Scan() {
		raw := scanner.Bytes()
		var h head
		if json.Unmarshal(raw, &h) != nil || h.Type == "session" {
			continue
		}
		idx++
		if branch != nil && !branch[idx] {
			continue
		}
		var entry map[string]any
		if json.Unmarshal(raw, &entry) != nil {
			continue
		}
		ts, _ := entry["timestamp"].(string)
		if entry["type"] == "message" {
			entry, _ = entry["message"].(map[string]any)
		}
		if customType, _ := entry["customType"].(string); isSubagentExit(customType) {
			s.applySubagentExitLocked(entry["details"], ts)
			continue
		}
		switch entry["role"] {
		case "assistant":
			blocks, _ := entry["content"].([]any)
			for _, raw := range blocks {
				block, _ := raw.(map[string]any)
				if block["type"] == "toolCall" && block["name"] == "subagent" {
					id, _ := block["id"].(string)
					args[id] = block["arguments"]
				}
			}
		case "toolResult":
			if entry["toolName"] != "subagent" || entry["isError"] == true {
				continue
			}
			id, _ := entry["toolCallId"].(string)
			for _, sub := range ParseSubagentDetails(id, args[id], entry["details"], ts) {
				s.upsertSubagentLocked(sub)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("pi subagent restore: replay scan failed", "path", path, "error", err)
	}
}

func isSubagentExit(customType string) bool {
	return customType == "subagent-exit" || customType == "subagent-notify"
}

func mapSubagentStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "running", "pending", "starting":
		return "running"
	case "completed", "succeeded", "done", "ok":
		return "completed"
	case "failed", "error", "timed_out", "timeout":
		return "failed"
	case "canceled", "cancelled", "stopped", "aborted", "paused":
		return "canceled"
	default:
		return "running"
	}
}

// ParseSubagentDetails extracts subagent metadata from a Pi tool result's details or custom message.
// now stamps CreatedAt/UpdatedAt; pass "" for live events, or the transcript row's timestamp when
// replaying so restored descriptors keep their historical times.
func ParseSubagentDetails(toolCallID string, args any, details any, now string) []SubagentDescriptor {
	records := subagentRecords(details)

	argsMap, _ := args.(map[string]any)
	if now == "" {
		now = time.Now().UTC().Format(time.RFC3339Nano)
	}
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

// subagentRecords normalises a tool result's or custom message's details into per-subagent maps.
//
// A tool result wraps them one level down (`details.details`); a custom message carries the record
// itself, or an array of them for a parallel run.
func subagentRecords(details any) []map[string]any {
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
	return records
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

// SubagentExitUpdates folds a subagent-exit custom message onto the descriptors their launch
// created.
//
// The completion record carries no id: the extension knows the child by the session it started.
// sessionId is therefore the key that joins a finished task to its descriptor, which is why the
// launch details hoist it to the top level as well.
func SubagentExitUpdates(records []SubagentDescriptor, details any, now string) []SubagentDescriptor {
	raw := subagentRecords(details)
	bySession := make(map[string]*SubagentDescriptor, len(records))
	byID := make(map[string]*SubagentDescriptor, len(records))
	for i := range records {
		bySession[records[i].SessionID] = &records[i]
		byID[records[i].ID] = &records[i]
	}
	if now == "" {
		now = time.Now().UTC().Format(time.RFC3339Nano)
	}
	out := make([]SubagentDescriptor, 0, len(raw))
	for _, rec := range raw {
		rawStatus, _ := rec["status"].(string)
		sessionID, _ := rec["sessionId"].(string)
		id, _ := rec["id"].(string)
		var existing *SubagentDescriptor
		if id != "" {
			existing = byID[id]
		}
		if existing == nil && sessionID != "" {
			existing = bySession[sessionID]
		}
		if existing == nil {
			continue
		}
		update := *existing
		update.Status = mapSubagentStatus(rawStatus)
		update.UpdatedAt = now
		if v, ok := rec["agent"].(string); ok && strings.TrimSpace(v) != "" {
			title := strings.TrimSpace(v)
			update.Title = &title
		}
		if v, ok := rec["description"].(string); ok && strings.TrimSpace(v) != "" {
			desc := strings.TrimSpace(v)
			update.Description = &desc
		}
		if v, ok := rec["sessionFile"].(string); ok && strings.TrimSpace(v) != "" {
			update.SessionFile = strings.TrimSpace(v)
		}
		if v, ok := rec["cwd"].(string); ok && strings.TrimSpace(v) != "" {
			cwd := strings.TrimSpace(v)
			update.Cwd = &cwd
		}
		out = append(out, update)
	}
	return out
}
