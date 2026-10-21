// Package activity turns a timeline into readable text.
//
// Ported from protocol/tool-call-display.ts and server/agent/activity-curator.ts. Two consumers need
// this and both were missing it in Go: the schedule service summarises what a run did, and the
// fork-context attachment hands a previous conversation to a new agent as text. Without it those
// paths had a tool call's raw JSON and nothing readable.
package activity

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DisplayModel is what a tool call looks like to a human.
type DisplayModel struct {
	DisplayName string
	Summary     string
	HasSummary  bool
}

// ToolDetail is the shape of an item's `detail` field.
//
// A plain map in the wire format, so it is read through typed accessors rather than decoded into
// structs: a provider can add fields and the display must not break.
type ToolDetail map[string]any

func (d ToolDetail) kind() string {
	if value, ok := d["type"].(string); ok {
		return value
	}
	return ""
}

func (d ToolDetail) str(key string) (string, bool) {
	value, ok := d[key].(string)
	if !ok {
		return "", false
	}
	return value, true
}

// BuildDisplayModel derives a display name and one-line summary for a tool call.
//
// The order mirrors the node protocol: an "unknown" detail with a well-known tool name gets an
// override first (Task, Thinking, Terminal), then the canonical detail shape names it, and only then
// does the raw tool name get humanized.
func BuildDisplayModel(name string, detail any, metadata any) DisplayModel {
	parsed := asDetail(detail)
	canonical := canonicalDisplay(parsed)
	override := unknownDetailOverride(name, parsed, metadata)

	model := DisplayModel{}
	switch {
	case override.DisplayName != "":
		model.DisplayName = override.DisplayName
	case canonical.DisplayName != "":
		model.DisplayName = canonical.DisplayName
	default:
		model.DisplayName = humanizeToolName(name)
	}
	if override.HasSummary {
		model.Summary, model.HasSummary = override.Summary, true
	} else if canonical.HasSummary {
		model.Summary, model.HasSummary = canonical.Summary, true
	}
	return model
}

// asDetail coerces the wire value into a ToolDetail.
func asDetail(value any) ToolDetail {
	switch typed := value.(type) {
	case ToolDetail:
		return typed
	case map[string]any:
		return ToolDetail(typed)
	}
	return ToolDetail{}
}

// canonicalDisplay names the shapes the protocol defines.
func canonicalDisplay(detail ToolDetail) DisplayModel {
	switch detail.kind() {
	case "shell":
		return summaryModel("Shell", detail, "command")
	case "read":
		return summaryModel("Read", detail, "filePath")
	case "edit":
		return summaryModel("Edit", detail, "filePath")
	case "write":
		return summaryModel("Write", detail, "filePath")
	case "search":
		return summaryModel("Search", detail, "query")
	case "fetch":
		return summaryModel("Fetch", detail, "url")
	case "worktree_setup":
		return summaryModel("Worktree setup", detail, "branchName")
	case "sub_agent":
		name, ok := detail.str("subAgentType")
		if !ok || name == "" {
			name = "Task"
		}
		return summaryModel(name, detail, "description")
	case "plain_text":
		// No name of its own: the caller falls back to the tool name, which is the point.
		return summaryModel("", detail, "label")
	case "plan":
		return DisplayModel{DisplayName: "Plan"}
	case "unknown":
		return DisplayModel{}
	}
	return DisplayModel{}
}

// summaryModel builds a model whose summary is one string field.
func summaryModel(name string, detail ToolDetail, field string) DisplayModel {
	model := DisplayModel{DisplayName: name}
	if value, ok := detail.str(field); ok {
		model.Summary, model.HasSummary = value, true
	}
	return model
}

// unknownDetailOverride names tools whose detail carries no name but whose tool name does.
func unknownDetailOverride(name string, detail ToolDetail, metadata any) DisplayModel {
	lower := strings.ToLower(strings.TrimSpace(name))

	if detail.kind() == "unknown" && lower == "task" {
		model := DisplayModel{DisplayName: "Task"}
		if record, ok := metadata.(map[string]any); ok {
			if value, ok := record["subAgentActivity"].(string); ok {
				model.Summary, model.HasSummary = value, true
			}
		}
		return model
	}
	if detail.kind() == "unknown" && lower == "thinking" {
		return DisplayModel{DisplayName: "Thinking"}
	}
	if lower == "terminal" {
		// The command lives in the raw input for this tool, not in a typed detail.
		if input, ok := detail["input"]; ok {
			if text := formatToolInputJSON(input); text != "" {
				return DisplayModel{Summary: text, HasSummary: true}
			}
		}
	}
	return DisplayModel{}
}

// humanizeToolName turns `web_search` into `Web search`.
//
// A BySpace tool (`mcp__byspace__create_agent`) is reduced to its leaf name first, so the summary
// reads "Create agent" rather than the transport-qualified name. Names containing `:`, `.`, `/` or
// `__` are left alone: those are namespaced identifiers where the qualifier is the information.
func humanizeToolName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return name
	}
	if leaf := bySpaceToolLeaf(trimmed); leaf != "" {
		return humanizeToolName(leaf)
	}
	if strings.ContainsAny(trimmed, ":./") || strings.Contains(trimmed, "__") {
		return trimmed
	}

	replaced := strings.NewReplacer(".", " ", "_", " ", "-", " ").Replace(trimmed)
	segments := make([]string, 0, 4)
	for _, segment := range strings.Split(replaced, " ") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) == 0 {
		return trimmed
	}
	joined := strings.ToLower(strings.Join(segments, " "))
	return strings.ToUpper(joined[:1]) + joined[1:]
}

// bySpaceToolLeaf extracts the leaf of an MCP-qualified BySpace tool name.
func bySpaceToolLeaf(name string) string {
	const marker = "__byspace__"
	index := strings.Index(name, marker)
	if index < 0 {
		return ""
	}
	leaf := name[index+len(marker):]
	leaf = strings.TrimPrefix(leaf, "byspace_")
	return strings.TrimSpace(leaf)
}

// formatToolInputJSON renders a tool input as compact JSON, truncated.
func formatToolInputJSON(input any) string {
	if input == nil {
		return ""
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) == 0 {
		return ""
	}
	const maxInputChars = 400
	if len(encoded) <= maxInputChars {
		return string(encoded)
	}
	return string(encoded[:maxInputChars]) + "..."
}

// FormatErrorText turns an error value into text.
func FormatErrorText(value any) (string, bool) {
	switch typed := value.(type) {
	case nil:
		return "", false
	case string:
		return typed, typed != ""
	}
	if record, ok := value.(map[string]any); ok {
		if content, ok := record["content"].(string); ok {
			return content, true
		}
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", value), true
	}
	return string(encoded), true
}
