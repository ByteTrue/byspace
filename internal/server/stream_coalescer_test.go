package server

import (
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// These cases mirror packages/server/src/server/agent/agent-stream-coalescer.test.ts from the Node
// daemon, which is the reference this port has to match. The timers are injected so the window can
// be advanced without sleeping, exactly like the Node tests use fake timers.

type fakeClockTimer struct {
	clock *fakeClock
	due   time.Time
	fn    func()
	done  bool
}

func (t *fakeClockTimer) Stop() bool {
	if t.done {
		return false
	}
	t.done = true
	return true
}

type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeClockTimer
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, fn func()) streamCoalescerTimer {
	c.mu.Lock()
	defer c.mu.Unlock()
	timer := &fakeClockTimer{clock: c, due: c.now.Add(d), fn: fn}
	c.timers = append(c.timers, timer)
	return timer
}

// Advance moves the clock forward, running every timer that comes due in order.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	target := c.now.Add(d)
	c.mu.Unlock()
	for {
		c.mu.Lock()
		var next *fakeClockTimer
		for _, timer := range c.timers {
			if timer.done || timer.due.After(target) {
				continue
			}
			if next == nil || timer.due.Before(next.due) {
				next = timer
			}
		}
		if next == nil {
			if target.After(c.now) {
				c.now = target
			}
			c.mu.Unlock()
			return
		}
		next.done = true
		c.now = next.due
		c.mu.Unlock()
		next.fn()
	}
}

type coalescerFlush struct {
	agentID  string
	provider string
	turnID   string
	seq      int
	item     sdk.TimelineItem
}

type coalescerHarness struct {
	coalescer *streamCoalescer
	clock     *fakeClock
	flushes   []coalescerFlush
}

func newHarness() *coalescerHarness {
	h := &coalescerHarness{clock: newFakeClock()}
	h.coalescer = newStreamCoalescer(func(agentID, provider, turnID string, seq int, item sdk.TimelineItem) {
		h.flushes = append(h.flushes, coalescerFlush{
			agentID: agentID, provider: provider, turnID: turnID, seq: seq, item: item,
		})
	})
	h.coalescer.timers = h.clock
	h.coalescer.window = agentStreamCoalesceWindow
	return h
}

func (h *coalescerHarness) texts() []string {
	out := make([]string, 0, len(h.flushes))
	for _, flush := range h.flushes {
		out = append(out, flush.item.Text)
	}
	return out
}

func assistant(text string) sdk.TimelineItem {
	return sdk.TimelineItem{Type: "assistant_message", Text: text, MessageID: "message-1"}
}

func assistantOf(text, messageID string) sdk.TimelineItem {
	return sdk.TimelineItem{Type: "assistant_message", Text: text, MessageID: messageID}
}

func reasoning(text string) sdk.TimelineItem {
	return sdk.TimelineItem{Type: "reasoning", Text: text}
}

func toolCall(callID, status, output string) sdk.TimelineItem {
	return sdk.TimelineItem{
		Type:   "tool_call",
		CallID: callID,
		Name:   "shell",
		Status: status,
		Detail: map[string]any{"output": output},
	}
}

// primeLeadingEdge consumes the leading-edge flush so a case can assert trailing batching alone.
func (h *coalescerHarness) primeLeadingEdge(t *testing.T, agentID string) {
	t.Helper()
	h.coalescer.handle(agentID, "codex", "", 1, assistant("prime"))
	index := -1
	for i, flush := range h.flushes {
		if flush.agentID == agentID && flush.item.Type == "assistant_message" {
			index = i
			break
		}
	}
	if index == -1 {
		t.Fatalf("expected a leading-edge flush for %s", agentID)
	}
	h.flushes = append(h.flushes[:index], h.flushes[index+1:]...)
}

func TestStreamCoalescerLeadsOnFirstChunk(t *testing.T) {
	h := newHarness()
	if !h.coalescer.handle("agent-1", "codex", "", 1, assistant("hel")) {
		t.Fatal("expected the item to be consumed")
	}
	if len(h.flushes) != 1 || h.flushes[0].item.Text != "hel" || h.flushes[0].provider != "codex" {
		t.Fatalf("expected one immediate flush, got %+v", h.flushes)
	}
}

func TestStreamCoalescerBatchesUntilWindowElapses(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")

	h.coalescer.handle("agent-1", "codex", "", 2, assistant("hel"))
	h.coalescer.handle("agent-1", "codex", "", 3, assistant("lo"))
	if len(h.flushes) != 0 {
		t.Fatalf("expected nothing yet, got %+v", h.flushes)
	}
	h.clock.Advance(59 * time.Millisecond)
	if len(h.flushes) != 0 {
		t.Fatalf("expected nothing at 59ms, got %+v", h.flushes)
	}
	h.clock.Advance(time.Millisecond)
	if len(h.flushes) != 1 || h.flushes[0].item.Text != "hello" {
		t.Fatalf("expected one merged flush at the window, got %+v", h.flushes)
	}
}

func TestStreamCoalescerLeadsAgainAfterIdleWindow(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("first"))
	h.clock.Advance(agentStreamCoalesceWindow)
	h.coalescer.handle("agent-1", "codex", "", 2, assistant("second"))

	if got := h.texts(); len(got) != 2 || got[0] != "first" || got[1] != "second" {
		t.Fatalf("expected both chunks flushed separately, got %v", got)
	}
}

func TestStreamCoalescerHonorsConfiguredWindow(t *testing.T) {
	h := newHarness()
	h.coalescer.window = 10 * time.Millisecond
	h.primeLeadingEdge(t, "agent-1")

	h.coalescer.handle("agent-1", "codex", "", 2, assistant("fast"))
	h.clock.Advance(9 * time.Millisecond)
	if len(h.flushes) != 0 {
		t.Fatalf("expected nothing at 9ms, got %+v", h.flushes)
	}
	h.clock.Advance(time.Millisecond)
	if len(h.flushes) != 1 || h.flushes[0].item.Text != "fast" {
		t.Fatalf("expected the flush at 10ms, got %+v", h.flushes)
	}
	if agentStreamCoalesceWindow != 60*time.Millisecond {
		t.Fatalf("default window = %v, want the Node value of 60ms", agentStreamCoalesceWindow)
	}
}

func TestStreamCoalescerFlushDrainsPending(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("before"))
	h.coalescer.flush("agent-1")
	if len(h.flushes) != 1 || h.flushes[0].item.Text != "before" {
		t.Fatalf("expected the pending chunk, got %+v", h.flushes)
	}
	if !h.coalescer.handle("agent-1", "codex", "", 2, toolCall("tool-1", "running", "")) {
		t.Fatal("expected tool_call to be consumed")
	}
}

func TestStreamCoalescerDoesNotConsumeNonChunkableItems(t *testing.T) {
	h := newHarness()
	items := []sdk.TimelineItem{
		{Type: "todo"},
		{Type: "user_message", Text: "hi", MessageID: "message-1"},
		{Type: "error", Message: "boom"},
		{Type: "compaction"},
		{Type: "notification", Level: "info", Message: "note"},
	}
	for _, item := range items {
		if h.coalescer.handle("agent-1", "codex", "", 1, item) {
			t.Fatalf("%s must not be consumed by the coalescer", item.Type)
		}
	}
	if len(h.flushes) != 0 {
		t.Fatalf("expected no flushes, got %+v", h.flushes)
	}
}

func TestStreamCoalescerPreservesKindBoundaries(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("a1"))
	h.coalescer.handle("agent-1", "codex", "", 2, reasoning("r1"))
	h.coalescer.handle("agent-1", "codex", "", 3, assistant("a2"))
	h.clock.Advance(agentStreamCoalesceWindow)

	want := []string{"a1", "r1", "a2"}
	got := h.texts()
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestStreamCoalescerPreservesAlternatingOrder(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("a1"))
	h.coalescer.handle("agent-1", "codex", "", 2, reasoning("r1"))
	h.coalescer.handle("agent-1", "codex", "", 3, assistant("a2"))
	h.coalescer.handle("agent-1", "codex", "", 4, reasoning("r2"))
	h.clock.Advance(agentStreamCoalesceWindow)

	want := []string{"a1", "r1", "a2", "r2"}
	got := h.texts()
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestStreamCoalescerDoesNotCollapseAcrossProviders(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("c"))
	h.coalescer.handle("agent-1", "opencode", "", 2, assistant("o"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 2 || h.flushes[0].provider != "codex" || h.flushes[1].provider != "opencode" {
		t.Fatalf("expected one flush per provider, got %+v", h.flushes)
	}
}

func TestStreamCoalescerDoesNotCollapseAcrossTurns(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "turn-1", 1, assistant("one"))
	h.coalescer.handle("agent-1", "codex", "turn-2", 2, assistant("two"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 2 || h.flushes[0].turnID != "turn-1" || h.flushes[1].turnID != "turn-2" {
		t.Fatalf("expected one flush per turn, got %+v", h.flushes)
	}
}

func TestStreamCoalescerDoesNotSpliceConcurrentMessageIDs(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "turn-1", 1, assistantOf("The", "message-a"))
	h.coalescer.handle("agent-1", "codex", "turn-1", 2, assistantOf("0po", "message-b"))
	h.coalescer.handle("agent-1", "codex", "turn-1", 3, assistantOf(" exact", "message-a"))
	h.coalescer.handle("agent-1", "codex", "turn-1", 4, assistantOf("7/fr", "message-b"))
	h.clock.Advance(agentStreamCoalesceWindow)

	want := []struct{ text, id string }{
		{"The", "message-a"},
		{"0po", "message-b"},
		{" exact", "message-a"},
		{"7/fr", "message-b"},
	}
	if len(h.flushes) != len(want) {
		t.Fatalf("expected %d flushes, got %+v", len(want), h.flushes)
	}
	for i, w := range want {
		if h.flushes[i].item.Text != w.text || h.flushes[i].item.MessageID != w.id {
			t.Fatalf("flush %d = %+v, want %v/%v", i, h.flushes[i].item, w.text, w.id)
		}
	}
}

func TestStreamCoalescerDropsEmptyText(t *testing.T) {
	h := newHarness()
	if !h.coalescer.handle("agent-1", "codex", "", 1, assistant("")) {
		t.Fatal("an empty delta is consumed")
	}
	if !h.coalescer.handle("agent-2", "codex", "", 2, reasoning("")) {
		t.Fatal("an empty reasoning delta is consumed")
	}
	h.clock.Advance(agentStreamCoalesceWindow)
	if len(h.flushes) != 0 {
		t.Fatalf("expected no flushes for empty text, got %+v", h.flushes)
	}
}

func TestStreamCoalescerPreservesWhitespaceAndFragments(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	for _, chunk := range []string{" ", "\n", "\t", " mixed \n\t whitespace ", "世界", "—", "."} {
		h.coalescer.handle("agent-1", "codex", "", 1, assistant(chunk))
	}
	h.clock.Advance(agentStreamCoalesceWindow)

	want := " \n\t mixed \n\t whitespace 世界—."
	if len(h.flushes) != 1 || h.flushes[0].item.Text != want {
		t.Fatalf("expected one byte-exact chunk %q, got %+v", want, h.texts())
	}
}

func TestStreamCoalescerIsolatesAgents(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.primeLeadingEdge(t, "agent-2")

	h.coalescer.handle("agent-1", "codex", "", 1, assistant("a"))
	h.coalescer.handle("agent-2", "codex", "", 2, assistant("x"))
	h.coalescer.handle("agent-1", "codex", "", 3, assistant("b"))
	h.coalescer.handle("agent-2", "codex", "", 4, assistant("y"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 2 || h.flushes[0].item.Text != "ab" || h.flushes[1].item.Text != "xy" {
		t.Fatalf("expected per-agent buffers, got %+v", h.flushes)
	}
}

func TestStreamCoalescerFlushAllIsIdempotent(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("a"))
	h.coalescer.handle("agent-2", "codex", "", 2, assistant("b"))
	h.coalescer.flushAll()
	h.coalescer.flushAll()

	if len(h.flushes) != 2 {
		t.Fatalf("expected exactly two flushes, got %+v", h.texts())
	}
}

func TestStreamCoalescerChunksAppendedDuringEmitGoToALaterFlush(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	reentered := false
	original := h.coalescer.emit
	h.coalescer.emit = func(agentID, provider, turnID string, seq int, item sdk.TimelineItem) {
		original(agentID, provider, turnID, seq, item)
		if item.Text == "first" && !reentered {
			reentered = true
			h.coalescer.handle("agent-1", "codex", "", seq+1, assistant("second"))
		}
	}

	h.coalescer.handle("agent-1", "codex", "", 1, assistant("first"))
	h.coalescer.flush("agent-1")
	if len(h.flushes) != 1 || h.flushes[0].item.Text != "first" {
		t.Fatalf("expected only the first chunk, got %+v", h.texts())
	}
	h.clock.Advance(agentStreamCoalesceWindow)
	if len(h.flushes) != 2 || h.flushes[1].item.Text != "second" {
		t.Fatalf("expected the re-entrant chunk after the window, got %+v", h.texts())
	}
}

func TestStreamCoalescerManualFlushPreventsLateDuplicates(t *testing.T) {
	h := newHarness()
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("manual"))
	h.coalescer.flush("agent-1")
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 1 || h.flushes[0].item.Text != "manual" {
		t.Fatalf("expected one flush and no duplicate, got %+v", h.texts())
	}
}

func TestStreamCoalescerForgetFlushesAndDropsTheBuffer(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("durable"))
	h.coalescer.forget("agent-1")
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 1 || h.flushes[0].item.Text != "durable" {
		t.Fatalf("expected the pending chunk once, got %+v", h.texts())
	}
	h.coalescer.mu.Lock()
	_, stillThere := h.coalescer.pending["agent-1"]
	h.coalescer.mu.Unlock()
	if stillThere {
		t.Fatal("expected the buffer to be dropped")
	}
}

func TestStreamCoalescerStaleTimerCannotFlushAReusedAgentID(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("old"))
	h.coalescer.forget("agent-1")
	h.coalescer.handle("agent-1", "codex", "", 2, assistant("new"))

	// Fire every timer ever scheduled, including the one the forgotten buffer owns.
	h.clock.mu.Lock()
	timers := append([]*fakeClockTimer(nil), h.clock.timers...)
	h.clock.mu.Unlock()
	for _, timer := range timers {
		timer.fn()
	}
	h.coalescer.flush("agent-1")

	if len(h.flushes) != 2 || h.flushes[0].item.Text != "old" || h.flushes[1].item.Text != "new" {
		t.Fatalf("expected old then new, got %+v", h.texts())
	}
}

func TestStreamCoalescerPreservesFirstChunkItemShape(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	first := assistantOf("he", "message-7")
	h.coalescer.handle("agent-1", "codex", "turn-3", 5, first)
	h.coalescer.handle("agent-1", "codex", "turn-3", 6, assistantOf("llo", "message-7"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 1 {
		t.Fatalf("expected one flush, got %+v", h.flushes)
	}
	flush := h.flushes[0]
	if flush.item.Text != "hello" || flush.item.MessageID != "message-7" || flush.turnID != "turn-3" {
		t.Fatalf("expected the merged chunk to keep the first item's identity, got %+v", flush)
	}
	if flush.seq != 6 {
		t.Fatalf("expected the merged chunk to carry the latest seq, got %d", flush.seq)
	}
}

func TestStreamCoalescerCoalescesToolCallsByCallID(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, toolCall("tool-1", "running", "first"))
	h.coalescer.handle("agent-1", "codex", "", 2, toolCall("tool-1", "running", "second"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 1 {
		t.Fatalf("expected one tool_call flush, got %+v", h.flushes)
	}
	detail, _ := h.flushes[0].item.Detail.(map[string]any)
	if detail["output"] != "second" {
		t.Fatalf("expected the latest snapshot to win, got %+v", detail)
	}
}

func TestStreamCoalescerCoalescesInterleavedToolCallsIndependently(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, toolCall("tool-1", "running", "one-a"))
	h.coalescer.handle("agent-1", "codex", "", 2, toolCall("tool-2", "running", "two-a"))
	h.coalescer.handle("agent-1", "codex", "", 3, toolCall("tool-1", "running", "one-b"))
	h.coalescer.handle("agent-1", "codex", "", 4, toolCall("tool-2", "running", "two-b"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 2 {
		t.Fatalf("expected one flush per call, got %+v", h.flushes)
	}
	first, _ := h.flushes[0].item.Detail.(map[string]any)
	second, _ := h.flushes[1].item.Detail.(map[string]any)
	if h.flushes[0].item.CallID != "tool-1" || first["output"] != "one-b" {
		t.Fatalf("tool-1 = %+v", h.flushes[0].item)
	}
	if h.flushes[1].item.CallID != "tool-2" || second["output"] != "two-b" {
		t.Fatalf("tool-2 = %+v", h.flushes[1].item)
	}
}

func TestStreamCoalescerFlushesTerminalToolCallsImmediately(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, toolCall("tool-1", "running", "running"))
	if len(h.flushes) != 0 {
		t.Fatalf("expected the running snapshot to wait, got %+v", h.flushes)
	}
	h.coalescer.handle("agent-1", "codex", "", 2, toolCall("tool-1", "completed", "done"))
	if len(h.flushes) != 1 || h.flushes[0].item.Status != "completed" {
		t.Fatalf("expected an immediate terminal flush, got %+v", h.flushes)
	}
	detail, _ := h.flushes[0].item.Detail.(map[string]any)
	if detail["output"] != "done" {
		t.Fatalf("expected the terminal snapshot, got %+v", detail)
	}
}

func TestStreamCoalescerPreservesMixedArrivalOrder(t *testing.T) {
	h := newHarness()
	h.primeLeadingEdge(t, "agent-1")
	h.coalescer.handle("agent-1", "codex", "", 1, assistant("a"))
	h.coalescer.handle("agent-1", "codex", "", 2, toolCall("tool-1", "running", "running"))
	h.coalescer.handle("agent-1", "codex", "", 3, reasoning("r"))
	h.coalescer.handle("agent-1", "codex", "", 4, toolCall("tool-1", "running", "latest"))
	h.coalescer.handle("agent-1", "codex", "", 5, assistant("b"))
	h.clock.Advance(agentStreamCoalesceWindow)

	if len(h.flushes) != 4 {
		t.Fatalf("expected four rows, got %+v", h.flushes)
	}
	wantTypes := []string{"assistant_message", "tool_call", "reasoning", "assistant_message"}
	for i, want := range wantTypes {
		if h.flushes[i].item.Type != want {
			t.Fatalf("row %d = %s, want %s", i, h.flushes[i].item.Type, want)
		}
	}
	if h.flushes[0].item.Text != "a" || h.flushes[1].item.CallID != "tool-1" ||
		h.flushes[2].item.Text != "r" || h.flushes[3].item.Text != "b" {
		t.Fatalf("unexpected row contents: %+v", h.flushes)
	}
	detail, _ := h.flushes[1].item.Detail.(map[string]any)
	if detail["output"] != "latest" {
		t.Fatalf("expected the latest tool snapshot in place, got %+v", detail)
	}
}
