package tasknotify

import (
	"strings"
	"testing"
)

// Go skipped these as ordinary user content, so a task the user launched in the background finished without a trace.
func TestMapCompleted(t *testing.T) {
	content := "<task-notification><task-id>t7</task-id><status>completed</status>" +
		"<summary>indexed 42 files</summary><output-file>/tmp/out.txt</output-file></task-notification>"
	card := Map(content)
	if card == nil {
		t.Fatal("no card")
	}
	if card.CallID != "task_notification_t7" || card.Name != "task_notification" {
		t.Fatalf("card = %+v", card)
	}
	if card.Status != "completed" || card.Error != nil {
		t.Fatalf("status = %q error = %v", card.Status, card.Error)
	}
	if card.Detail["label"] != "indexed 42 files" || card.Detail["icon"] != "wrench" {
		t.Fatalf("detail = %+v", card.Detail)
	}
	if card.Metadata["source"] != "claude_task_notification" || card.Metadata["taskId"] != "t7" {
		t.Fatalf("metadata = %+v", card.Metadata)
	}
	if card.Metadata["outputFile"] != "/tmp/out.txt" {
		t.Fatalf("outputFile = %v", card.Metadata["outputFile"])
	}
}

// A failed task carries its summary as the error, which is what the card shows under the title.
func TestMapFailed(t *testing.T) {
	card := Map("<task-notification><task-id>t1</task-id><status>failed</status>" +
		"<summary>command exited 1</summary></task-notification>")
	if card.Status != "failed" {
		t.Fatalf("status = %q", card.Status)
	}
	errRecord, ok := card.Error.(map[string]any)
	if !ok || errRecord["message"] != "command exited 1" {
		t.Fatalf("error = %v", card.Error)
	}
}

// A failed task with no summary still needs a message: an empty error renders as a blank row.
func TestMapFailedWithoutSummary(t *testing.T) {
	card := Map("<task-notification><task-id>t2</task-id><status>failed</status></task-notification>")
	errRecord, ok := card.Error.(map[string]any)
	if !ok || errRecord["message"] != "Background task failed" {
		t.Fatalf("error = %v", card.Error)
	}
}

func TestMapCanceled(t *testing.T) {
	for _, status := range []string{"canceled", "cancelled"} {
		card := Map("<task-notification><task-id>t3</task-id><status>" + status + "</status></task-notification>")
		if card.Status != "canceled" || card.Error != nil {
			t.Fatalf("%s → %q %v", status, card.Status, card.Error)
		}
	}
}

// The array form is what a message with an image or a formatted block uses; checking only the string case misses it.
func TestMapFromContentBlocks(t *testing.T) {
	content := []any{
		map[string]any{"type": "text", "text": "noise"},
		map[string]any{"type": "text", "text": "<task-notification><task-id>t9</task-id><status>completed</status></task-notification>"},
	}
	if !IsNotification(content) {
		t.Fatal("the array form was not recognised")
	}
	card := Map(content)
	if card == nil || card.CallID != "task_notification_t9" {
		t.Fatalf("card = %+v", card)
	}
}

// Tag order does not matter and unknown tags are ignored: the harness's field set can grow.
func TestMapTagOrderAndUnknownTags(t *testing.T) {
	card := Map("<task-notification><extra>ignore me</extra><status>completed</status>" +
		"<task-id>t5</task-id></task-notification>")
	if card.Metadata["taskId"] != "t5" || card.Status != "completed" {
		t.Fatalf("card = %+v", card)
	}
	// An empty tag value is not a value.
	card = Map("<task-notification><task-id></task-id><status>completed</status></task-notification>")
	if _, has := card.Metadata["taskId"]; has {
		t.Fatalf("an empty tag became a value: %+v", card.Metadata)
	}
}

// No task id: a digest of the envelope, because a random id would duplicate the card on every reload.
func TestCallIDIsStableWithoutTaskID(t *testing.T) {
	content := "<task-notification><status>completed</status><summary>same</summary></task-notification>"
	first := Map(content).CallID
	second := Map(content).CallID
	if first != second {
		t.Fatalf("unstable: %q vs %q", first, second)
	}
	if !strings.HasPrefix(first, "task_notification_") || len(first) != len("task_notification_")+12 {
		t.Fatalf("id = %q", first)
	}
}

// Anything else renders nothing, so ordinary user text is not swallowed.
func TestNonNotification(t *testing.T) {
	for _, content := range []any{"hello", "", []any{}, []any{map[string]any{"text": "hi"}}} {
		if Map(content) != nil {
			t.Fatalf("%v produced a card", content)
		}
	}
}
