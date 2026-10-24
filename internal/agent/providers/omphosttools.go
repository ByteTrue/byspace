package providers

import (
	"strings"
)

// OmpHostTool is one BySpace tool exposed to omp as a host tool.
//
// Ported from omp/host-tools.ts. omp has no MCP client of its own in the modes BySpace uses, so the
// orchestration tools reach it through its RPC host-tool channel instead: the daemon declares them with
// `set_host_tools`, omp calls them with `host_tool_call`, and the daemon answers with `host_tool_result`.
// Go launched omp with a system prompt and no tools at all, so an omp agent could not create an agent,
// list workspaces or schedule anything.
type OmpHostTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// LoadMode is "essential": omp keeps the definition in the model's context from the start rather
	// than loading it on demand. These are the tools the system prompt tells the agent to use, so a
	// tool it cannot see is a tool it will not use.
	LoadMode string `json:"loadMode"`
	// Label is the human-readable name shown in omp's own tool list.
	Label string `json:"label,omitempty"`
	// Parameters is a JSON Schema object, the shape omp expects for a host tool.
	Parameters map[string]any `json:"parameters"`
}

// SerializeOmpHostTools converts the BySpace tool catalog into omp's host-tool definitions.
//
// The input is the same `{name, description, inputSchema}` list the MCP endpoint serves, so the two
// surfaces cannot drift: a tool added to one is a tool in both.
func SerializeOmpHostTools(catalog []map[string]any) []OmpHostTool {
	out := make([]OmpHostTool, 0, len(catalog))
	for _, tool := range catalog {
		name, _ := tool["name"].(string)
		if strings.TrimSpace(name) == "" {
			continue
		}
		description, _ := tool["description"].(string)
		schema, _ := tool["inputSchema"].(map[string]any)
		if schema == nil {
			// A host tool without a schema makes omp reject the whole set, so a malformed entry gets
			// an empty object schema rather than taking the catalog down with it.
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		definition := OmpHostTool{
			Name:        name,
			Description: description,
			LoadMode:    "essential",
			Parameters:  schema,
		}
		if title, ok := tool["title"].(string); ok && strings.TrimSpace(title) != "" {
			definition.Label = title
		}
		out = append(out, definition)
	}
	return out
}

// OmpHostToolCall is one invocation omp asks the daemon to perform.
type OmpHostToolCall struct {
	// CallID correlates the result with the call.
	CallID string
	// Name is the host tool's name.
	Name string
	// Arguments is the parsed input.
	Arguments map[string]any
}

// ParseOmpHostToolCall reads a `host_tool_call` event.
//
// Returns false for an event with no call id or no name: answering it would put a result for a call that
// omp is not waiting on into the stream, and omp would then report a protocol error for the session.
func ParseOmpHostToolCall(event map[string]any) (OmpHostToolCall, bool) {
	if event == nil {
		return OmpHostToolCall{}, false
	}
	call := OmpHostToolCall{
		CallID: firstNonEmptyString(event["callId"], event["call_id"], event["id"]),
		Name:   firstNonEmptyString(event["name"], event["tool"]),
	}
	if call.CallID == "" || call.Name == "" {
		return OmpHostToolCall{}, false
	}
	if args, ok := event["arguments"].(map[string]any); ok {
		call.Arguments = args
	} else if args, ok := event["args"].(map[string]any); ok {
		call.Arguments = args
	}
	if call.Arguments == nil {
		call.Arguments = map[string]any{}
	}
	return call, true
}

// OmpHostToolResult builds the `host_tool_result` message for one call.
//
// The content is always a string: omp renders it as the tool's output, and a JSON object there becomes
// "[object Object]" in the transcript.
func OmpHostToolResult(callID, output string, failed bool) map[string]any {
	message := map[string]any{
		"type":    "host_tool_result",
		"callId":  callID,
		"content": output,
	}
	if failed {
		message["isError"] = true
	}
	return message
}

// firstNonEmptyString returns the first non-empty trimmed string among the values.
func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok {
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}
