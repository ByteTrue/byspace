package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// ManageBackgroundTerminal reads OpenCode's native v2 shell roster. OpenCode v1 has no shell API.
func (s *OpenCodeSession) ManageBackgroundTerminal(ctx context.Context, taskID string) ([]sdk.BackgroundTask, error) {
	if s.version != 2 {
		return nil, nil
	}
	tasks, err := s.listOpenCodeBackgroundTasks(ctx)
	if err != nil {
		return nil, err
	}
	if taskID != "" {
		owned := false
		for _, task := range tasks {
			if task.ID == taskID {
				owned = true
				break
			}
		}
		if !owned {
			return nil, fmt.Errorf("OpenCode background shell %s is not running in this session", taskID)
		}
		path := "/api/shell/" + url.PathEscape(taskID) + "?directory=" + url.QueryEscape(s.cwd)
		if err := s.requestOpenCodeV2(ctx, http.MethodDelete, path, nil); err != nil {
			return nil, err
		}
		tasks, err = s.listOpenCodeBackgroundTasks(ctx)
		if err != nil {
			return nil, err
		}
	}
	if taskID != "" {
		for _, task := range tasks {
			if task.ID == taskID && task.Status == "running" {
				return nil, fmt.Errorf("OpenCode background shell %s is still running", taskID)
			}
		}
	}
	return tasks, nil
}

func (s *OpenCodeSession) listOpenCodeBackgroundTasks(ctx context.Context) ([]sdk.BackgroundTask, error) {
	path := "/api/shell?directory=" + url.QueryEscape(s.cwd)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("opencode background shells: %s", resp.Status)
	}
	var payload any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	rows, ok := payload.([]any)
	if !ok {
		object, _ := payload.(map[string]any)
		rows, _ = object["data"].([]any)
	}
	tasks := make([]sdk.BackgroundTask, 0, len(rows))
	for _, raw := range rows {
		shell, _ := raw.(map[string]any)
		id, _ := shell["id"].(string)
		status, _ := shell["status"].(string)
		metadata, _ := shell["metadata"].(map[string]any)
		sessionID, _ := metadata["sessionID"].(string)
		if id == "" || sessionID != s.sessionID || status != "running" {
			continue
		}
		command, _ := shell["command"].(string)
		description, _ := metadata["description"].(string)
		if description == "" {
			description, _ = shell["description"].(string)
		}
		task := sdk.BackgroundTask{
			ID: id, Kind: "shell", Status: status, CanStop: true,
			Command: command, Description: optionalBackgroundString(description),
			StartedAt: openCodeBackgroundStartedAt(shell),
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func optionalBackgroundString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func openCodeBackgroundStartedAt(shell map[string]any) *string {
	timeFields, _ := shell["time"].(map[string]any)
	created, ok := timeFields["created"].(float64)
	if !ok || created <= 0 {
		return nil
	}
	value := time.UnixMilli(int64(created)).UTC().Format(time.RFC3339Nano)
	return &value
}
