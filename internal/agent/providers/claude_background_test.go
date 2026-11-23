package providers

import (
	"context"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestClaudeBackgroundInventoryUsesNativeMetadata(t *testing.T) {
	s := &ClaudeSession{}
	s.handleClaudeBackgroundTasksLocked([]any{map[string]any{
		"task_id": "task-1", "description": "Run tests", "command": "go test ./internal/agent/providers",
		"type": "shell", "status": "running", "started_at": "2026-01-02T03:04:05Z",
	}})
	tasks, err := s.ManageBackgroundTerminal(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].Description == nil || *tasks[0].Description != "Run tests" || tasks[0].Kind != "shell" || !tasks[0].CanStop || tasks[0].StartedAt == nil || *tasks[0].StartedAt == "" {
		t.Fatalf("tasks = %#v", tasks)
	}
}

func TestClaudeBackgroundStopDoesNotFabricateSuccess(t *testing.T) {
	s := &ClaudeSession{backgroundTasks: []sdk.BackgroundTask{{ID: "task-1", Status: "running", CanStop: true}}}
	if _, err := s.ManageBackgroundTerminal(context.Background(), "task-1"); err == nil {
		t.Fatal("expected a native control error without a running process")
	}
	if s.backgroundTasks[0].Status != "running" || s.backgroundStops["task-1"] {
		t.Fatalf("stop fabricated terminal state: %#v %#v", s.backgroundTasks, s.backgroundStops)
	}
}
