package providers

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func runningToolTimeline() []sdk.TimelineEntry {
	return []sdk.TimelineEntry{{
		Seq: 1, TurnID: "turn-1",
		Item: sdk.TimelineItem{Type: "tool_call", CallID: "call-1", Name: "shell", Status: "running"},
	}}
}

func TestACPCancellationSettlesInteractions(t *testing.T) {
	var native strings.Builder
	s := &ACPSession{
		status: "running", activeTurnID: "turn-1",
		activeTextIdx: -1, activeThinkIdx: -1,
		timeline: runningToolTimeline(), frames: sdk.NewStreamFrames(func() {}),
		permissionRPCIDs:   map[string]any{"request-1": float64(7)},
		pendingPermissions: map[string]map[string]any{"request-1": {"id": "request-1"}},
		eventSubscribers:   map[int]func(map[string]any){}, stdin: nopWriteCloser{&native},
	}
	defer s.frames.Stop()
	waiter := make(chan error, 1)
	s.finishWaiters = append(s.finishWaiters, waiter)
	var events []map[string]any
	s.eventSubscribers[1] = func(event map[string]any) { events = append(events, event) }

	s.cancelPrompt("Interrupted")

	if len(s.pendingPermissions) != 0 || s.activeTurnID != "" || s.status != "idle" {
		t.Fatalf("cancellation left active state: %+v", s)
	}
	if got := s.timeline[0].Item.Status; got != "failed" {
		t.Fatalf("tool status = %q, want failed", got)
	}
	if !strings.Contains(native.String(), "\"outcome\":\"cancelled\"") {
		t.Fatalf("native permission was not cancelled: %s", native.String())
	}
	select {
	case <-waiter:
	default:
		t.Fatal("WaitForFinish was not released")
	}
	if len(events) == 0 || events[len(events)-1]["type"] != "byspace_turn_canceled" {
		t.Fatalf("terminal events = %+v, want cancellation", events)
	}
}

func TestCodexCancellationSettlesInteractions(t *testing.T) {
	var native strings.Builder
	s := &CodexSession{
		status: "running", activeTurnID: "turn-1", nativeTurnID: "native-1",
		activeTextIdx: -1, activeThinkIdx: -1,
		timeline: runningToolTimeline(), frames: sdk.NewStreamFrames(func() {}),
		permissionRPCIDs:   map[string]any{"request-1": float64(9)},
		pendingPermissions: map[string]map[string]any{"request-1": {"id": "request-1", "kind": "approval"}},
		eventSubscribers:   map[int]func(map[string]any){}, stdin: nopWriteCloser{&native},
	}
	defer s.frames.Stop()
	waiter := make(chan error, 1)
	s.finishWaiters = append(s.finishWaiters, waiter)

	s.emitMu.Lock()
	s.mu.Lock()
	events := s.finishCancellationLocked("Interrupted")
	s.mu.Unlock()
	s.emitMu.Unlock()

	if len(s.pendingPermissions) != 0 || s.activeTurnID != "" || s.status != "idle" {
		t.Fatalf("cancellation left active state: %+v", s)
	}
	if got := s.timeline[0].Item.Status; got != "failed" {
		t.Fatalf("tool status = %q, want failed", got)
	}
	if !strings.Contains(native.String(), "\"decision\":\"decline\"") {
		t.Fatalf("native approval was not declined: %s", native.String())
	}
	select {
	case <-waiter:
	default:
		t.Fatal("WaitForFinish was not released")
	}
	if len(events) == 0 || events[len(events)-1]["type"] != "byspace_turn_canceled" {
		t.Fatalf("terminal events = %+v, want cancellation", events)
	}
}

func TestMockAbortLeavesNoPendingInteraction(t *testing.T) {
	s := StartMockSession(MockLaunchOptions{Cwd: t.TempDir()})
	s.mu.Lock()
	s.status = "running"
	s.activeTurnID = "turn-1"
	s.turnStarted = true
	s.timeline = runningToolTimeline()
	s.pendingPermissions = []map[string]any{{"id": "question-1", "kind": "question"}}
	s.mu.Unlock()

	if err := s.Abort(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := len(s.PendingPermissions()); got != 0 {
		t.Fatalf("pending interactions = %d, want 0", got)
	}
	if got := s.Timeline()[0].Item.Status; got != "failed" {
		t.Fatalf("tool status = %q, want failed", got)
	}
}
