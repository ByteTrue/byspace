package pi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// BackgroundTerminalTask is the task card sent to BySpace, without log paths or output.
type BackgroundTerminalTask struct {
	ID      string `json:"id"`
	Command string `json:"command"`
	Status  string `json:"status"`
}

// ManageBackgroundTerminal lists the active Pi session's tasks, optionally stopping one first.
//
// Availability needs no probe: when the third-party extension is absent nothing listens on the
// manage event and the bridge replies with a null roster, which is exactly the unavailable signal.
func (s *Session) ManageBackgroundTerminal(ctx context.Context, taskID string) ([]BackgroundTerminalTask, error) {
	// A stop must outlast the extension's own 5s settle wait, or every confirmed kill would race
	// the daemon budget and surface as a spurious deadline error.
	budget := 5 * time.Second
	if taskID != "" {
		budget = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	requestID := fmt.Sprintf("bgterm_%d", time.Now().UnixNano())
	result := s.awaitCommandResult(requestID)
	defer s.dropCommandWaiter(requestID)
	payload, _ := json.Marshal(struct {
		RequestID string `json:"requestId"`
		TaskID    string `json:"taskId,omitempty"`
	}{requestID, taskID})
	if _, err := s.proc.Request(ctx, map[string]any{"type": "prompt", "message": "/" + backgroundTerminalCommand + " " + base64.RawURLEncoding.EncodeToString(payload)}); err != nil {
		return nil, err
	}
	select {
	case reply := <-result:
		if !reply.ok {
			return nil, errors.New(reply.err)
		}
		var tasks []BackgroundTerminalTask
		if err := json.Unmarshal(reply.result, &tasks); err != nil {
			return nil, err
		}
		// The status enum belongs to a third-party extension that updates on its own; an unknown
		// status must not fail the client's whole-frame validation. Keep the row visible and
		// stoppable instead.
		for i := range tasks {
			switch tasks[i].Status {
			case "running", "exited", "failed", "timed_out", "killed":
			default:
				tasks[i].Status = "running"
			}
		}
		return tasks, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
