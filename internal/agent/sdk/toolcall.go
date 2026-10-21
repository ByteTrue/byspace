package sdk

import (
	"fmt"
	"strings"
)

// QuestionResponseHeader is the answers-map key the client uses for extension questions.
const QuestionResponseHeader = "Answer"

// BuildToolCallDetail maps a tool invocation into BySpace's structured ToolCallDetail
// (shell, read, edit, write, search, fetch, sub_agent, or unknown).
//
// Mirrors `providers/tool-call-detail-primitives.ts` + `tool-call-mapper-utils.ts` in node: the
// tool names here (bash/read/edit/write/web_search/web_fetch/subagent) are shared vocabulary
// across providers, only the argument shapes differ.
func BuildToolCallDetail(toolName string, args any, result any) map[string]any {
	argsMap, _ := args.(map[string]any)
	outText := ExtractResultText(result)

	// Normalized first: a provider may capitalise the name or spell it `WebFetch`, and an unmatched name
	// turned the whole card into an "unknown" entry with no command, file or output.
	toolName = canonicalToolName(toolName)
	switch toolName {
	case "bash":
		cmd, _ := argsMap["command"].(string)
		if cmd == "" {
			cmd = "(shell command)"
		}
		detail := map[string]any{
			"type":    "shell",
			"command": cmd,
			"output":  outText,
		}
		if code, ok := argsMap["exitCode"].(float64); ok {
			detail["exitCode"] = int(code)
		}
		return detail

	case "read":
		p, _ := argsMap["path"].(string)
		if p == "" {
			p = "(file)"
		}
		return map[string]any{
			"type":     "read",
			"filePath": p,
			"content":  outText,
		}

	case "edit":
		p, _ := argsMap["path"].(string)
		oldText, _ := argsMap["oldText"].(string)
		newText, _ := argsMap["newText"].(string)
		return map[string]any{
			"type":      "edit",
			"filePath":  p,
			"oldString": oldText,
			"newString": newText,
		}

	case "write":
		p, _ := argsMap["path"].(string)
		content, _ := argsMap["content"].(string)
		return map[string]any{
			"type":     "write",
			"filePath": p,
			"content":  content,
		}

	case "web_search", "grep", "glob", "search":
		query, _ := argsMap["query"].(string)
		if query == "" {
			query, _ = argsMap["pattern"].(string)
		}
		if query == "" {
			query = toolName
		}
		detail := map[string]any{
			"type":     "search",
			"query":    query,
			"toolName": toolName,
		}
		if outText != "" {
			detail["content"] = outText
		}
		return detail

	case "web_fetch":
		u, _ := argsMap["url"].(string)
		if u == "" {
			u = "https://"
		}
		detail := map[string]any{
			"type": "fetch",
			"url":  u,
		}
		if outText != "" {
			detail["result"] = outText
		}
		return detail

	case "subagent":
		agentRole, _ := argsMap["agent"].(string)
		task, _ := argsMap["task"].(string)
		detail := map[string]any{
			"type":    "sub_agent",
			"log":     outText,
			"actions": []any{},
		}
		if agentRole != "" {
			detail["subAgentType"] = agentRole
		}
		if task != "" {
			detail["description"] = task
		}
		return detail

	default:
		return map[string]any{
			"type":   "unknown",
			"input":  args,
			"output": result,
		}
	}
}

// ExtractResultText pulls the human-readable text out of a provider tool result.
func ExtractResultText(result any) string {
	switch v := result.(type) {
	case nil:
		return ""
	case string:
		return v
	case map[string]any:
		if content, ok := v["content"].([]any); ok {
			var parts []string
			for _, block := range content {
				if bm, ok := block.(map[string]any); ok {
					if t, ok := bm["text"].(string); ok && t != "" {
						parts = append(parts, t)
					}
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, "\n")
			}
		}
		if out, ok := v["output"].(string); ok {
			return out
		}
		return fmt.Sprintf("%v", v)
	default:
		return fmt.Sprintf("%v", v)
	}
}
