package sdk

import (
	"testing"
	"time"
)

// Ported from the archived Node daemon's agent-stream-coalescer tests, on the frames' own API.

type fakeFrameClock struct {
	now    time.Time
	timers []*fakeFrameTimer
}

type fakeFrameTimer struct {
	at      time.Time
	fn      func()
	stopped bool
}

func (t *fakeFrameTimer) Stop() bool {
	was := !t.stopped
	t.stopped = true
	return was
}

func (c *fakeFrameClock) Now() time.Time { return c.now }

func (c *fakeFrameClock) AfterFunc(d time.Duration, fn func()) StreamFrameTimer {
	timer := &fakeFrameTimer{at: c.now.Add(d), fn: fn}
	c.timers = append(c.timers, timer)
	return timer
}

func (c *fakeFrameClock) advance(d time.Duration) {
	c.now = c.now.Add(d)
	for _, timer := range c.timers {
		if !timer.stopped && !timer.at.After(c.now) {
			timer.stopped = true
			timer.fn()
		}
	}
}

func newTestFrames(t *testing.T) (*StreamFrames, *fakeFrameClock, *int) {
	t.Helper()
	clock := &fakeFrameClock{now: time.Unix(1000, 0)}
	fired := 0
	frames := NewStreamFramesWithClock(60*time.Millisecond, clock, func() { fired++ })
	return frames, clock, &fired
}

func text(kind, body, messageID string) TimelineItem {
	return TimelineItem{Type: kind, Text: body, MessageID: messageID}
}

func call(id, status string) TimelineItem {
	return TimelineItem{Type: "tool_call", CallID: id, Status: status}
}

func TestStreamFramesLeadOnTheFirstDelta(t *testing.T) {
	frames, _, _ := newTestFrames(t)
	if !frames.AddText(0, text("assistant_message", "Hel", "m1"), "t1") {
		t.Fatal("the first delta after idle must go out at once")
	}
	got := frames.Take()
	if len(got) != 1 || got[0].Item.Text != "Hel" {
		t.Fatalf("frames: %+v", got)
	}
}

func TestStreamFramesMergeABurstUntilTheWindowEnds(t *testing.T) {
	frames, clock, fired := newTestFrames(t)
	frames.AddText(0, text("assistant_message", "a", "m1"), "t1")
	frames.Take()
	clock.advance(10 * time.Millisecond)
	if frames.AddText(0, text("assistant_message", "b", "m1"), "t1") {
		t.Fatal("a delta inside the window must wait")
	}
	frames.AddText(0, text("assistant_message", "c", "m1"), "t1")
	clock.advance(59 * time.Millisecond)
	if *fired != 0 {
		t.Fatal("the trailing flush fired before the window ended")
	}
	clock.advance(1 * time.Millisecond)
	if *fired != 1 {
		t.Fatalf("trailing flush fired %d times", *fired)
	}
	got := frames.Take()
	if len(got) != 1 || got[0].Item.Text != "bc" || got[0].Row != 0 {
		t.Fatalf("frames: %+v", got)
	}
	// Idle again: the next delta leads.
	clock.advance(60 * time.Millisecond)
	if !frames.AddText(0, text("assistant_message", "d", "m1"), "t1") {
		t.Fatal("a delta after an idle window must go out at once")
	}
}

func TestStreamFramesDropEmptyText(t *testing.T) {
	frames, _, _ := newTestFrames(t)
	if frames.AddText(0, text("assistant_message", "", "m1"), "t1") || len(frames.Pending()) != 0 {
		t.Fatal("an empty delta must not become a frame")
	}
}

func TestStreamFramesKeepRowsKindsAndOrderApart(t *testing.T) {
	frames, clock, _ := newTestFrames(t)
	frames.AddText(0, text("reasoning", "x", ""), "t1")
	frames.Take()
	clock.advance(time.Millisecond)
	frames.AddText(0, text("reasoning", "think ", ""), "t1")
	frames.AddText(1, text("assistant_message", "say ", "m1"), "t1")
	frames.AddToolCall(2, call("c1", "running"), "t1", nil)
	frames.AddText(1, text("assistant_message", "more", "m1"), "t1")
	frames.AddText(3, text("assistant_message", "other", "m2"), "t1")
	frames.AddText(3, text("assistant_message", " turn", "m2"), "t2")
	got := frames.Take()
	want := []string{"think ", "say ", "", "more", "other", " turn"}
	if len(got) != len(want) {
		t.Fatalf("frames: %+v", got)
	}
	for i, frame := range got {
		if frame.Item.Text != want[i] {
			t.Fatalf("frame %d text %q, want %q (all %+v)", i, frame.Item.Text, want[i], got)
		}
	}
}

func TestStreamFramesReplaceAPendingToolCallInPlace(t *testing.T) {
	frames, clock, _ := newTestFrames(t)
	frames.AddText(0, text("assistant_message", "x", "m1"), "t1")
	frames.Take()
	clock.advance(time.Millisecond)
	sent := call("c1", "running")
	frames.AddToolCall(1, call("c1", "running"), "t1", &sent)
	frames.AddToolCall(2, call("c2", "running"), "t1", nil)
	update := call("c1", "running")
	update.Name = "updated"
	if frames.AddToolCall(1, update, "t1", nil) {
		t.Fatal("a running call must wait for the window")
	}
	pending := frames.Pending()
	if len(pending) != 2 || pending[0].Item.Name != "updated" || pending[0].Visible != &sent || pending[1].Item.CallID != "c2" {
		t.Fatalf("pending: %+v", pending)
	}
	if !frames.AddToolCall(2, call("c2", "completed"), "t1", nil) {
		t.Fatal("a finished call must go out at once")
	}
}

// A timeline read mid-burst describes what the frames sent so far: the frames still pending then
// add exactly what is missing.
func TestVisibleTimelineLinesUpWithPendingFrames(t *testing.T) {
	sentCall := call("c1", "running")
	timeline := []TimelineEntry{
		{Seq: 1, SeqEnd: 1, Item: TimelineItem{Type: "user_message", Text: "hi"}},
		{Seq: 2, SeqEnd: 3, Item: text("assistant_message", "Hello world", "m1")},
		{Seq: 0, Item: text("reasoning", "never sent", "")},
		{Seq: 4, SeqEnd: 4, Item: call("c1", "completed")},
		{Seq: 0, Item: call("c2", "running")},
	}
	pending := []StreamFrame{
		{Kind: "text", Row: 1, Item: text("assistant_message", " world", "m1")},
		{Kind: "text", Row: 2, Item: text("reasoning", "never sent", "")},
		{Kind: "tool_call", Row: 3, Item: call("c1", "completed"), Visible: &sentCall},
		{Kind: "tool_call", Row: 4, Item: call("c2", "running")},
	}
	got := VisibleTimeline(timeline, pending)
	if len(got) != 3 {
		t.Fatalf("visible: %+v", got)
	}
	if got[1].Item.Text != "Hello" || got[2].Item.Status != "running" {
		t.Fatalf("visible: %+v", got)
	}
	if timeline[1].Item.Text != "Hello world" {
		t.Fatal("the stored timeline was modified")
	}
}
