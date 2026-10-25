package providers

import "testing"

// omp puts the useful fields inside the RESULT, so the generic builder — which reads arguments — produces a
// card with no file and no diff.
func TestOmpToolDetailEditFromResult(t *testing.T) {
	detail := OmpToolDetail("edit", map[string]any{}, map[string]any{
		"details": map[string]any{
			"path":    "/repo/src/a.go",
			"oldText": "old line",
			"newText": "new line",
			"diff":    "@@ -1 +1 @@\n-old line\n+new line",
		},
	})
	if detail == nil || detail["type"] != "edit" {
		t.Fatalf("detail = %+v", detail)
	}
	if detail["filePath"] != "/repo/src/a.go" {
		t.Fatalf("filePath = %v", detail["filePath"])
	}
	if detail["oldString"] != "old line" || detail["newString"] != "new line" {
		t.Fatalf("old/new = %v / %v", detail["oldString"], detail["newString"])
	}
	if detail["unifiedDiff"] == "" {
		t.Fatal("the diff is what the card renders as the change")
	}
}

// A patch argument has no filePath: the path is in the patch header. Reading it keeps the card from falling
// back to a generic row for every patch edit.
func TestOmpToolDetailPatchPath(t *testing.T) {
	detail := OmpToolDetail("edit", map[string]any{
		"patch": "*** Begin Patch\n*** Update File: /repo/b.go\n@@\n-x\n+y\n*** End Patch",
	}, nil)
	if detail == nil || detail["filePath"] != "/repo/b.go" {
		t.Fatalf("detail = %+v", detail)
	}

	detail = OmpToolDetail("edit", map[string]any{
		"diff": "--- a/c.go\n+++ b/c.go\n@@ -1 +1 @@\n-x\n+y",
	}, nil)
	if detail == nil || detail["filePath"] != "c.go" {
		t.Fatalf("diff-header path = %+v", detail)
	}
}

// The todo tool's output is a task list, which the todo timeline item renders. A card for it as well shows
// the same information twice, the second time as a generic row.
func TestOmpToolDetailSkipsTodo(t *testing.T) {
	if got := OmpToolDetail("todo", map[string]any{"todos": []any{}}, nil); got != nil {
		t.Fatalf("todo produced a card: %+v", got)
	}
}

// The task tool becomes a sub-agent card.
func TestOmpToolDetailTask(t *testing.T) {
	detail := OmpToolDetail("task", map[string]any{"agent": "explore", "task": "find the bug"}, nil)
	if detail == nil || detail["type"] != "sub_agent" {
		t.Fatalf("detail = %+v", detail)
	}
}

// A read's content comes from the result text.
func TestOmpToolDetailRead(t *testing.T) {
	detail := OmpToolDetail("read", map[string]any{"path": "/repo/d.go"}, "package d\n")
	if detail == nil || detail["type"] != "read" || detail["filePath"] != "/repo/d.go" {
		t.Fatalf("detail = %+v", detail)
	}
	if detail["content"] != "package d\n" {
		t.Fatalf("content = %v", detail["content"])
	}
}

// The suppression has to be decidable before the result exists, because that is when the card is appended.
// OmpToolDetail answers nil for `todo` from the name alone, which is what makes the early check safe.
func TestOmpTodoIsSuppressedWithoutAResult(t *testing.T) {
	if got := OmpToolDetail("todo", map[string]any{"todos": []any{}}, nil); got != nil {
		t.Fatalf("todo with no result produced a card: %+v", got)
	}
	if got := OmpToolDetail("Todo", nil, nil); got != nil {
		t.Fatalf("the name is case-insensitive: %+v", got)
	}
}
