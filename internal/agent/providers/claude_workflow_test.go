package providers

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestClaudeWorkflowOutputWaitsForNativeFile(t *testing.T) {
	output := filepath.Join(t.TempDir(), "workflow-output.json")
	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = os.WriteFile(output, []byte(`{"result":{"report":"report ready"}}`), 0o600)
	}()
	if got := readClaudeWorkflowOutputWithWait(output); got != "report ready" {
		t.Fatalf("workflow output = %q", got)
	}
}

func TestClaudeWorkflowToolFallbackLinksNativeResult(t *testing.T) {
	s := &ClaudeSession{subagents: make(map[string]sdk.SubagentDescriptor)}
	if event := s.declareClaudeWorkflowLocked("workflow-call"); event == nil {
		t.Fatal("Workflow tool did not declare a subagent row")
	}
	result := "Workflow launched in background. Task ID: task-1\nSummary: Inspect BySpace\nRun ID: wf-1"
	s.observeClaudeWorkflowResultLocked("workflow-call", result, false)
	descriptor := s.subagents["workflow-call"]
	if descriptor.Title == nil || *descriptor.Title != "Workflow" || descriptor.Description == nil || *descriptor.Description != "" || descriptor.Subtitle == nil || *descriptor.Subtitle != "Workflow" {
		t.Fatalf("workflow presentation = %#v", descriptor)
	}
	if s.nativeTaskIDs["task-1"] != "workflow-call" || s.nativeTaskIDs["wf-1"] != "workflow-call" {
		t.Fatalf("native task links = %#v", s.nativeTaskIDs)
	}
	output := filepath.Join(t.TempDir(), "workflow-output.json")
	if err := os.WriteFile(output, []byte("{\"result\":{\"report\":\"## What BySpace is\\nA local agent controller.\"}}"), 0o600); err != nil {
		t.Fatal(err)
	}
	s.handleClaudeTaskLocked("task_notification", map[string]any{
		"task_id": "task-1", "status": "completed",
		"content": "<task-notification><output-file>" + output + "</output-file></task-notification>",
		"summary": "Dynamic workflow completed",
	})
	entries := s.subagentTimelines["workflow-call"]
	if len(entries) != 2 || entries[0].Item.Text != "Inspect BySpace" || entries[1].Item.Text != "## What BySpace is\nA local agent controller." {
		t.Fatalf("workflow timeline = %#v", entries)
	}
	if got := s.subagents["workflow-call"]; got.Status != "completed" || got.Description == nil || *got.Description != "" || got.Title == nil || *got.Title != "Workflow" {
		t.Fatalf("workflow completion presentation = %#v", got)
	}
}
