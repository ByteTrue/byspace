package providers

import (
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type closeAndWaitSession interface {
	Close() error
	CloseAndWait() error
}

func TestCloseAndWaitDrainsACPAndCodexDelivery(t *testing.T) {
	tests := []struct {
		name string
		path string
		new  func(chan struct{}, chan struct{}) (closeAndWaitSession, func(), func() bool)
	}{
		{name: "acp", path: "finishPromptForID agent_end callback", new: func(started, release chan struct{}) (closeAndWaitSession, func(), func() bool) {
			s := &ACPSession{
				frames: sdk.NewStreamFrames(func() {}), stdin: nopWriteCloser{},
				activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-acp-close", status: "running",
				eventSubscribers: map[int]func(map[string]any){},
			}
			s.eventSubscribers[1] = func(event map[string]any) {
				if event["type"] == "agent_end" {
					close(started)
					<-release
				}
			}
			return s, func() {
					s.finishPromptForID("turn-acp-close", nil)
				}, func() bool {
					s.mu.Lock()
					defer s.mu.Unlock()
					return s.closed
				}
		}},
		{name: "codex", path: "event delivery", new: func(started, release chan struct{}) (closeAndWaitSession, func(), func() bool) {
			s := &CodexSession{frames: sdk.NewStreamFrames(func() {}), stdin: nopWriteCloser{}, activeTextIdx: -1, activeThinkIdx: -1}
			return s, func() {
					s.deliverEvents([]func(map[string]any){func(map[string]any) {
						close(started)
						<-release
					}}, []map[string]any{{"type": "agent_end"}})
				}, func() bool {
					s.mu.Lock()
					defer s.mu.Unlock()
					return s.closed
				}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			started := make(chan struct{})
			release := make(chan struct{})
			session, deliver, closed := tc.new(started, release)
			go deliver()
			awaitCloseAndWaitSignal(t, started, "event delivery")
			closeDone := make(chan error, 1)
			go func() { closeDone <- session.CloseAndWait() }()
			select {
			case err := <-closeDone:
				t.Fatalf("CloseAndWait returned while %s was blocked: %v", tc.path, err)
			case <-time.After(100 * time.Millisecond):
			}
			if err := session.Close(); err != nil {
				t.Fatalf("nonblocking Close: %v", err)
			}
			if closed() {
				t.Fatal("Close did not preserve reentrant active-delivery semantics")
			}
			close(release)
			select {
			case err := <-closeDone:
				if err != nil {
					t.Fatalf("CloseAndWait: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("CloseAndWait deadlocked after delivery was released")
			}
			if !closed() {
				t.Fatal("reentrant Close did not finish after delivery drained")
			}
		})
	}
}

func TestCloseAndWaitDrainsTerminalSnapshotHandoff(t *testing.T) {
	type fixture struct {
		session   closeAndWaitSession
		finish    func()
		snapshot  <-chan struct{}
		release   chan struct{}
		delivered <-chan struct{}
	}
	tests := []struct {
		name string
		new  func() fixture
	}{
		{name: "acp", new: func() fixture {
			snapshot := make(chan struct{})
			release := make(chan struct{})
			delivered := make(chan struct{})
			s := &ACPSession{
				frames: sdk.NewStreamFrames(func() {}), stdin: nopWriteCloser{},
				activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-acp-handoff", status: "running",
				eventSubscribers: map[int]func(map[string]any){},
			}
			s.eventSubscribers[1] = func(event map[string]any) {
				if event["type"] == "agent_end" {
					close(delivered)
				}
			}
			s.beforeEventDelivery = func() {
				close(snapshot)
				<-release
			}
			return fixture{session: s, finish: func() { s.finishPromptForID("turn-acp-handoff", nil) }, snapshot: snapshot, release: release, delivered: delivered}
		}},
		{name: "codex", new: func() fixture {
			snapshot := make(chan struct{})
			release := make(chan struct{})
			delivered := make(chan struct{})
			s := &CodexSession{
				frames: sdk.NewStreamFrames(func() {}), stdin: nopWriteCloser{},
				activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-codex-handoff", status: "running",
				eventSubscribers: map[int]func(map[string]any){},
			}
			s.eventSubscribers[1] = func(event map[string]any) {
				if event["type"] == "agent_end" {
					close(delivered)
				}
			}
			s.beforeEventDelivery = func() {
				close(snapshot)
				<-release
			}
			return fixture{session: s, finish: func() { s.handleNotificationOrRequest("turn/completed", nil, map[string]any{}) }, snapshot: snapshot, release: release, delivered: delivered}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := tc.new()
			go f.finish()
			awaitCloseAndWaitSignal(t, f.snapshot, "terminal subscriber snapshot")
			closeDone := make(chan error, 1)
			go func() { closeDone <- f.session.CloseAndWait() }()
			select {
			case err := <-closeDone:
				close(f.release)
				t.Fatalf("CloseAndWait returned before the snapshotted terminal delivery drained: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			close(f.release)
			awaitCloseAndWaitSignal(t, f.delivered, "terminal completion delivery")
			select {
			case err := <-closeDone:
				if err != nil {
					t.Fatalf("CloseAndWait: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("CloseAndWait deadlocked after the terminal delivery drained")
			}
		})
	}
}

func TestACPFinishPromptForIDEmitsCompletionOnce(t *testing.T) {
	var events []map[string]any
	s := &ACPSession{
		frames: sdk.NewStreamFrames(func() {}), activeTextIdx: -1, activeThinkIdx: -1,
		activeTurnID: "turn-acp-complete", status: "running",
		eventSubscribers: map[int]func(map[string]any){},
	}
	s.eventSubscribers[1] = func(event map[string]any) { events = append(events, event) }
	s.finishPromptForID("turn-acp-complete", nil)
	s.finishPromptForID("turn-acp-complete", nil)
	s.finishPrompt(nil)
	if len(events) != 1 || events[0]["type"] != "agent_end" {
		t.Fatalf("nil/duplicate prompt completion events = %#v", events)
	}
}

func awaitCloseAndWaitSignal(t *testing.T, ch <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}
