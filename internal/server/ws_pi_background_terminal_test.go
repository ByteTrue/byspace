package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
)

type piBackgroundTerminalSession struct {
	providers.ManagedSession
	calls int
}

func (s *piBackgroundTerminalSession) ManageBackgroundTerminal(_ context.Context, taskID string) ([]pi.BackgroundTerminalTask, error) {
	s.calls++
	tasks := []pi.BackgroundTerminalTask{{ID: "task-1", Command: "npm run dev", Status: "running"}}
	if taskID == tasks[0].ID {
		tasks[0].Status = "killed"
	}
	return tasks, nil
}

func TestPiManageBackgroundTerminal(t *testing.T) {
	const runningRoster = `[{"id":"task-1","command":"npm run dev","status":"running"}]`
	const stoppedRoster = `[{"id":"task-1","command":"npm run dev","status":"killed"}]`
	for _, tc := range []struct {
		name, params, tasks, responseError string
		permissions                        []string
		calls                              int
	}{
		{name: "list", tasks: runningRoster, responseError: "null", permissions: []string{"workspace.read"}, calls: 1},
		{name: "empty task lists", params: `,"taskId":""`, tasks: runningRoster, responseError: "null", permissions: []string{"workspace.read"}, calls: 1},
		{name: "stop", params: `,"taskId":"task-1"`, tasks: stoppedRoster, responseError: "null", permissions: []string{"workspace.read", "workspace.write"}, calls: 1},
		{name: "reject read-only stop", params: `,"taskId":"task-1"`, tasks: "null", responseError: `"Permission denied: stopping a background terminal requires workspace.write"`, permissions: []string{"workspace.read"}},
		{name: "cold agent", tasks: "null", responseError: `"Background Terminal requires a running Pi agent"`, permissions: []string{"workspace.read"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			piSession := &piBackgroundTerminalSession{}
			srv := &Server{metrics: newRuntimeMetrics(), agents: map[string]*managedPi{}}
			if tc.name != "cold agent" {
				srv.agents["pi-agent"] = &managedPi{session: piSession}
			}
			sink := &recordingSink{}
			srv.SetSinkPermissions(sink, tc.permissions)
			raw := json.RawMessage(`{"type":"agent.pi.manage_background_terminal.request","requestId":"req-1","agentId":"pi-agent"` + tc.params + `}`)
			srv.handleSessionMessage(context.Background(), sink, raw)
			want := `{"message":{"payload":{"error":` + tc.responseError + `,"requestId":"req-1","tasks":` + tc.tasks + `},"type":"agent.pi.manage_background_terminal.response"},"type":"session"}`
			if len(sink.texts) != 1 || sink.texts[0] != want {
				t.Fatalf("response = %v, want %s", sink.texts, want)
			}
			if piSession.calls != tc.calls {
				t.Fatalf("Pi calls = %d, want %d", piSession.calls, tc.calls)
			}
		})
	}
}
