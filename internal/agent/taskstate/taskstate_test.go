package taskstate

import "testing"

// TodoWrite sends the whole list in its input, so the card updates before the tool finishes.
func TestTodoWriteReplacesTheList(t *testing.T) {
	s := New()
	snapshot := s.ObserveCall("c1", "TodoWrite", map[string]any{
		"todos": []any{
			map[string]any{"content": "read the file", "status": "completed"},
			map[string]any{"content": "fix the bug", "status": "in_progress", "activeForm": "fixing the bug"},
		},
	})
	if snapshot == nil || len(snapshot.Items) != 2 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot.Items[0].Status != "completed" || !snapshot.Items[0].Completed {
		t.Fatalf("item 0 = %+v", snapshot.Items[0])
	}
	if snapshot.Items[1].Status != "in_progress" || snapshot.Items[1].ActiveForm != "fixing the bug" {
		t.Fatalf("item 1 = %+v", snapshot.Items[1])
	}
	if snapshot.Type != "todo" {
		t.Fatalf("type = %q", snapshot.Type)
	}

	// A second TodoWrite replaces rather than appends.
	snapshot = s.ObserveCall("c2", "TodoWrite", map[string]any{
		"todos": []any{map[string]any{"content": "only one", "status": "pending"}},
	})
	if len(snapshot.Items) != 1 || snapshot.Items[0].Text != "only one" {
		t.Fatalf("replace = %+v", snapshot.Items)
	}
}

// TaskCreate reports its effect in the result, and the id comes from there.
func TestTaskCreateFromResult(t *testing.T) {
	s := New()
	if got := s.ObserveCall("c1", "TaskCreate", map[string]any{"subject": "write the test"}); got != nil {
		t.Fatalf("a create has no effect until its result: %+v", got)
	}
	snapshot := s.ObserveResult("c1", map[string]any{
		"task": map[string]any{"id": "t1", "subject": "write the test"},
	})
	if snapshot == nil || len(snapshot.Items) != 1 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot.Items[0].ID != "t1" || snapshot.Items[0].Status != "pending" {
		t.Fatalf("item = %+v", snapshot.Items[0])
	}
}

// A TaskUpdate result reports the transition; deleting removes the row rather than marking it.
func TestTaskUpdateTransitions(t *testing.T) {
	s := New()
	s.ObserveCall("c1", "TaskCreate", map[string]any{"subject": "a"})
	s.ObserveResult("c1", map[string]any{"task": map[string]any{"id": "t1", "subject": "a"}})

	// The transition arrives in the result, not the input.
	s.ObserveCall("c2", "TaskUpdate", map[string]any{"taskId": "t1"})
	snapshot := s.ObserveResult("c2", map[string]any{"statusChange": map[string]any{"to": "completed"}})
	if snapshot == nil || snapshot.Items[0].Status != "completed" || !snapshot.Items[0].Completed {
		t.Fatalf("snapshot = %+v", snapshot)
	}

	// Deleting removes it: a deleted task is gone from the plan, not a checked-off row.
	s.ObserveCall("c3", "TaskUpdate", map[string]any{"taskId": "t1", "status": "deleted"})
	snapshot = s.ObserveResult("c3", nil)
	if snapshot == nil || len(snapshot.Items) != 0 {
		t.Fatalf("after delete = %+v", snapshot)
	}
}

// A failed call changed nothing; applying its error object as data would invent tasks.
func TestFailedCallChangesNothing(t *testing.T) {
	s := New()
	s.ObserveCall("c1", "TaskCreate", map[string]any{"subject": "a"})
	if got := s.ObserveResult("c1", map[string]any{"success": false, "task": map[string]any{"id": "t1", "subject": "a"}}); got != nil {
		t.Fatalf("a failed call produced a snapshot: %+v", got)
	}
	if got := s.ObserveResult("c1", map[string]any{"task": map[string]any{"id": "t1", "subject": "a"}}); got != nil {
		t.Fatalf("the result was applied twice: %+v", got)
	}
}

// An update for a task we never saw would create a row with no text.
func TestUpdateOfUnknownTaskIsIgnored(t *testing.T) {
	s := New()
	s.ObserveCall("c1", "TaskUpdate", map[string]any{"taskId": "nope", "status": "completed"})
	if got := s.ObserveResult("c1", nil); got != nil {
		t.Fatalf("snapshot = %+v", got)
	}
}

// TaskList replaces the list wholesale.
func TestTaskListReplaces(t *testing.T) {
	s := New()
	s.ObserveCall("c0", "TodoWrite", map[string]any{"todos": []any{map[string]any{"content": "old"}}})
	s.ObserveCall("c1", "TaskList", nil)
	snapshot := s.ObserveResult("c1", map[string]any{
		"tasks": []any{
			map[string]any{"id": "t1", "subject": "a", "status": "completed"},
			map[string]any{"id": "t2", "subject": "b", "status": "pending"},
		},
	})
	if snapshot == nil || len(snapshot.Items) != 2 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot.Items[0].ID != "t1" || !snapshot.Items[0].Completed {
		t.Fatalf("item 0 = %+v", snapshot.Items[0])
	}
}

// A non-task tool is not observed at all.
func TestNonTaskToolIgnored(t *testing.T) {
	s := New()
	if got := s.ObserveCall("c1", "Bash", map[string]any{"command": "ls"}); got != nil {
		t.Fatalf("snapshot = %+v", got)
	}
	if IsTaskTool("Bash") {
		t.Fatal("Bash is not a task tool")
	}
	for _, name := range []string{"TodoWrite", "taskcreate", "TaskUpdate", "TASKLIST"} {
		if !IsTaskTool(name) {
			t.Fatalf("%q should be a task tool", name)
		}
	}
}
