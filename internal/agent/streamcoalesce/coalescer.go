// Package streamcoalesce batches agent stream events into one frame per window.
//
// Ported from agent-stream-coalescer.ts. A provider emits one event per token, and forwarding each
// one is thousands of small frames per turn: the socket spends its time on framing, and the client
// re-renders per token instead of per paint. The coalescer keeps the streamed feel while bounding
// the frame rate.
//
// Three behaviours make it feel instant rather than laggy:
//
//   - Leading edge: the first event after an idle window flushes immediately, so the first token of
//     a turn is not delayed by a full window.
//   - Trailing timer: a sustained burst is batched per window.
//   - Terminal tool calls flush synchronously: a completed tool call is what the user is waiting to
//     see, and holding it for a window makes the UI look stuck.
package streamcoalesce

import (
	"sync"
	"time"
)

// DefaultWindow is how long events are batched.
//
// 60ms is under one frame at 60Hz: batching below the refresh rate cannot be seen, while anything
// above it delays the stream noticeably.
const DefaultWindow = 60 * time.Millisecond

// Item is one timeline item as the coalescer sees it: only the fields that decide batching.
type Item struct {
	Type string
	// Text is the accumulated text for assistant_message and reasoning.
	Text string
	// MessageID groups consecutive assistant deltas into one stream.
	MessageID string
	// CallID identifies a tool call so a status update replaces rather than appends.
	CallID string
	// Status is the tool call status; completed/failed/canceled flush immediately.
	Status string
}

// Event is one unit to batch.
type Event struct {
	AgentID  string
	Provider string
	TurnID   string
	Item     Item
}

// Flush delivers one batched event.
type Flush func(Event)

// coalescable reports whether an item type participates in batching.
func (i Item) coalescable() bool {
	switch i.Type {
	case "assistant_message", "reasoning", "tool_call":
		return true
	}
	return false
}

// isTerminalToolCall reports whether a tool call has settled.
func (i Item) isTerminalToolCall() bool {
	if i.Type != "tool_call" {
		return false
	}
	switch i.Status {
	case "completed", "failed", "canceled":
		return true
	}
	return false
}

// isTextItem reports whether an item carries streamed text.
func (i Item) isTextItem() bool {
	return i.Type == "assistant_message" || i.Type == "reasoning"
}

// pending is one buffered event.
type pending struct {
	event Event
	// text is the accumulated body for text entries; the item's own Text is the latest delta.
	text string
}

// buffer is one agent's pending batch.
type buffer struct {
	agentID string
	entries []pending
	// toolCallIndex maps a call id to its entry so a status update replaces it.
	toolCallIndex map[string]int
	timer         *time.Timer
	lastFlushAt   time.Time
	hasFlushed    bool
}

// Coalescer batches per agent.
type Coalescer struct {
	mu      sync.Mutex
	buffers map[string]*buffer
	onFlush Flush
	window  time.Duration
	now     func() time.Time
	// newTimer is injectable so tests do not depend on wall-clock windows.
	newTimer func(time.Duration, func()) *time.Timer
	stopped  bool
}

// New builds a coalescer.
func New(onFlush Flush) *Coalescer {
	return &Coalescer{
		buffers: make(map[string]*buffer),
		onFlush: onFlush,
		window:  DefaultWindow,
		now:     time.Now,
	}
}

// SetWindow overrides the batching window. Tests use a short one.
func (c *Coalescer) SetWindow(window time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if window > 0 {
		c.window = window
	}
}

// Handle buffers an event, reporting whether it was handled.
//
// A non-coalescable event or an empty text delta returns false and is the caller's to deliver
// unchanged: an empty delta carries no information, and dropping it silently is what keeps an
// empty assistant message from appearing in the transcript.
func (c *Coalescer) Handle(event Event) bool {
	if !event.Item.coalescable() {
		return false
	}
	if event.Item.isTextItem() && event.Item.Text == "" {
		// Reported as handled so the caller does not forward it either: an empty delta is noise.
		return true
	}

	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return false
	}
	buf := c.bufferLocked(event.AgentID)
	c.appendLocked(buf, event)

	if event.Item.isTerminalToolCall() {
		flushed := c.takeLocked(buf)
		c.mu.Unlock()
		c.deliver(flushed)
		return true
	}

	if buf.timer != nil {
		c.mu.Unlock()
		return true
	}
	// Leading edge: flush now when the window has been idle, so the first token of a turn is not
	// delayed by a full window. A sustained burst falls through to the trailing timer.
	idle := !buf.hasFlushed || c.now().Sub(buf.lastFlushAt) >= c.window
	if idle {
		flushed := c.takeLocked(buf)
		c.mu.Unlock()
		c.deliver(flushed)
		return true
	}
	c.scheduleLocked(buf)
	c.mu.Unlock()
	return true
}

// Flush delivers an agent's pending batch now.
func (c *Coalescer) Flush(agentID string) {
	c.mu.Lock()
	buf, ok := c.buffers[agentID]
	if !ok {
		c.mu.Unlock()
		return
	}
	flushed := c.takeLocked(buf)
	c.mu.Unlock()
	c.deliver(flushed)
}

// FlushAll delivers every pending batch.
func (c *Coalescer) FlushAll() {
	c.mu.Lock()
	agentIDs := make([]string, 0, len(c.buffers))
	for agentID := range c.buffers {
		agentIDs = append(agentIDs, agentID)
	}
	c.mu.Unlock()
	for _, agentID := range agentIDs {
		c.Flush(agentID)
	}
}

// FlushAndDiscard delivers and then forgets an agent's buffer.
//
// Called when an agent is closed: a timer that fires afterwards would deliver an event for an agent
// the client has already removed, and the client would either drop it or resurrect the row.
func (c *Coalescer) FlushAndDiscard(agentID string) {
	c.Flush(agentID)
	c.mu.Lock()
	if buf, ok := c.buffers[agentID]; ok {
		if buf.timer != nil {
			buf.timer.Stop()
			buf.timer = nil
		}
		delete(c.buffers, agentID)
	}
	c.mu.Unlock()
}

// Stop flushes everything and refuses further events.
func (c *Coalescer) Stop() {
	c.FlushAll()
	c.mu.Lock()
	for _, buf := range c.buffers {
		if buf.timer != nil {
			buf.timer.Stop()
			buf.timer = nil
		}
	}
	c.buffers = make(map[string]*buffer)
	c.stopped = true
	c.mu.Unlock()
}

// bufferLocked returns the agent's buffer, creating it.
func (c *Coalescer) bufferLocked(agentID string) *buffer {
	if existing, ok := c.buffers[agentID]; ok {
		return existing
	}
	buf := &buffer{agentID: agentID, toolCallIndex: make(map[string]int)}
	c.buffers[agentID] = buf
	return buf
}

// appendLocked adds an event to a buffer.
func (c *Coalescer) appendLocked(buf *buffer, event Event) {
	if event.Item.isTextItem() {
		buf.entries = append(buf.entries, pending{event: event, text: event.Item.Text})
		return
	}

	// A tool call's status updates replace its entry: the same call appears as running, then
	// completed, and appending both would show the call twice.
	entry := pending{event: event}
	if index, ok := buf.toolCallIndex[event.Item.CallID]; ok && event.Item.CallID != "" {
		buf.entries[index] = entry
		return
	}
	if event.Item.CallID != "" {
		buf.toolCallIndex[event.Item.CallID] = len(buf.entries)
	}
	buf.entries = append(buf.entries, entry)
}

// takeLocked removes and returns a buffer's entries.
func (c *Coalescer) takeLocked(buf *buffer) []pending {
	if buf.timer != nil {
		buf.timer.Stop()
		buf.timer = nil
	}
	entries := buf.entries
	if len(entries) == 0 {
		return nil
	}
	buf.entries = nil
	buf.toolCallIndex = make(map[string]int)
	buf.lastFlushAt = c.now()
	buf.hasFlushed = true
	return entries
}

// scheduleLocked arms the trailing timer.
func (c *Coalescer) scheduleLocked(buf *buffer) {
	agentID := buf.agentID
	window := c.window
	buf.timer = time.AfterFunc(window, func() {
		c.mu.Lock()
		current, ok := c.buffers[agentID]
		if !ok || current != buf {
			// Replaced or discarded while the timer was armed.
			c.mu.Unlock()
			return
		}
		flushed := c.takeLocked(current)
		c.mu.Unlock()
		c.deliver(flushed)
	})
}

// deliver collapses and emits a batch.
//
// Collapsing is what makes the output readable: thirty deltas of the same stream become one item
// with the concatenated text, so the client renders one growing message instead of thirty.
func (c *Coalescer) deliver(entries []pending) {
	if c.onFlush == nil {
		return
	}
	for _, collapsed := range collapse(entries) {
		c.onFlush(collapsed)
	}
}

// collapse merges consecutive text deltas of the same stream.
func collapse(entries []pending) []Event {
	out := make([]Event, 0, len(entries))
	for _, entry := range entries {
		if len(out) > 0 && isSameTextStream(out[len(out)-1], entry) {
			last := &out[len(out)-1]
			last.Item.Text += entry.text
			continue
		}
		event := entry.event
		if event.Item.isTextItem() {
			event.Item.Text = entry.text
		}
		out = append(out, event)
	}
	return out
}

// isSameTextStream reports whether two entries continue the same text stream.
func isSameTextStream(previous Event, next pending) bool {
	if !previous.Item.isTextItem() || !next.event.Item.isTextItem() {
		return false
	}
	if previous.Item.Type != next.event.Item.Type {
		return false
	}
	if previous.Provider != next.event.Provider || previous.TurnID != next.event.TurnID {
		return false
	}
	if previous.Item.Type == "assistant_message" {
		// Two assistant streams are the same stream only when the message id matches: a new
		// message must start a new entry, or two replies merge into one.
		return previous.Item.MessageID == next.event.Item.MessageID
	}
	return true
}
