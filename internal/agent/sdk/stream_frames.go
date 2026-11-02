package sdk

import "time"

// StreamFrameWindow is the Node daemon's AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS.
//
// Every websocket frame is one relay Durable Object request. Measured on pi 1.4, a 200-word
// answer arrives as ~1,230 deltas (245 text, 985 thinking) at ~140/s, so sending each delta costs an
// ordinary session millions of requests: the relay's free plan allows 100,000 per day, and one
// afternoon of agent work reached 2.26M. Node merged deltas per agent into at most one message per
// window; this window is that shape.
const StreamFrameWindow = 60 * time.Millisecond

// StreamFrames decides when a provider session's streamed timeline updates go out, ported from the
// archived Node daemon's AgentStreamCoalescer (agent/agent-stream-coalescer.ts).
//
// It lives in the session, before the session gives an update its seq. That is where Node had it:
// its coalescer sat in front of the timeline store, so each flushed item became one stored row with
// the next seq. A frame's seq is the client's continuity check: it applies a frame only when its seq
// is exactly one past the last one it has, and fetches the timeline again otherwise. Merging after
// the seq was taken (one per delta) sent every merged frame with a gap, and every client answered
// each one with a timeline fetch.
//
// Text deltas of one row merge into one frame; a tool call's later snapshot replaces its pending
// frame in place; a finished tool call goes out at once; the first update after an idle window goes
// out at once and the rest of a burst waits for the window to end. The caller holds its own lock
// around every method, and takes that lock in the timer callback before calling Take.
type StreamFrames struct {
	window    time.Duration
	clock     StreamFrameClock
	onTimer   func()
	timer     StreamFrameTimer
	lastFlush time.Time
	frames    []StreamFrame
	callIndex map[string]int
}

// StreamFrame is one pending update to a stored timeline row.
type StreamFrame struct {
	// Kind is "text" for assistant_message and reasoning deltas, "tool_call" for call snapshots.
	Kind string
	// Row is the session's index of the stored row the frame updates.
	Row int
	// Item is what the frame sends: for text, the row's type and message id with the merged text;
	// for a tool call, the latest snapshot.
	Item   TimelineItem
	TurnID string
	// Visible is what a reader of the stored timeline sees of a tool call row while this frame is
	// pending: the snapshot last sent, or nil when the row has never been sent.
	Visible *TimelineItem
}

// StreamFrameClock is the time source, injectable so tests can move the window without sleeping.
type StreamFrameClock interface {
	Now() time.Time
	AfterFunc(d time.Duration, fn func()) StreamFrameTimer
}

// StreamFrameTimer is the trailing flush timer.
type StreamFrameTimer interface {
	Stop() bool
}

type realStreamFrameClock struct{}

func (realStreamFrameClock) Now() time.Time { return time.Now() }

func (realStreamFrameClock) AfterFunc(d time.Duration, fn func()) StreamFrameTimer {
	return time.AfterFunc(d, fn)
}

// NewStreamFrames returns frames on the real clock. onTimer runs on the timer's goroutine when a
// burst's window ends; it takes the caller's lock and calls Take.
func NewStreamFrames(onTimer func()) *StreamFrames {
	return NewStreamFramesWithClock(StreamFrameWindow, realStreamFrameClock{}, onTimer)
}

// NewStreamFramesWithClock returns frames on the given window and clock.
func NewStreamFramesWithClock(window time.Duration, clock StreamFrameClock, onTimer func()) *StreamFrames {
	return &StreamFrames{window: window, clock: clock, onTimer: onTimer, callIndex: map[string]int{}}
}

// AddText buffers a text delta and reports whether the pending frames should go out now. A delta
// continuing the last pending frame's row merges into it: only adjacent chunks merge, so text on
// either side of another update stays two frames, in the order they arrived.
func (f *StreamFrames) AddText(row int, item TimelineItem, turnID string) bool {
	if item.Text == "" {
		// A delta with no text carries no row; sending it would emit an empty message.
		return false
	}
	if n := len(f.frames); n > 0 {
		last := &f.frames[n-1]
		if last.Kind == "text" && last.Row == row && last.TurnID == turnID && last.Item.Type == item.Type &&
			last.Item.MessageID == item.MessageID {
			last.Item.Text += item.Text
			return f.scheduleLocked()
		}
	}
	f.frames = append(f.frames, StreamFrame{Kind: "text", Row: row, Item: item, TurnID: turnID})
	return f.scheduleLocked()
}

// AddToolCall buffers a tool call snapshot and reports whether the pending frames should go out now.
// A later snapshot of a call that is still pending replaces it where it sits, keeping what readers
// see of the row; a finished call goes out at once, so a completed row never waits out the window.
func (f *StreamFrames) AddToolCall(row int, item TimelineItem, turnID string, visible *TimelineItem) bool {
	if index, ok := f.callIndex[item.CallID]; ok && item.CallID != "" {
		frame := &f.frames[index]
		frame.Row = row
		frame.Item = item
		frame.TurnID = turnID
	} else {
		if item.CallID != "" {
			f.callIndex[item.CallID] = len(f.frames)
		}
		f.frames = append(f.frames, StreamFrame{Kind: "tool_call", Row: row, Item: item, TurnID: turnID, Visible: visible})
	}
	if item.Status == "completed" || item.Status == "failed" || item.Status == "canceled" {
		return true
	}
	return f.scheduleLocked()
}

// scheduleLocked is the leading edge: the first update after an idle window goes out now, so the
// first token of a turn is not delayed a whole window; inside a burst the trailing timer holds the
// rate at one flush per window.
func (f *StreamFrames) scheduleLocked() bool {
	if f.timer != nil {
		return false
	}
	if f.lastFlush.IsZero() || f.clock.Now().Sub(f.lastFlush) >= f.window {
		return true
	}
	f.timer = f.clock.AfterFunc(f.window, f.onTimer)
	return false
}

// Take returns the pending frames, oldest first, and clears them.
func (f *StreamFrames) Take() []StreamFrame {
	f.stopTimer()
	if len(f.frames) == 0 {
		return nil
	}
	frames := f.frames
	f.frames = nil
	f.callIndex = map[string]int{}
	f.lastFlush = f.clock.Now()
	return frames
}

// Pending is the frames waiting to go out, for readers of the stored timeline.
func (f *StreamFrames) Pending() []StreamFrame {
	return f.frames
}

// Stop cancels the trailing timer, for a session that is closing.
func (f *StreamFrames) Stop() {
	f.stopTimer()
}

func (f *StreamFrames) stopTimer() {
	if f.timer != nil {
		f.timer.Stop()
		f.timer = nil
	}
}

// VisibleTimeline is the stored timeline as the frames sent so far describe it: the text of pending
// deltas cut from their rows, rows never sent left out, and a tool call with a pending snapshot shown
// as last sent. A timeline fetch answered from it lines up with the frames still to come, so the
// client neither repeats nor misses text when the next frame arrives.
func VisibleTimeline(timeline []TimelineEntry, pending []StreamFrame) []TimelineEntry {
	out := make([]TimelineEntry, 0, len(timeline))
	if len(pending) == 0 {
		return append(out, timeline...)
	}
	pendingText := map[int]int{}
	visibleCall := map[int]*TimelineItem{}
	hidden := map[int]bool{}
	for _, frame := range pending {
		switch frame.Kind {
		case "text":
			pendingText[frame.Row] += len(frame.Item.Text)
		case "tool_call":
			if frame.Visible != nil {
				visibleCall[frame.Row] = frame.Visible
			} else {
				hidden[frame.Row] = true
			}
		}
	}
	for index, entry := range timeline {
		if hidden[index] {
			continue
		}
		if n := pendingText[index]; n > 0 {
			if entry.Seq == 0 || n >= len(entry.Item.Text) {
				continue
			}
			entry.Item.Text = entry.Item.Text[:len(entry.Item.Text)-n]
		}
		if item := visibleCall[index]; item != nil {
			entry.Item = *item
		}
		out = append(out, entry)
	}
	return out
}
