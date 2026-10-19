package pi

import (
	"fmt"
	"strings"
)

const QuestionResponseHeader = "Answer"

// BuildToolCallDetail maps Pi tool arguments and results into BySpace's structured ToolCallDetail
// (shell, read, edit, write, search, fetch, sub_agent, or unknown).
func BuildToolCallDetail(toolName string, args any, result any) map[string]any {
	argsMap, _ := args.(map[string]any)
	outText := extractResultText(result)

	switch strings.TrimSpace(toolName) {
	case "bash":
		cmd, _ := argsMap["command"].(string)
		if cmd == "" {
			cmd = "(shell command)"
		}
		detail := map[string]any{
			"type":    "shell",
			"command": cmd,
		}
		if outText != "" {
			detail["output"] = outText
		}
		if resMap, ok := result.(map[string]any); ok {
			if details, ok := resMap["details"].(map[string]any); ok {
				if code, ok := details["exitCode"].(float64); ok {
					detail["exitCode"] = int(code)
				}
			}
		}
		return detail

	case "read":
		filePath, _ := argsMap["path"].(string)
		if filePath == "" {
			filePath, _ = argsMap["filePath"].(string)
		}
		if filePath == "" {
			filePath = "(file)"
		}
		detail := map[string]any{
			"type":     "read",
			"filePath": filePath,
		}
		if outText != "" {
			detail["content"] = outText
		}
		if off, ok := argsMap["offset"].(float64); ok {
			detail["offset"] = int(off)
		}
		if lim, ok := argsMap["limit"].(float64); ok {
			detail["limit"] = int(lim)
		}
		return detail

	case "edit":
		filePath, _ := argsMap["path"].(string)
		if filePath == "" {
			filePath, _ = argsMap["filePath"].(string)
		}
		if filePath == "" {
			filePath = "(file)"
		}
		oldStr, _ := argsMap["oldText"].(string)
		newStr, _ := argsMap["newText"].(string)
		if editsArr, ok := argsMap["edits"].([]any); ok && len(editsArr) > 0 {
			if first, ok := editsArr[0].(map[string]any); ok {
				if oldStr == "" {
					oldStr, _ = first["oldText"].(string)
				}
				if newStr == "" {
					newStr, _ = first["newText"].(string)
				}
			}
		}
		detail := map[string]any{
			"type":     "edit",
			"filePath": filePath,
		}
		if oldStr != "" {
			detail["oldString"] = oldStr
		}
		if newStr != "" {
			detail["newString"] = newStr
		}
		return detail

	case "write":
		filePath, _ := argsMap["path"].(string)
		if filePath == "" {
			filePath, _ = argsMap["filePath"].(string)
		}
		if filePath == "" {
			filePath = "(file)"
		}
		content, _ := argsMap["content"].(string)
		detail := map[string]any{
			"type":     "write",
			"filePath": filePath,
		}
		if content != "" {
			detail["content"] = content
		}
		return detail

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

func extractResultText(result any) string {
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

// MapExtensionUIRequestToPermission converts a Pi extension_ui_request event into a BySpace
// AgentPermissionRequest payload. Returns nil for non-interactive status notifications.
func MapExtensionUIRequestToPermission(ev map[string]any) map[string]any {
	id, _ := ev["id"].(string)
	method, _ := ev["method"].(string)
	if id == "" || method == "" {
		return nil
	}

	title, _ := ev["title"].(string)
	message, _ := ev["message"].(string)
	placeholder, _ := ev["placeholder"].(string)

	switch method {
	case "select":
		q := strings.TrimSpace(title)
		if q == "" {
			q = "Select an option"
		}
		var opts []map[string]any
		if rawOpts, ok := ev["options"].([]any); ok {
			for _, o := range rawOpts {
				if s, ok := o.(string); ok && s != "" {
					opts = append(opts, map[string]any{"label": s})
				}
			}
		}
		if opts == nil {
			opts = []map[string]any{}
		}
		return buildQuestionPermission(id, method, q, opts, placeholder, false)

	case "confirm":
		var parts []string
		if strings.TrimSpace(title) != "" {
			parts = append(parts, strings.TrimSpace(title))
		}
		if strings.TrimSpace(message) != "" {
			parts = append(parts, strings.TrimSpace(message))
		}
		q := strings.Join(parts, "\n\n")
		if q == "" {
			q = "Confirm action"
		}
		opts := []map[string]any{
			{"label": "Yes"},
			{"label": "No"},
		}
		return buildQuestionPermission(id, method, q, opts, "", false)

	case "input", "editor":
		q := strings.TrimSpace(title)
		if q == "" {
			q = strings.TrimSpace(placeholder)
		}
		if q == "" {
			q = "Provide input"
		}
		return buildQuestionPermission(id, method, q, []map[string]any{}, placeholder, true)

	default:
		return nil
	}
}

func buildQuestionPermission(id, method, question string, options []map[string]any, placeholder string, allowEmpty bool) map[string]any {
	qObj := map[string]any{
		"question":    question,
		"header":      QuestionResponseHeader,
		"options":     options,
		"multiSelect": false,
	}
	if placeholder != "" {
		qObj["placeholder"] = placeholder
	}
	if allowEmpty {
		qObj["allowEmpty"] = true
	}
	return map[string]any{
		"id":       id,
		"provider": "pi",
		"name":     "Pi " + method,
		"kind":     "question",
		"title":    question,
		"input": map[string]any{
			"questions": []map[string]any{qObj},
		},
		"metadata": map[string]any{
			"extensionUiMethod": method,
			"answerHeader":      QuestionResponseHeader,
		},
	}
}

// BuildExtensionUIResponse converts a BySpace AgentPermissionResponse into a Pi extension_ui_response frame.
func BuildExtensionUIResponse(id string, req map[string]any, resp map[string]any) map[string]any {
	frame := map[string]any{
		"type": "extension_ui_response",
		"id":   id,
	}
	behavior, _ := resp["behavior"].(string)
	if behavior == "deny" {
		frame["cancelled"] = true
		return frame
	}

	var method string
	if meta, ok := req["metadata"].(map[string]any); ok {
		method, _ = meta["extensionUiMethod"].(string)
	}

	answer := extractFirstAnswer(resp["updatedInput"])
	if answer == "" {
		if method == "confirm" {
			frame["confirmed"] = true
			return frame
		}
		frame["cancelled"] = true
		return frame
	}

	if method == "confirm" {
		frame["confirmed"] = strings.EqualFold(strings.TrimSpace(answer), "yes") || strings.EqualFold(strings.TrimSpace(answer), "true")
		return frame
	}
	frame["value"] = answer
	return frame
}

func extractFirstAnswer(updatedInput any) string {
	m, ok := updatedInput.(map[string]any)
	if !ok {
		return ""
	}
	if ans, ok := m["answers"].(map[string]any); ok {
		for _, v := range ans {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	if v, ok := m[QuestionResponseHeader].(string); ok {
		return v
	}
	for _, v := range m {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
