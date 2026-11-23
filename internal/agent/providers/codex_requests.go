package providers

import (
	"fmt"
	"sort"
	"strings"
)

// codexNativeQuestionAnswers restores the native question ids and answer arrays.
func codexNativeQuestionAnswers(resp, pending map[string]any) map[string]any {
	input, _ := pending["input"].(map[string]any)
	questions, _ := input["questions"].([]map[string]any)
	if len(questions) == 0 {
		raw, _ := input["questions"].([]any)
		for _, item := range raw {
			if question, ok := item.(map[string]any); ok {
				questions = append(questions, question)
			}
		}
	}
	updated, _ := resp["updatedInput"].(map[string]any)
	rawAnswers := updated["answers"]
	result := make(map[string]any, len(questions))
	for index, question := range questions {
		id, _ := question["id"].(string)
		if id == "" {
			id = fmt.Sprintf("%d", index)
		}
		answer := ""
		switch values := rawAnswers.(type) {
		case map[string]any:
			answer, _ = values[id].(string)
		case []any:
			if index < len(values) {
				answer, _ = values[index].(string)
			}
		case string:
			if index == 0 {
				answer = values
			}
		}
		if answer == "" {
			if fallback, ok := resp["answer"].(string); ok && index == 0 {
				answer = fallback
			}
		}
		answers := []string{answer}
		if question["multiSelect"] == true {
			answers = nil
			for _, value := range strings.Split(answer, ",") {
				if value = strings.TrimSpace(value); value != "" {
					answers = append(answers, value)
				}
			}
		}
		result[id] = map[string]any{"answers": answers}
	}
	return result
}

func sortedCodexPermissionIDs(permissions map[string]map[string]any) []string {
	ids := make([]string, 0, len(permissions))
	for id := range permissions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
