package providers

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// OmpToolDetail builds the card detail for an omp tool call.
//
// Ported from omp/tool-call-mapper.ts. omp puts the useful fields inside the RESULT (path, oldText,
// newText, diff) rather than in the call arguments, so the generic builder — which reads arguments — gets a
// card with no file and no diff. The three tools below are the ones where that matters.
//
// Returns nil for `todo`: that tool's output is a task list, which the todo timeline item renders. Emitting a
// card for it as well shows the same information twice, the second time as a generic row.
func OmpToolDetail(toolName string, args any, result any) map[string]any {
	name := strings.ToLower(strings.TrimSpace(toolName))
	if name == "todo" {
		return nil
	}
	if name == "task" {
		// The sub-agent card is built from the arguments plus whatever the result names, so the
		// generic subagent branch is the right shape once the name is resolved.
		return sdk.BuildToolCallDetail("subagent", args, result)
	}
	if name == "edit" || name == "read" {
		return ompFileDetail(name, args, result)
	}
	return sdk.BuildToolCallDetail(toolName, args, result)
}

// ompFileDetail builds an edit/read card from the result's own fields.
func ompFileDetail(kind string, args, result any) map[string]any {
	details := ompResultDetails(result)
	filePath := firstOf(details["path"], details["filePath"])
	if filePath == "" {
		filePath = ompPatchInputPath(args)
	}
	if filePath == "" {
		// No path anywhere: fall back to the generic builder so the card still has a shape.
		return sdk.BuildToolCallDetail(kind, args, result)
	}

	detail := map[string]any{"type": kind, "filePath": filePath}
	if kind == "edit" {
		oldText := firstOf(details["oldText"], details["old_string"])
		newText := firstOf(details["newText"], details["new_string"])
		diff := firstOf(details["diff"])
		if oldText != "" {
			detail["oldString"] = oldText
		}
		if newText != "" {
			detail["newString"] = newText
		}
		// The unified diff is what the card renders as the change; without it an edit whose old/new text
		// is absent (omp reports a patch instead) shows nothing.
		if diff != "" {
			detail["unifiedDiff"] = diff
		}
		return detail
	}

	// read: the content lives in the result's text, which the generic extractor already handles.
	content := sdk.ExtractResultText(result)
	if content != "" {
		detail["content"] = content
	}
	return detail
}

// ompResultDetails reads the `details` object out of a tool result.
//
// A result can be the details object itself or a wrapper with a `details` key; both shapes appear.
func ompResultDetails(result any) map[string]any {
	record, ok := result.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	if details, ok := record["details"].(map[string]any); ok {
		return details
	}
	return record
}

// ompPatchInputPath finds a path in a patch-style argument.
//
// A patch arguments object has no `filePath`: the path is inside the patch text's header. Reading it is what
// keeps the card from falling back to a generic row for every patch edit.
func ompPatchInputPath(args any) string {
	record, ok := args.(map[string]any)
	if !ok {
		return ""
	}
	if path := firstOf(record["path"], record["filePath"], record["file"]); path != "" {
		return path
	}
	patch := firstOf(record["patch"], record["diff"])
	if patch == "" {
		return ""
	}
	for _, line := range strings.Split(patch, "\n") {
		trimmed := strings.TrimSpace(line)
		// `*** Update File: path` and `+++ b/path` are the two headers omp's patches carry.
		if rest, ok := strings.CutPrefix(trimmed, "*** Update File:"); ok {
			return strings.TrimSpace(rest)
		}
		if rest, ok := strings.CutPrefix(trimmed, "+++ b/"); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

// firstOf returns the first non-empty trimmed string.
func firstOf(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok {
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}
