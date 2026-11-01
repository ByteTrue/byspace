package server

import (
	"encoding/json"
	"log"
	"runtime"
	"sort"
	"sync"
	"time"
)

// runtimeMetricsInterval is Node's 30s flush (websocket/runtime-metrics.ts): the line stays a
// summary instead of traffic, and a burst that starts and ends inside one window still shows up.
const runtimeMetricsInterval = 30 * time.Second

// runtimeMetricsTopN bounds each "top" list, as in Node.
const runtimeMetricsTopN = 12

// Sample caps: a window is 30s, so these are per-window ceilings that keep a frame storm from
// turning the instrumentation itself into an allocation problem.
const (
	runtimeMetricsMaxSamples      = 4096
	runtimeMetricsMaxLatency      = 1024
	runtimeMetricsMaxLatencyKinds = 64
)

// runtimeMetrics accumulates one window of traffic and logs it as a single `ws_runtime_metrics`
// line.
//
// Why this exists: the relay bills one Durable Object request per websocket frame, so "how many
// frames is this daemon sending, and which type" is a first-order question — and answering it once
// took a Cloudflare GraphQL query because the daemon kept no counter at all.
//
// Fields Node logs that this daemon does not instrument (the 15 websocket lifecycle counters such
// as `validationFailed`) are absent rather than reported as 0: a fabricated zero reads as "none"
// and hides that nothing is counted. `latency` is the synchronous dispatch time of a request, not
// the full round trip, because responses here can be produced on another goroutine.
type runtimeMetrics struct {
	mu sync.Mutex

	windowStart       time.Time
	inbound           map[string]int64
	outbound          map[string]int64
	outboundSession   map[string]int64
	agentStream       map[string]int64
	agentStreamAgents map[string]int64
	binary            map[string]int64

	buffered   []int64
	latency    map[string][]time.Duration
	tickDelays []time.Duration
	lastTick   time.Time
	collect    func(string)
}

func newRuntimeMetrics() *runtimeMetrics {
	return &runtimeMetrics{
		windowStart:       time.Now(),
		inbound:           make(map[string]int64),
		outbound:          make(map[string]int64),
		outboundSession:   make(map[string]int64),
		agentStream:       make(map[string]int64),
		agentStreamAgents: make(map[string]int64),
		binary:            make(map[string]int64),
		latency:           make(map[string][]time.Duration),
		collect:           func(line string) { log.Print(line) },
	}
}

func runtimeBump(counts map[string]int64, key string) {
	if key == "" {
		return
	}
	counts[key]++
}

// recordInbound counts one client message by type.
func (m *runtimeMetrics) recordInbound(msgType string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	runtimeBump(m.inbound, msgType)
	m.mu.Unlock()
}

// recordOutbound counts one message sent to clients. `payload` is only inspected for
// agent_stream, whose event type and agent id are what say which agent is producing the frames.
func (m *runtimeMetrics) recordOutbound(msgType string, payload any, buffered int64) {
	if m == nil {
		return
	}
	m.mu.Lock()
	runtimeBump(m.outbound, msgType)
	if msgType == "agent_stream" {
		runtimeBump(m.outboundSession, "agent_stream")
		if fields, ok := payload.(map[string]any); ok {
			if event, ok := fields["event"].(map[string]any); ok {
				kind, _ := event["type"].(string)
				runtimeBump(m.agentStream, kind)
			}
			if agentID, ok := fields["agentId"].(string); ok {
				runtimeBump(m.agentStreamAgents, agentID)
			}
		}
	} else {
		runtimeBump(m.outboundSession, msgType)
	}
	if len(m.buffered) < runtimeMetricsMaxSamples {
		m.buffered = append(m.buffered, buffered)
	}
	m.mu.Unlock()
}

// recordBinary counts one binary frame by label (terminal output is the only binary channel).
func (m *runtimeMetrics) recordBinary(label string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	runtimeBump(m.binary, label)
	m.mu.Unlock()
}

// recordLatency samples how long a request took to handle synchronously.
func (m *runtimeMetrics) recordLatency(msgType string, took time.Duration) {
	if m == nil || msgType == "" {
		return
	}
	m.mu.Lock()
	if len(m.latency) < runtimeMetricsMaxLatencyKinds || m.latency[msgType] != nil {
		samples := m.latency[msgType]
		if len(samples) < runtimeMetricsMaxLatency {
			m.latency[msgType] = append(samples, took)
		}
	}
	m.mu.Unlock()
}

type runtimeMetricsLatency struct {
	Type    string  `json:"type"`
	Count   int     `json:"count"`
	P50Ms   float64 `json:"p50Ms"`
	P95Ms   float64 `json:"p95Ms"`
	MaxMs   float64 `json:"maxMs"`
	TotalMs float64 `json:"totalMs"`
}

// snapshot renders the window. Callers pass the live socket/agent counts because the metrics
// struct does not own server state.
func (m *runtimeMetrics) snapshot(sessions map[string]any, sockets map[string]any, uptime float64) map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()

	windowMs := time.Since(m.windowStart).Milliseconds()
	buffered := append([]int64(nil), m.buffered...)
	tickDelays := append([]time.Duration(nil), m.tickDelays...)
	latency := make([]runtimeMetricsLatency, 0, len(m.latency))
	for msgType, samples := range m.latency {
		sorted := append([]time.Duration(nil), samples...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		var total time.Duration
		for _, s := range sorted {
			total += s
		}
		latency = append(latency, runtimeMetricsLatency{
			Type:    msgType,
			Count:   len(sorted),
			P50Ms:   runtimeMillis(percentileDuration(sorted, 0.50)),
			P95Ms:   runtimeMillis(percentileDuration(sorted, 0.95)),
			MaxMs:   runtimeMillis(sorted[len(sorted)-1]),
			TotalMs: runtimeMillis(total),
		})
	}
	sort.Slice(latency, func(i, j int) bool { return latency[i].TotalMs > latency[j].TotalMs })

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	out := map[string]any{
		"msg":                            "ws_runtime_metrics",
		"collectedAt":                    time.Now().UTC().Format(time.RFC3339Nano),
		"windowMs":                       windowMs,
		"final":                          false,
		"uptimeSeconds":                  uptime,
		"goroutines":                     runtime.NumGoroutine(),
		"memory":                         map[string]any{"heapBytes": mem.HeapAlloc, "sysBytes": mem.Sys},
		"eventLoopDelay":                 map[string]any{"p50Ms": runtimeMillis(percentileDuration(tickDelays, 0.50)), "maxMs": runtimeMillis(percentileDuration(tickDelays, 1.0))},
		"bufferedAmount":                 map[string]any{"p50": percentileInt64(buffered, 0.50), "p95": percentileInt64(buffered, 0.95), "max": percentileInt64(buffered, 1.0)},
		"sessions":                       sessions,
		"sockets":                        sockets,
		"inboundMessageTypesTop":         topCounts(m.inbound),
		"outboundMessageTypesTop":        topCounts(m.outbound),
		"outboundSessionMessageTypesTop": topCounts(m.outboundSession),
		"outboundAgentStreamTypesTop":    topCounts(m.agentStream),
		"outboundAgentStreamAgentsTop":   topCounts(m.agentStreamAgents),
		"outboundBinaryFrameTypesTop":    topCounts(m.binary),
		"latency":                        latency,
	}
	return out
}

// flush logs the window and starts a new one.
func (m *runtimeMetrics) flush(sessions map[string]any, sockets map[string]any, uptime float64) {
	if m == nil {
		return
	}
	out := m.snapshot(sessions, sockets, uptime)
	line, err := json.Marshal(out)
	if err != nil {
		return
	}
	m.collect(string(line))

	m.mu.Lock()
	m.windowStart = time.Now()
	m.inbound = make(map[string]int64)
	m.outbound = make(map[string]int64)
	m.outboundSession = make(map[string]int64)
	m.agentStream = make(map[string]int64)
	m.agentStreamAgents = make(map[string]int64)
	m.binary = make(map[string]int64)
	m.buffered = nil
	m.latency = make(map[string][]time.Duration)
	m.tickDelays = nil
	m.mu.Unlock()
}

// noteTick records how late the flush timer fired.
//
// Node reports `eventLoopDelay`, the drift of a setTimeout; Go has no event loop, and the
// equivalent question — "is the scheduler keeping up" — is how late this timer arrived. A p50 near
// 0 means idle work is not starving; a large p50 during a burst means it is.
func (m *runtimeMetrics) noteTick(at time.Time) {
	if m == nil {
		return
	}
	m.mu.Lock()
	if !m.lastTick.IsZero() {
		expected := runtimeMetricsInterval
		actual := at.Sub(m.lastTick)
		if actual > expected && len(m.tickDelays) < runtimeMetricsMaxSamples {
			m.tickDelays = append(m.tickDelays, actual-expected)
		}
	}
	m.lastTick = at
	m.mu.Unlock()
}

func topCounts(counts map[string]int64) [][2]any {
	type pair struct {
		key   string
		count int64
	}
	pairs := make([]pair, 0, len(counts))
	for key, count := range counts {
		pairs = append(pairs, pair{key, count})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count != pairs[j].count {
			return pairs[i].count > pairs[j].count
		}
		return pairs[i].key < pairs[j].key
	})
	if len(pairs) > runtimeMetricsTopN {
		pairs = pairs[:runtimeMetricsTopN]
	}
	out := make([][2]any, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, [2]any{p.key, p.count})
	}
	return out
}

func percentileDuration(sorted []time.Duration, fraction float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	sorted = append([]time.Duration(nil), sorted...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(fraction * float64(len(sorted)-1))
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func percentileInt64(values []int64, fraction float64) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(fraction * float64(len(sorted)-1))
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func runtimeMillis(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000
}

// startRuntimeMetrics logs one window every 30s until the server closes.
func (s *Server) startRuntimeMetrics() {
	go func() {
		ticker := time.NewTicker(runtimeMetricsInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case at := <-ticker.C:
				s.metrics.noteTick(at)
				sessions, sockets := s.runtimeCounts()
				s.metrics.flush(sessions, sockets, time.Since(s.startedAt).Seconds())
			}
		}
	}()
}

// runtimeCounts is the live connection picture the metrics line reports.
func (s *Server) runtimeCounts() (map[string]any, map[string]any) {
	s.mu.Lock()
	active := 0
	for _, handshaked := range s.clients {
		if handshaked {
			active++
		}
	}
	agents := len(s.agents)
	terminals := len(s.terminals)
	fileSubs := len(s.fileSubs)
	diffSubs := len(s.diffSubs)
	s.mu.Unlock()

	return map[string]any{
		"activeConnections": active,
		"loadedAgents":      agents,
		"terminals":         terminals,
		"fileSubscriptions": fileSubs,
		"diffSubscriptions": diffSubs,
	}, map[string]any{
		"activeSockets": active,
	}
}
