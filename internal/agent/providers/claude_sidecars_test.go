package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestClaudeSidecarsRecoverHistoryAndNestedOwnership(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "root.jsonl")
	sidecars := filepath.Join(dir, "root", "subagents")
	if err := os.MkdirAll(sidecars, 0o755); err != nil {
		t.Fatal(err)
	}
	rootLine := `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"root-tool","name":"Agent","input":{"description":"Root child"}}]}}`
	childLines := `{"type":"user","message":{"content":[{"type":"text","text":"Do the child work"}]}}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"CLAUDE_CHILD_SENTINEL"},{"type":"tool_use","id":"bash-tool","name":"Bash","input":{"command":"printf sentinel"}}]}}` + "\n" +
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"bash-tool","content":"NESTED_BACKGROUND_SENTINEL"}]}}` + "\n" +
		`{"type":"attachment","attachment":{"prompt":"<task-notification>\\n<task-id>background-1</task-id>\\n<status>completed</status>\\n<summary>Background command completed (exit code 0)</summary>\\n</task-notification>"}}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"grand-tool","name":"Agent","input":{"description":"Grandchild"}}]}}`
	grandLine := `{"type":"assistant","message":{"content":[{"type":"text","text":"GRANDCHILD_DONE"}]}}`
	for path, body := range map[string]string{
		root: rootLine,
		filepath.Join(sidecars, "agent-root.jsonl"):  childLines,
		filepath.Join(sidecars, "agent-grand.jsonl"): grandLine,
	} {
		if err := os.WriteFile(path, []byte(body+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range map[string]string{
		"agent-root.meta.json":  `{"toolUseId":"root-tool","description":"Root child","agentType":"Explore","spawnDepth":1}`,
		"agent-grand.meta.json": `{"toolUseId":"grand-tool","description":"Grandchild","agentType":"Explore","spawnDepth":2}`,
	} {
		if err := os.WriteFile(filepath.Join(sidecars, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	s := &ClaudeSession{sessionFile: root, subagents: make(map[string]sdk.SubagentDescriptor), subagentTimelines: make(map[string][]sdk.TimelineEntry)}
	subagents := s.ListSubagents("parent-agent")
	if len(subagents) != 2 {
		t.Fatalf("subagents = %#v", subagents)
	}
	byID := make(map[string]sdk.SubagentDescriptor)
	for _, subagent := range subagents {
		byID[subagent.ID] = subagent
	}
	if byID["root-tool"].ParentSubagentID != nil {
		t.Fatalf("root parent = %#v", byID["root-tool"].ParentSubagentID)
	}
	if got := byID["grand-tool"].ParentSubagentID; got == nil || *got != "root-tool" {
		t.Fatalf("grandchild parent = %#v", got)
	}
	timeline, err := s.SubagentTimeline("parent-agent", "root-tool")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range timeline {
		if entry.Item.Type == "assistant_message" && entry.Item.Text == "CLAUDE_CHILD_SENTINEL" {
			found = true
		}
	}
	if !found {
		t.Fatalf("timeline = %#v", timeline)
	}
	encoded, err := json.Marshal(timeline)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), "NESTED_BACKGROUND_SENTINEL") || !strings.Contains(string(encoded), "task_notification") {
		t.Fatalf("sidecar tool output or notification missing: %s", encoded)
	}
}
