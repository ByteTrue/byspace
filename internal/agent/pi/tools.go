package pi

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

const QuestionResponseHeader = sdk.QuestionResponseHeader

// BuildToolCallDetail and ExtractResultText are shared provider vocabulary; the definition
// lives in internal/agent/sdk. Aliased here because pi call sites read better unqualified.
func BuildToolCallDetail(toolName string, args any, result any) map[string]any {
	return sdk.BuildToolCallDetail(toolName, args, result)
}

func extractResultText(result any) string { return sdk.ExtractResultText(result) }

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
