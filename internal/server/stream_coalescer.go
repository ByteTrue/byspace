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
// costs a session millions of requests: the relay's free plan allows 100,000 per day, and one
// afternoon of ordinary agent work reached 2.26M. Node merged deltas per agent into at most one
// message per window, which is what this window restores.
const agentStreamCoalesceWindow = 60 * time.Millisecond

// coalescableStreamTypes are the timeline kinds whose deltas are merged into one item.
//
// shortcut: tool_call updates are forwarded one at a time rather than merged by toolCallId as
// Node did; add them here with a per-field merge if tool output ever becomes the dominant frame
// source.
var coalescableStreamTypes = map[string]bool{
	"assistant_message": true,
	"reasoning":         true,
}

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

type pendingStreamEntry struct {
	kind   string
	item   sdk.TimelineItem
	seq    int
	turnID string
}

type pendingStreamAgent struct {
	provider  string
	entries   []*pendingStreamEntry
	timer     *time.Timer
	lastFlush time.Time
}

// streamCoalescer merges a provider's token deltas into at most one frame per window per agent.
//
// It holds its own mutex and never sends while holding it: emitting reaches broadcastSessionMsg,
// which takes the server lock, and the server also calls into here.
type streamCoalescer struct {
	mu      sync.Mutex
	pending map[string]*pendingStreamAgent
	emit    func(agentID, provider, turnID string, seq int, item sdk.TimelineItem)
}

func newStreamCoalescer(emit func(agentID, provider, turnID string, seq int, item sdk.TimelineItem)) *streamCoalescer {
	return &streamCoalescer{pending: make(map[string]*pendingStreamAgent), emit: emit}
}

// add merges one delta, keyed by agent and item kind.
//
// The first delta after an idle window is emitted immediately: a client must not wait a whole
// window for the first characters of a turn. Only the rest of a burst waits for the trailing
// timer, which is the same leading+trailing shape as the Node coalescer.
func (c *streamCoalescer) add(agentID, provider, turnID string, seq int, item sdk.TimelineItem) {
	c.mu.Lock()
	p := c.pending[agentID]
	if p == nil {
		p = &pendingStreamAgent{provider: provider}
		c.pending[agentID] = p
	}
	p.provider = provider
	merged := false
	for _, entry := range p.entries {
		if entry.kind == item.Type {
			entry.item.Text += item.Text
			entry.seq = seq
			entry.turnID = turnID
			merged = true
			break
		}
	}
	if !merged {
		p.entries = append(p.entries, &pendingStreamEntry{kind: item.Type, item: item, seq: seq, turnID: turnID})
	}

	if p.lastFlush.IsZero() || time.Since(p.lastFlush) >= agentStreamCoalesceWindow {
		ready := c.takeLocked(agentID, p)
		c.mu.Unlock()
		c.emitAll(agentID, ready)
		return
	}
	if p.timer == nil {
		p.timer = time.AfterFunc(agentStreamCoalesceWindow, func() { c.flush(agentID) })
	}
	c.mu.Unlock()
}

// flush emits whatever is pending for one agent. Callers use it as an ordering barrier before any
// event that is not a coalescable delta.
func (c *streamCoalescer) flush(agentID string) {
	c.mu.Lock()
	p := c.pending[agentID]
	if p == nil {
		c.mu.Unlock()
		return
	}
	ready := c.takeLocked(agentID, p)
	c.mu.Unlock()
	c.emitAll(agentID, ready)
}

// flushAll emits everything pending, for shutdown.
func (c *streamCoalescer) flushAll() {
	c.mu.Lock()
	ids := make([]string, 0, len(c.pending))
	for id := range c.pending {
		ids = append(ids, id)
	}
	c.mu.Unlock()
	for _, id := range ids {
		c.flush(id)
	}
}

type readyStreamEntry struct {
	provider string
	turnID   string
	seq      int
	item     sdk.TimelineItem
}

// takeLocked moves the pending entries out and resets the agent's timers. Caller holds c.mu.
func (c *streamCoalescer) takeLocked(agentID string, p *pendingStreamAgent) []readyStreamEntry {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
	if len(p.entries) == 0 {
		p.lastFlush = time.Now()
		return nil
	}
	ready := make([]readyStreamEntry, 0, len(p.entries))
	for _, entry := range p.entries {
		ready = append(ready, readyStreamEntry{
			provider: p.provider,
			turnID:   entry.turnID,
			seq:      entry.seq,
			item:     entry.item,
		})
	}
	p.entries = nil
	p.lastFlush = time.Now()
	return ready
}

func (c *streamCoalescer) emitAll(agentID string, ready []readyStreamEntry) {
	for _, entry := range ready {
		c.emit(agentID, entry.provider, entry.turnID, entry.seq, entry.item)
	}
}
