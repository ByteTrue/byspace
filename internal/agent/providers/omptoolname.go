package providers

import "strings"

// ResolveOmpToolCallName returns the tool name a card should show.
//
// Ported from resolveToolCallName. omp wraps some calls in an `xdev` tool whose result names the tool it
// actually ran; without unwrapping, every such call shows as "xdev" and the card's detail is built from the
// wrong argument shape — the user sees a generic row instead of the command or file.
func ResolveOmpToolCallName(toolName string, result any) string {
	trimmed := strings.TrimSpace(toolName)
	if !strings.EqualFold(trimmed, "xdev") {
		return trimmed
	}
	record, ok := result.(map[string]any)
	if !ok {
		return trimmed
	}
	details, ok := record["details"].(map[string]any)
	if !ok {
		return trimmed
	}
	inner, ok := details["xdev"].(map[string]any)
	if !ok {
		return trimmed
	}
	if name, ok := inner["tool"].(string); ok {
		if resolved := strings.TrimSpace(name); resolved != "" {
			return resolved
		}
	}
	return trimmed
}
