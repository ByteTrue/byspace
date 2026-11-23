package providers

import (
	"context"
	"fmt"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *ClaudeSession) ManageBackgroundTerminal(ctx context.Context, taskID string) ([]sdk.BackgroundTask, error) {
	if taskID == "" {
		s.mu.Lock()
		defer s.mu.Unlock()
		return append([]sdk.BackgroundTask(nil), s.backgroundTasks...), nil
	}
	s.mu.Lock()
	var task *sdk.BackgroundTask
	for i := range s.backgroundTasks {
		if s.backgroundTasks[i].ID == taskID {
			task = &s.backgroundTasks[i]
			break
		}
	}
	if task == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("background task not found: %s", taskID)
	}
	if !task.CanStop || task.Status != "running" {
		s.mu.Unlock()
		return nil, fmt.Errorf("background task is not running: %s", taskID)
	}
	if s.backgroundStops[taskID] {
		s.mu.Unlock()
		return nil, fmt.Errorf("background task stop is already pending: %s", taskID)
	}
	if s.backgroundStops == nil {
		s.backgroundStops = make(map[string]bool)
	}
	s.backgroundStops[taskID] = true
	s.mu.Unlock()
	if _, err := s.control(ctx, "stop_task", map[string]any{"task_id": taskID}); err != nil {
		s.mu.Lock()
		delete(s.backgroundStops, taskID)
		s.mu.Unlock()
		return nil, err
	}
	// The authoritative status arrives in background_tasks_changed/task_notification. Do not
	// claim a task stopped merely because the CLI accepted the control request.
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]sdk.BackgroundTask(nil), s.backgroundTasks...), nil
}

func (s *ClaudeSession) handleClaudeBackgroundTasksLocked(tasks []any) {
	inventory := make([]sdk.BackgroundTask, 0, len(tasks))
	for _, raw := range tasks {
		task, _ := raw.(map[string]any)
		id, _ := task["task_id"].(string)
		if id == "" {
			continue
		}
		command, _ := task["command"].(string)
		description, _ := task["description"].(string)
		kind, _ := task["type"].(string)
		if kind == "" {
			kind = "shell"
		}
		startedAt := claudeBackgroundTime(task["started_at"])
		nativeSessionID, _ := task["task_id"].(string)
		inventory = append(inventory, sdk.BackgroundTask{
			ID: id, Command: command, Description: &description, Kind: kind,
			Status: claudeNativeTaskStatus(task["status"]), StartedAt: &startedAt,
			CanStop: claudeNativeTaskStatus(task["status"]) == "running", NativeSessionID: nativeSessionID,
		})
		delete(s.backgroundStops, id)
	}
	s.backgroundTasks = inventory
}

func claudeBackgroundTime(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	case float64:
		if value > 1e12 {
			value /= 1000
		}
		return time.Unix(int64(value), 0).UTC().Format(time.RFC3339)
	default:
		return ""
	}
}
