package server

import (
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// agentStreamCoalesceWindow is the Node daemon's AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS.
//
// Every websocket frame is one relay Durable Object request. Measured on pi 1.4, a 200-word
// answer arrives as ~1,230 deltas (245 text, 985 thinking) at ~140/s, so forwarding each delta
// costs an ordinary session millions of requests: the relay's free plan allows 100,000 per day,
// and one afternoon of agent work reached 2.26M. Node merged deltas per agent into at most one
// message per window; this window is that shape.
const agentStreamCoalesceWindow = 60 * time.Millisecond

// streamBarrierEvents must not overtake merged text: they either end the run or start a new one.
//
// Only these flush. A blanket "any event that is not a delta" barrier looks safer but is not: pi
// delivers every raw `message_update` just before the synthetic timeline event it produced, so the
// barrier would fire before every single delta and merging would never happen.
var streamBarrierEvents = map[string]bool{
	"byspace_turn_started":   true,
	"byspace_turn_completed": true,
	"byspace_turn_failed":    true,
	"byspace_turn_canceled":  true,
	"turn_start":             true,
	"agent_end":              true,
	"agent_settled":          true,
}

// streamCoalescerTimer and streamCoalescerTimers are injected so tests can advance the window
// without sleeping, the way the Node coalescer takes its timers from the caller.
type streamCoalescerTimer interface {
	Stop() bool
}

type streamCoalescerTimers interface {
	Now() time.Time
	AfterFunc(d time.Duration, fn func()) streamCoalescerTimer
}

type realStreamTimers struct{}

func (realStreamTimers) Now() time.Time { return time.Now() }

func (realStreamTimers) AfterFunc(d time.Duration, fn func()) streamCoalescerTimer {
	return time.AfterFunc(d, fn)
}

// streamEntry is one buffered timeline item. Text entries accumulate in arrival order and are
// joined at flush time; a tool_call entry is replaced in place whenever the same call reports
// again, because a later snapshot of a call is the whole truth for that row.
type streamEntry struct {
	kind     string // "text" or "tool_call"
	item     sdk.TimelineItem
	text     string
	provider string
	turnID   string
	seq      int
}

func (e streamEntry) isText() bool { return e.kind == "text" }

// isTerminalToolCall reports whether this tool_call entry is the last word on its call. Those
// flush immediately so a finished row does not wait out the window.
func (e streamEntry) isTerminalToolCall() bool {
	if e.kind != "tool_call" {
		return false
	}
	return e.item.Status == "completed" || e.item.Status == "failed" || e.item.Status == "canceled"
}

// sameTextStream reports whether two text entries are two chunks of one row.
//
// An assistant message is identified by the provider's message id, so a new message never
// continues the previous one. reasoning has no id and collapses by kind alone, as in Node.
func sameTextStream(previous, next streamEntry) bool {
	if previous.item.Type != next.item.Type {
		return false
	}
	if previous.item.Type == "assistant_message" {
		return previous.item.MessageID == next.item.MessageID
	}
	return true
}

type pendingStreamAgent struct {
	entries   []streamEntry
	callIndex map[string]int
	timer     streamCoalescerTimer
	flushing  bool
	lastFlush time.Time
}

// streamCoalescer merges a provider's token deltas into at most one frame per window per agent.
//
// It holds its own mutex and never emits while holding it: emitting reaches broadcastSessionMsg,
// which takes the server lock, and the server also calls into here.
type streamCoalescer struct {
	mu      sync.Mutex
	pending map[string]*pendingStreamAgent
	emit    func(agentID, provider, turnID string, seq int, item sdk.TimelineItem)
	window  time.Duration
	timers  streamCoalescerTimers
}

func newStreamCoalescer(emit func(agentID, provider, turnID string, seq int, item sdk.TimelineItem)) *streamCoalescer {
	return &streamCoalescer{
		pending: make(map[string]*pendingStreamAgent),
		emit:    emit,
		window:  agentStreamCoalesceWindow,
		timers:  realStreamTimers{},
	}
}

// handle buffers one timeline item and reports whether it was consumed. A caller that gets false
// forwards the item itself, after flushing what is pending.
func (c *streamCoalescer) handle(agentID, provider, turnID string, seq int, item sdk.TimelineItem) bool {
	entry, ok := coalescableEntry(provider, turnID, item)
	if !ok {
		return false
	}
	if entry.isText() && entry.text == "" {
		// A delta with no text carries no row; buffering it would emit an empty message.
		return true
	}
	entry.seq = seq

	c.mu.Lock()
	buffer := c.pending[agentID]
	if buffer == nil {
		buffer = &pendingStreamAgent{callIndex: make(map[string]int)}
		c.pending[agentID] = buffer
	}
	c.appendToBuffer(buffer, entry)

	if entry.isTerminalToolCall() {
		ready := c.takeLocked(buffer)
		c.mu.Unlock()
		c.emitAll(agentID, ready)
		return true
	}

	// Leading edge: the first item after an idle window is emitted synchronously so the first
	// token of a turn is not delayed a whole window. A sustained burst falls through to the
	// trailing timer, which holds the rate at one message per window.
	if buffer.timer == nil {
		idle := buffer.lastFlush.IsZero() ||
			c.timers.Now().Sub(buffer.lastFlush) >= c.window
		if idle {
			ready := c.takeLocked(buffer)
			c.mu.Unlock()
			c.emitAll(agentID, ready)
			return true
		}
		buffer.timer = c.timers.AfterFunc(c.window, func() { c.flushTimer(agentID, buffer) })
	}
	c.mu.Unlock()
	return true
}

// coalescableEntry maps a timeline item onto a buffer entry, reporting false for kinds that are
// forwarded one at a time.
func coalescableEntry(provider, turnID string, item sdk.TimelineItem) (streamEntry, bool) {
	switch item.Type {
	case "assistant_message", "reasoning":
		entry := streamEntry{kind: "text", item: item, text: item.Text, provider: provider, turnID: turnID}
		return entry, true
	case "tool_call":
		return streamEntry{kind: "tool_call", item: item, provider: provider, turnID: turnID}, true
	}
	return streamEntry{}, false
}

// appendToBuffer keeps the order the provider produced entries in. A tool_call on a call id that
// is already buffered replaces that entry where it sits.
func (c *streamCoalescer) appendToBuffer(buffer *pendingStreamAgent, entry streamEntry) {
	if entry.isText() {
		buffer.entries = append(buffer.entries, entry)
		return
	}
	if index, ok := buffer.callIndex[entry.item.CallID]; ok {
		buffer.entries[index] = entry
		return
	}
	buffer.callIndex[entry.item.CallID] = len(buffer.entries)
	buffer.entries = append(buffer.entries, entry)
}

// flush emits whatever is pending for one agent. Callers use it as an ordering barrier before any
// event that is not a coalescable delta.
func (c *streamCoalescer) flush(agentID string) {
	c.mu.Lock()
	buffer := c.pending[agentID]
	if buffer == nil {
		c.mu.Unlock()
		return
	}
	ready := c.takeLocked(buffer)
	c.mu.Unlock()
	c.emitAll(agentID, ready)
}

// flushAll emits everything pending, for shutdown.
func (c *streamCoalescer) flushAll() {
	for _, agentID := range c.agentIDs() {
		c.flush(agentID)
	}
}

// forget flushes an agent's pending text and then drops its buffer once the agent is gone, so a
// long-lived daemon does not keep state for every agent it has ever run.
func (c *streamCoalescer) forget(agentID string) {
	c.flush(agentID)
	c.mu.Lock()
	if buffer := c.pending[agentID]; buffer != nil {
		if buffer.timer != nil {
			buffer.timer.Stop()
			buffer.timer = nil
		}
		delete(c.pending, agentID)
	}
	c.mu.Unlock()
}

func (c *streamCoalescer) agentIDs() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	ids := make([]string, 0, len(c.pending))
	for id := range c.pending {
		ids = append(ids, id)
	}
	return ids
}

// flushTimer is the trailing flush. A callback whose buffer has been replaced (the agent was
// forgotten and started again) or that arrives while a flush is running does nothing.
func (c *streamCoalescer) flushTimer(agentID string, expected *pendingStreamAgent) {
	c.mu.Lock()
	buffer := c.pending[agentID]
	if buffer != expected {
		c.mu.Unlock()
		return
	}
	ready := c.takeLocked(buffer)
	c.mu.Unlock()
	c.emitAll(agentID, ready)
}

// takeLocked moves the buffer's entries out and resets its state. Caller holds c.mu.
//
// A buffer that is already flushing is left alone: emitting can call back into the server, and a
// second flush from inside the first would send the same rows twice.
func (c *streamCoalescer) takeLocked(buffer *pendingStreamAgent) []streamEntry {
	if buffer.flushing {
		return nil
	}
	c.clearTimerLocked(buffer)
	if len(buffer.entries) == 0 {
		return nil
	}
	entries := buffer.entries
	buffer.entries = nil
	buffer.callIndex = make(map[string]int)
	buffer.flushing = true
	buffer.lastFlush = c.timers.Now()
	return entries
}

func (c *streamCoalescer) clearTimerLocked(buffer *pendingStreamAgent) {
	if buffer.timer == nil {
		return
	}
	buffer.timer.Stop()
	buffer.timer = nil
}

func (c *streamCoalescer) emitAll(agentID string, entries []streamEntry) {
	if len(entries) > 0 {
		for _, entry := range collapseStreamEntries(entries) {
			item := entry.item
			if entry.isText() {
				item.Text = entry.text
			}
			c.emit(agentID, entry.provider, entry.turnID, entry.seq, item)
		}
	}
	c.mu.Lock()
	if buffer := c.pending[agentID]; buffer != nil {
		buffer.flushing = false
	}
	c.mu.Unlock()
}

// collapseStreamEntries joins adjacent chunks of one text row, keeping everything else in order.
//
// Only adjacent entries collapse: text on either side of a tool_call stays two rows, which is the
// order the client renders.
func collapseStreamEntries(entries []streamEntry) []streamEntry {
	collapsed := make([]streamEntry, 0, len(entries))
	for _, entry := range entries {
		if n := len(collapsed); n > 0 {
			previous := &collapsed[n-1]
			if previous.isText() && entry.isText() &&
				sameTextStream(*previous, entry) &&
				previous.provider == entry.provider &&
				previous.turnID == entry.turnID {
				previous.text += entry.text
				previous.seq = entry.seq
				continue
			}
		}
		collapsed = append(collapsed, entry)
	}
	return collapsed
}
