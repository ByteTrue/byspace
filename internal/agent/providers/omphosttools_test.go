package providers

import "testing"

// The input is the same list the MCP endpoint serves, so the two surfaces cannot drift.
func TestSerializeOmpHostTools(t *testing.T) {
	catalog := []map[string]any{
		{
			"name":        "create_agent",
			"description": "Create an agent",
			"title":       "Create agent",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"cwd": map[string]any{"type": "string"}}},
		},
		{"name": "list_agents", "description": "List agents", "inputSchema": map[string]any{"type": "object"}},
		// An entry with no name cannot be called, so it is dropped.
		{"description": "nameless"},
		// A malformed schema must not take the catalog down with it.
		{"name": "broken", "description": "no schema"},
	}
	got := SerializeOmpHostTools(catalog)
	if len(got) != 3 {
		t.Fatalf("tools = %d", len(got))
	}
	if got[0].Name != "create_agent" || got[0].Label != "Create agent" {
		t.Fatalf("first = %+v", got[0])
	}
	// These are the tools the system prompt tells the agent to use, so they must be visible from the
	// first token rather than loaded on demand.
	for _, tool := range got {
		if tool.LoadMode != "essential" {
			t.Fatalf("%s load mode = %q", tool.Name, tool.LoadMode)
		}
		if tool.Parameters == nil || tool.Parameters["type"] != "object" {
			t.Fatalf("%s parameters = %v", tool.Name, tool.Parameters)
		}
	}
}

// Answering a call omp is not waiting on makes it report a protocol error for the session.
func TestParseOmpHostToolCall(t *testing.T) {
	call, ok := ParseOmpHostToolCall(map[string]any{
		"type": "host_tool_call", "callId": "c1", "name": "list_agents",
		"arguments": map[string]any{"scope": "all"},
	})
	if !ok || call.CallID != "c1" || call.Name != "list_agents" {
		t.Fatalf("call = %+v ok=%v", call, ok)
	}
	if call.Arguments["scope"] != "all" {
		t.Fatalf("arguments = %v", call.Arguments)
	}

	// An event with missing pieces is not a call.
	for _, event := range []map[string]any{
		nil,
		{"name": "x"},
		{"callId": "c1"},
		{"callId": "  ", "name": "  "},
	} {
		if _, ok := ParseOmpHostToolCall(event); ok {
			t.Fatalf("accepted %v", event)
		}
	}

	// Arguments may be absent; an empty map is the right default.
	call, ok = ParseOmpHostToolCall(map[string]any{"callId": "c2", "name": "list_agents"})
	if !ok || len(call.Arguments) != 0 {
		t.Fatalf("no-args call = %+v", call)
	}
}

// The content is a string: a JSON object there becomes "[object Object]" in the transcript.
func TestOmpHostToolResult(t *testing.T) {
	ok := OmpHostToolResult("c1", "created agt_1", false)
	if ok["type"] != "host_tool_result" || ok["callId"] != "c1" || ok["content"] != "created agt_1" {
		t.Fatalf("result = %v", ok)
	}
	if _, has := ok["isError"]; has {
		t.Fatal("a successful result carried isError")
	}

	failed := OmpHostToolResult("c2", "boom", true)
	if failed["isError"] != true {
		t.Fatalf("failed = %v", failed)
	}
}
