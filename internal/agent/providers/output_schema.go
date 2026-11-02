package providers

import (
	"errors"
	"fmt"
	"sort"
)

// OutputSchemaSetter is a session that can constrain its next reply to a JSON Schema.
//
// Ported from the archived Node daemon's AgentRunOptions.outputSchema: `byspace run
// --output-schema` sends it with the initial prompt, and only Codex and OpenCode honour it. The
// other providers ignore it there too.
type OutputSchemaSetter interface {
	// SetNextOutputSchema applies schema to the next Prompt. It returns an error when the provider
	// cannot use the schema, so the request fails instead of the run ignoring it.
	SetNextOutputSchema(schema any) error
}

// normalizeCodexOutputSchema makes a schema acceptable to Codex structured outputs: every object
// closes its properties (additionalProperties false) and requires all of them. Ported from
// normalizeCodexOutputSchema in codex-app-server-agent.ts.
func normalizeCodexOutputSchema(schema any) (map[string]any, error) {
	root, ok := schema.(map[string]any)
	if !ok {
		return nil, errors.New("Codex structured outputs require a JSON object schema.")
	}
	normalized, err := normalizeCodexOutputSchemaNode(root, "$")
	if err != nil {
		return nil, err
	}
	object, ok := normalized.(map[string]any)
	if !ok || !isObjectSchemaNode(object) {
		return nil, errors.New("Codex structured outputs require a root object schema.")
	}
	return object, nil
}

func normalizeCodexOutputSchemaNode(schema any, path string) (any, error) {
	switch node := schema.(type) {
	case []any:
		out := make([]any, len(node))
		for index, entry := range node {
			normalized, err := normalizeCodexOutputSchemaNode(entry, fmt.Sprintf("%s[%d]", path, index))
			if err != nil {
				return nil, err
			}
			out[index] = normalized
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(node))
		for key, value := range node {
			normalized, err := normalizeCodexOutputSchemaNode(value, path+"."+key)
			if err != nil {
				return nil, err
			}
			out[key] = normalized
		}
		if !isObjectSchemaNode(out) {
			return out, nil
		}
		if additional, present := out["additionalProperties"]; !present {
			out["additionalProperties"] = false
		} else if additional != false {
			return nil, fmt.Errorf("Codex structured outputs require %s to set additionalProperties to false for object schemas.", path)
		}
		properties, ok := out["properties"].(map[string]any)
		if !ok {
			return out, nil
		}
		required := []string{}
		seen := map[string]bool{}
		if existing, ok := out["required"].([]any); ok {
			for _, entry := range existing {
				if name, isString := entry.(string); isString && !seen[name] {
					seen[name] = true
					required = append(required, name)
				}
			}
		}
		keys := make([]string, 0, len(properties))
		for key := range properties {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if !seen[key] {
				seen[key] = true
				required = append(required, key)
			}
		}
		requiredAny := make([]any, len(required))
		for index, name := range required {
			requiredAny[index] = name
		}
		out["required"] = requiredAny
		return out, nil
	default:
		return schema, nil
	}
}

// isObjectSchemaNode: a node typed "object", or one that declares properties.
func isObjectSchemaNode(node map[string]any) bool {
	switch typed := node["type"].(type) {
	case string:
		if typed == "object" {
			return true
		}
	case []any:
		for _, entry := range typed {
			if entry == "object" {
				return true
			}
		}
	}
	_, hasProperties := node["properties"].(map[string]any)
	return hasProperties
}
