package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type claudeSidecarMeta struct {
	ToolUseID   string `json:"toolUseId"`
	Description string `json:"description"`
	AgentType   string `json:"agentType"`
}

// refreshClaudeSidecarsLocked reconciles live task events with Claude on-disk sidecars.
// The root transcript contains only the Task call; the delegated assistant lives in
// <session>/subagents/agent-*.jsonl. meta.toolUseId is the identity shared by both.
func (s *ClaudeSession) refreshClaudeSidecarsLocked() {
	if s.sessionFile == "" {
		return
	}
	root := filepath.Clean(s.sessionFile)
	dir := filepath.Join(filepath.Dir(root), strings.TrimSuffix(filepath.Base(root), ".jsonl"), "subagents")
	files, err := filepath.Glob(filepath.Join(dir, "agent-*.jsonl"))
	if err != nil {
		return
	}
	type sidecar struct {
		path string
		meta claudeSidecarMeta
	}
	sidecars := make([]sidecar, 0, len(files))
	byToolID := make(map[string]sidecar)
	for _, path := range files {
		raw, err := os.ReadFile(strings.TrimSuffix(path, ".jsonl") + ".meta.json")
		if err != nil {
			continue
		}
		var meta claudeSidecarMeta
		if json.Unmarshal(raw, &meta) != nil || meta.ToolUseID == "" {
			continue
		}
		entry := sidecar{path: path, meta: meta}
		sidecars = append(sidecars, entry)
		byToolID[meta.ToolUseID] = entry
	}
	for _, child := range sidecars {
		toolID := child.meta.ToolUseID
		descriptor := s.subagents[toolID]
		title := child.meta.Description
		if title == "" && descriptor.Title != nil {
			title = *descriptor.Title
		}
		if title == "" {
			title = "Subagent"
		}
		kind := child.meta.AgentType
		if kind == "" {
			kind = "Subagent"
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if descriptor.ID == "" {
			descriptor = sdk.SubagentDescriptor{ID: toolID, Provider: "claude", Status: "completed", CreatedAt: now, UpdatedAt: now}
		}
		descriptor.Title = &title
		descriptor.Description = &title
		descriptor.Kind = &kind
		descriptor.ToolCallID = &toolID
		descriptor.SessionFile = child.path
		if !claudeTranscriptDeclaresTask(root, toolID) {
			for ownerID, owner := range byToolID {
				if ownerID != toolID && claudeTranscriptDeclaresTask(owner.path, toolID) {
					descriptor.ParentSubagentID = &ownerID
					break
				}
			}
		} else {
			descriptor.ParentSubagentID = nil
		}
		sdk.RefreshSubagentSubtitle(&descriptor)
		s.subagents[toolID] = descriptor
	}
}

func claudeTranscriptDeclaresTask(path, toolUseID string) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(raw), "\n") {
		var ev struct {
			Message struct {
				Content []struct {
					Type string `json:"type"`
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &ev) != nil {
			continue
		}
		for _, block := range ev.Message.Content {
			if block.Type == "tool_use" && (block.Name == "Task" || block.Name == "Agent") && block.ID == toolUseID {
				return true
			}
		}
	}
	return false
}
