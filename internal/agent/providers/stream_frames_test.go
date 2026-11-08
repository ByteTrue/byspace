package providers

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// frozenFrameClock stops the coalescing window from ever elapsing. Both coalescing tests below
// assert what happens *before* the window ends, and the real clock made that racy: on a slow runner
// the 600 deltas take longer than the 60ms window, the trailing timer fires, and "nothing flushed
// yet" fails. This is what the frames' clock seam exists for.
type frozenFrameClock struct{ now time.Time }

func (c frozenFrameClock) Now() time.Time { return c.now }

func (frozenFrameClock) AfterFunc(time.Duration, func()) sdk.StreamFrameTimer { return frozenTimer{} }

type frozenTimer struct{}

func (frozenTimer) Stop() bool { return false }

// frozenFrames keeps the leading edge (the first delta still goes out at once, as in production)
// and holds everything after it until an explicit flush.
func frozenFrames(onTimer func()) *sdk.StreamFrames {
	return sdk.NewStreamFramesWithClock(time.Hour, frozenFrameClock{now: time.Unix(0, 0)}, onTimer)
}

func timelineEvents(events []map[string]any) []map[string]any {
	var out []map[string]any
	for _, event := range events {
		if event["type"] == "byspace_stream_timeline" {
			out = append(out, event)
		}
	}
	return out
}

func assertStreamedText(t *testing.T, events []map[string]any, want string) {
	t.Helper()
	frames := timelineEvents(events)
	if len(frames) > 2 {
		t.Fatalf("burst became %d frames, want at most a leading and trailing frame", len(frames))
	}
	var text strings.Builder
	lastSeq := 0
	for _, event := range frames {
		seq, _ := event["seq"].(int)
		if lastSeq == 0 {
			// A new provider session reserves seq 1 for the user's first row;
			// that row is sent by the server, outside this delta-only harness.
			lastSeq = seq - 1
		}
		if seq != lastSeq+1 {
			t.Fatalf("frame seq = %d after %d; every gap makes a client refetch", seq, lastSeq)
		}
		lastSeq = seq
		item, _ := event["item"].(sdk.TimelineItem)
		text.WriteString(item.Text)
	}
	if got := text.String(); got != want {
		t.Fatalf("stream text = %q, want %q", got, want)
	}
}

func TestCodexCoalescesDeltasBeforeNumbering(t *testing.T) {
	s := &CodexSession{activeTextIdx: -1, activeThinkIdx: -1, eventSubscribers: map[int]func(map[string]any){}}
	s.frames = frozenFrames(s.flushFramesOnTimer)
	var events []map[string]any
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	// The server normally creates the user's row before the provider starts. The
	// session has already emitted that row; these tests exercise only the deltas.
	s.streamSeq = 1
	s.handleNotificationOrRequest("turn/started", nil, map[string]any{"params": map[string]any{"turn": map[string]any{"id": "native-1"}}})

	const count = 600
	var want strings.Builder
	for i := 0; i < count; i++ {
		delta := fmt.Sprintf("tok%d ", i)
		want.WriteString(delta)
		s.handleNotificationOrRequest("item/agentMessage/delta", nil, map[string]any{"params": map[string]any{"delta": delta}})
	}
	assertStreamedText(t, events, "tok0 ")
	if len(timelineEvents(events)) != 1 {
		t.Fatal("the burst was not held for the trailing frame")
	}
	s.handleNotificationOrRequest("turn/completed", nil, map[string]any{})
	assertStreamedText(t, events, want.String())
}

func TestACPCoalescesDeltasBeforeNumbering(t *testing.T) {
	s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, eventSubscribers: map[int]func(map[string]any){}, stdin: nopWriteCloser{}}
	s.frames = frozenFrames(s.flushFramesOnTimer)
	var events []map[string]any
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	// The server normally creates the user's row before the provider starts. The
	// session has already emitted that row; these tests exercise only the deltas.
	s.streamSeq = 1

	const count = 600
	var want strings.Builder
	for i := 0; i < count; i++ {
		text := fmt.Sprintf("tok%d ", i)
		want.WriteString(text)
		s.handleNotificationOrRequest("session/update", nil, map[string]any{"params": map[string]any{
			"update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": text}},
		}})
	}
	assertStreamedText(t, events, "tok0 ")
	visible := s.Timeline()
	if len(visible) != 1 || visible[0].Item.Text != "tok0 " {
		t.Fatalf("timeline read did not hide the pending tail: %+v", visible)
	}
	s.Close()
	assertStreamedText(t, events, want.String())
}

func newCodexStreamTestSession(events *[]map[string]any) *CodexSession {
	s := &CodexSession{
		activeTextIdx:    -1,
		activeThinkIdx:   -1,
		activeTurnID:     "turn-1",
		toolIndexByID:    map[string]int{},
		eventSubscribers: map[int]func(map[string]any){},
		stdin:            nopWriteCloser{},
	}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.OnEvent(func(event map[string]any) { *events = append(*events, event) })
	return s
}

func codexItem(method string, item map[string]any) map[string]any {
	return map[string]any{"params": map[string]any{"item": item}}
}

func TestCodexDoesNotNumberRowsBeforeTheirFrames(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.handleNotificationOrRequest("item/reasoning/summaryTextDelta", nil, map[string]any{"params": map[string]any{"delta": "first "}})
	s.handleNotificationOrRequest("item/reasoning/summaryTextDelta", nil, map[string]any{"params": map[string]any{"delta": "second"}})
	s.handleNotificationOrRequest("item/started", nil, codexItem("item/started", map[string]any{
		"type": "commandExecution", "id": "call-1", "command": "pwd",
	}))
	if s.streamSeq != 1 {
		t.Fatalf("a pending tool consumed seq before broadcast: streamSeq = %d", s.streamSeq)
	}
	s.handleNotificationOrRequest("item/completed", nil, codexItem("item/completed", map[string]any{
		"type": "commandExecution", "id": "call-1", "command": "pwd", "aggregatedOutput": "/work",
	}))
	frames := timelineEvents(events)
	if len(frames) != 3 {
		t.Fatalf("frames = %+v", frames)
	}
	for index, event := range frames {
		if event["seq"] != index+1 {
			t.Fatalf("frame %d has seq %v; frames must stay consecutive and ordered", index, event["seq"])
		}
	}
	if got := frames[1]["item"].(sdk.TimelineItem).Text; got != "second" {
		t.Fatalf("reasoning tail = %q", got)
	}
	if got := frames[2]["item"].(sdk.TimelineItem).Status; got != "completed" {
		t.Fatalf("tool status = %q", got)
	}
}

func TestCodexCompletedMessageWithoutDeltasIsSentOnce(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.handleNotificationOrRequest("item/completed", nil, codexItem("item/completed", map[string]any{
		"type": "agentMessage", "text": "complete response",
	}))
	frames := timelineEvents(events)
	if len(frames) != 1 || frames[0]["seq"] != 1 {
		t.Fatalf("completed message was lost or left an empty seq: %+v", frames)
	}
	if got := frames[0]["item"].(sdk.TimelineItem).Text; got != "complete response" {
		t.Fatalf("completed text = %q", got)
	}
}

func TestACPKeepsAlternatingTextAndThoughtOrdered(t *testing.T) {
	var events []map[string]any
	s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-1", eventSubscribers: map[int]func(map[string]any){}}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	update := func(kind, text string) {
		s.handleNotificationOrRequest("session/update", nil, map[string]any{"params": map[string]any{
			"update": map[string]any{"sessionUpdate": kind, "content": map[string]any{"text": text}},
		}})
	}
	update("agent_message_chunk", "say ")
	update("agent_thought_chunk", "think")
	update("agent_message_chunk", "more")
	update("agent_message_chunk", "!")
	update("plan", "")
	frames := timelineEvents(events)
	if len(frames) != 3 {
		t.Fatalf("alternating updates collapsed across row boundaries: %+v", frames)
	}
	wantTypes := []string{"assistant_message", "reasoning", "assistant_message"}
	wantText := []string{"say ", "think", "more!"}
	for index, event := range frames {
		item := event["item"].(sdk.TimelineItem)
		if event["seq"] != index+1 || item.Type != wantTypes[index] || item.Text != wantText[index] {
			t.Fatalf("frame %d = seq %v, type %q, text %q", index, event["seq"], item.Type, item.Text)
		}
	}
}

func TestACPFlushesTailBeforePromptCompletion(t *testing.T) {
	var events []map[string]any
	s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-1", eventSubscribers: map[int]func(map[string]any){}}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	update := map[string]any{"params": map[string]any{
		"update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "tail"}},
	}}
	s.handleNotificationOrRequest("session/update", nil, update)
	s.handleNotificationOrRequest("session/update", nil, update)
	s.finishPrompt(nil)
	if len(timelineEvents(events)) != 2 || events[len(events)-1]["type"] != "agent_end" {
		t.Fatalf("completion overtook the trailing text: %+v", events)
	}
	assertStreamedText(t, events, "tailtail")
}

func TestCodexFlushesTailWhenProcessExits(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	stdout := strings.NewReader("{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"first \"}}\n" +
		"{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"last\"}}\n")
	s.readLoop(stdout)
	assertStreamedText(t, events, "first last")
	if s.Status() != "closed" {
		t.Fatalf("status = %q", s.Status())
	}
}

func TestACPFlushesTailWhenProcessExits(t *testing.T) {
	var events []map[string]any
	s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-1", eventSubscribers: map[int]func(map[string]any){}}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	stdout := strings.NewReader("{\"method\":\"session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"text\":\"first \"}}}}\n" +
		"{\"method\":\"session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"text\":\"last\"}}}}\n")
	s.readLoop(stdout)
	assertStreamedText(t, events, "first last")
	if s.Status() != "closed" {
		t.Fatalf("status = %q", s.Status())
	}
}

func TestProviderEventCallbacksMayCloseTheirSession(t *testing.T) {
	for _, provider := range []string{"codex", "acp"} {
		t.Run(provider, func(t *testing.T) {
			var events []map[string]any
			var closeOnce sync.Once
			if provider == "codex" {
				s := newCodexStreamTestSession(&events)
				s.OnEvent(func(map[string]any) { closeOnce.Do(func() { _ = s.Close() }) })
				s.handleNotificationOrRequest("item/agentMessage/delta", nil, map[string]any{"params": map[string]any{"delta": "first"}})
			} else {
				s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, activeTurnID: "turn-1", eventSubscribers: map[int]func(map[string]any){}, stdin: nopWriteCloser{}}
				s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
				s.OnEvent(func(event map[string]any) { events = append(events, event) })
				s.OnEvent(func(map[string]any) { closeOnce.Do(func() { _ = s.Close() }) })
				s.handleNotificationOrRequest("session/update", nil, map[string]any{"params": map[string]any{
					"update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "first"}},
				}})
			}
			if got := len(timelineEvents(events)); got != 1 {
				t.Fatalf("reentrant close lost the event: %+v", events)
			}
		})
	}
}

func TestProviderEOFTailDeliveryMayCloseItsSession(t *testing.T) {
	for _, provider := range []string{"codex", "acp"} {
		t.Run(provider, func(t *testing.T) {
			done := make(chan struct{})
			go func() {
				defer close(done)
				if provider == "codex" {
					var events []map[string]any
					s := newCodexStreamTestSession(&events)
					s.OnEvent(func(map[string]any) { _ = s.Close() })
					s.readLoop(strings.NewReader("{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"tail\"}}\n"))
				} else {
					s := &ACPSession{activeTextIdx: -1, activeThinkIdx: -1, eventSubscribers: map[int]func(map[string]any){}, stdin: nopWriteCloser{}}
					s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
					s.OnEvent(func(map[string]any) { _ = s.Close() })
					s.readLoop(strings.NewReader("{\"method\":\"session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"text\":\"tail\"}}}}\n"))
				}
			}()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("EOF delivery deadlocked when its subscriber closed the session")
			}
		})
	}
}
