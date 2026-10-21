package streamcoalesce

import (
	"sync"
	"testing"
	"time"
)

// collector records flushed events.
type collector struct {
	mu     sync.Mutex
	events []Event
}

func (c *collector) flush(event Event) {
	c.mu.Lock()
	c.events = append(c.events, event)
	c.mu.Unlock()
}

func (c *collector) snapshot() []Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]Event, len(c.events))
	copy(out, c.events)
	return out
}

func textEvent(agentID, kind, messageID, text string) Event {
	return Event{AgentID: agentID, Provider: "pi", TurnID: "t1", Item: Item{
		Type: kind, Text: text, MessageID: messageID,
	}}
}

// The first event after an idle window flushes immediately, so the first token of a turn is not
// delayed by a full window.
func TestLeadingEdgeFlushesImmediately(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	defer coalescer.Stop()

	coalescer.Handle(textEvent("agt_1", "assistant_message", "m1", "Hello"))
	if len(c.snapshot()) != 1 {
		t.Fatalf("the first delta was delayed: %+v", c.snapshot())
	}
}

// A sustained burst is batched per window: one event per token would be thousands of frames.
func TestBurstIsBatched(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	coalescer.SetWindow(40 * time.Millisecond)
	defer coalescer.Stop()

	// The first flushes the leading edge.
	coalescer.Handle(textEvent("agt_1", "assistant_message", "m1", "a"))
	for _, chunk := range []string{"b", "c", "d"} {
		coalescer.Handle(textEvent("agt_1", "assistant_message", "m1", chunk))
	}
	// Nothing more yet: the rest are waiting on the trailing timer.
	if got := len(c.snapshot()); got != 1 {
		t.Fatalf("the burst was not batched: %d flushes", got)
	}

	time.Sleep(80 * time.Millisecond)
	events := c.snapshot()
	if len(events) != 2 {
		t.Fatalf("flushes = %d", len(events))
	}
	// One growing message, not three: the client renders a growing message.
	if events[1].Item.Text != "bcd" {
		t.Fatalf("collapsed text = %q", events[1].Item.Text)
	}
}

// A completed tool call is what the user is waiting to see; holding it for a window makes the UI
// look stuck.
func TestTerminalToolCallFlushesSynchronously(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	defer coalescer.Stop()

	// Prime the window so the next event would otherwise be batched.
	coalescer.Handle(textEvent("agt_1", "reasoning", "", "thinking"))
	coalescer.Handle(Event{AgentID: "agt_1", Provider: "pi", TurnID: "t1", Item: Item{
		Type: "tool_call", CallID: "c1", Status: "running",
	}})
	before := len(c.snapshot())
	coalescer.Handle(Event{AgentID: "agt_1", Provider: "pi", TurnID: "t1", Item: Item{
		Type: "tool_call", CallID: "c1", Status: "completed",
	}})
	if len(c.snapshot()) <= before {
		t.Fatal("a terminal tool call must flush immediately")
	}
}

// The same call appears as running, then completed; appending both would show it twice.
func TestToolCallStatusReplaces(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	coalescer.SetWindow(time.Hour)
	defer coalescer.Stop()

	coalescer.Handle(Event{AgentID: "agt_1", Provider: "pi", TurnID: "t1", Item: Item{
		Type: "tool_call", CallID: "c1", Status: "running",
	}})
	coalescer.Handle(Event{AgentID: "agt_1", Provider: "pi", TurnID: "t1", Item: Item{
		Type: "tool_call", CallID: "c1", Status: "completed",
	}})
	coalescer.Flush("agt_1")

	events := c.snapshot()
	if len(events) != 2 {
		t.Fatalf("flushes = %d", len(events))
	}
	// The last flush carries the single, completed entry.
	last := events[len(events)-1]
	if last.Item.Status != "completed" {
		t.Fatalf("status = %q", last.Item.Status)
	}
}

// A new message id must start a new entry, or two replies merge into one.
func TestDifferentMessageIDStartsNewEntry(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	coalescer.SetWindow(time.Hour)
	defer coalescer.Stop()

	coalescer.Handle(Event{AgentID: "a", Provider: "pi", TurnID: "t1", Item: Item{Type: "assistant_message", MessageID: "m1", Text: "one"}})
	coalescer.Handle(Event{AgentID: "a", Provider: "pi", TurnID: "t1", Item: Item{Type: "assistant_message", MessageID: "m1", Text: " two"}})
	coalescer.Handle(Event{AgentID: "a", Provider: "pi", TurnID: "t1", Item: Item{Type: "assistant_message", MessageID: "m2", Text: "three"}})
	coalescer.Flush("a")

	// The leading edge flushed "one"; the batch holds " two" + "three" as two entries.
	events := c.snapshot()
	last := events[len(events)-1]
	if last.Item.MessageID != "m2" || last.Item.Text != "three" {
		t.Fatalf("separate messages merged: %+v", last)
	}
}

// An empty delta carries no information; forwarding it would create an empty assistant message.
func TestEmptyDeltaIsDropped(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	defer coalescer.Stop()

	if handled := coalescer.Handle(textEvent("a", "assistant_message", "m1", "")); !handled {
		t.Fatal("an empty delta is handled (by dropping it)")
	}
	if len(c.snapshot()) != 0 {
		t.Fatal("an empty delta was flushed")
	}
}

// A non-coalescable event is the caller's to deliver.
func TestNonCoalescableIsLeftToCaller(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	defer coalescer.Stop()
	if coalescer.Handle(Event{AgentID: "a", Item: Item{Type: "user_message", Text: "hi"}}) {
		t.Fatal("a user message must not be batched")
	}
}

// A timer that fires after an agent is closed would deliver an event for an agent the client has
// already removed.
func TestFlushAndDiscardStopsTheTimer(t *testing.T) {
	c := &collector{}
	coalescer := New(c.flush)
	coalescer.SetWindow(30 * time.Millisecond)
	defer coalescer.Stop()

	coalescer.Handle(textEvent("a", "assistant_message", "m1", "x"))
	coalescer.Handle(textEvent("a", "assistant_message", "m1", "y"))
	before := len(c.snapshot())

	coalescer.FlushAndDiscard("a")
	time.Sleep(80 * time.Millisecond)
	if got := len(c.snapshot()); got != before+1 {
		t.Fatalf("the discarded buffer still flushed: %d → %d", before, got)
	}
}
