package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// countingSink is a frameSink with an explicit write backlog, standing in for a socket whose
// transport is behind.
type backlogSink struct {
	buffered int64
	known    bool
	frames   [][]byte
}

func (c *backlogSink) SendText(context.Context, string) error { return nil }

func (c *backlogSink) SendBinary(_ context.Context, data []byte) error {
	c.frames = append(c.frames, append([]byte(nil), data...))
	return nil
}

func (c *backlogSink) Close(websocket.StatusCode, string) error { return nil }

func (c *backlogSink) Buffered() int64 { return c.buffered }

// opaqueSink is a frameSink with no backpressure signal, like a relay-multiplexed socket.
type opaqueSink struct{ frames [][]byte }

func (o *opaqueSink) SendText(context.Context, string) error { return nil }

func (o *opaqueSink) SendBinary(_ context.Context, data []byte) error {
	o.frames = append(o.frames, append([]byte(nil), data...))
	return nil
}

func (o *opaqueSink) Close(websocket.StatusCode, string) error { return nil }

// The limits are Node's, and they are the whole point: a client that stops draining must be caught
// up with a bounded snapshot instead of an unbounded output queue.
func TestTerminalBackpressureLimitsMatchNode(t *testing.T) {
	if maxTerminalOutputFrameBytes != 256*1024 {
		t.Fatalf("output threshold = %d, want 256 KiB (MAX_TERMINAL_OUTPUT_FRAME_BYTES)", maxTerminalOutputFrameBytes)
	}
	if maxClientBufferedBytes != 4*1024*1024 {
		t.Fatalf("buffered threshold = %d, want 4 MiB (MAX_CLIENT_BUFFERED_BYTES)", maxClientBufferedBytes)
	}
	if maxTerminalOverflowScrollbackLines != 1000 {
		t.Fatalf("overflow scrollback = %d, want 1000", maxTerminalOverflowScrollbackLines)
	}
}

// A snapshot is only warranted when the client is behind in produced output AND backed up on the
// wire: a client that keeps draining streams continuously past the byte threshold.
func TestTerminalOutputOverflowNeedsBothConditions(t *testing.T) {
	draining := &backlogSink{known: true, buffered: 0}
	busy := &backlogSink{known: true, buffered: 8 * 1024 * 1024}

	cases := []struct {
		name   string
		output int64
		sink   frameSink
		want   bool
	}{
		{"far behind but draining", 1024 * 1024, draining, false},
		{"backed up but up to date", 1024, busy, false},
		{"far behind and backed up", 1024 * 1024, busy, true},
		{"exactly at the byte threshold", maxTerminalOutputFrameBytes, busy, false},
		{"one byte past the threshold", maxTerminalOutputFrameBytes + 1, busy, true},
		{"no backpressure signal falls back", 1024 * 1024, &opaqueSink{}, true},
	}
	for _, tc := range cases {
		if got := terminalOutputOverflow(tc.output, tc.sink); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// The runtime metrics line is the only instrument that says how many frames the daemon sends.
// Without it, a frame storm is invisible until a quota page explains it days later.
func TestRuntimeMetricsWindowReportsTraffic(t *testing.T) {
	metrics := newRuntimeMetrics()
	var lines []string
	metrics.collect = func(line string) { lines = append(lines, line) }

	metrics.recordInbound("send_agent_message_request")
	metrics.recordInbound("ping")
	for i := 0; i < 30; i++ {
		metrics.recordOutbound("agent_stream", map[string]any{
			"agentId": "agent-1",
			"event":   map[string]any{"type": "timeline", "item": map[string]any{"type": "assistant_message"}},
		}, int64(i))
	}
	metrics.recordOutbound("workspace_update", map[string]any{}, 0)
	metrics.recordBinary("terminal_output")
	metrics.recordLatency("ping", 2*time.Millisecond)

	sessions := map[string]any{"activeConnections": 1}
	sockets := map[string]any{"activeSockets": 1}
	out := metrics.snapshot(sessions, sockets, 12.5)

	if out["msg"] != "ws_runtime_metrics" {
		t.Fatalf("msg = %v, want ws_runtime_metrics so `daemon logs` keeps filtering it", out["msg"])
	}
	inbound := out["inboundMessageTypesTop"].([][2]any)
	if len(inbound) != 2 {
		t.Fatalf("inbound top = %v", out["inboundMessageTypesTop"])
	}
	seen := map[any]bool{inbound[0][0]: true, inbound[1][0]: true}
	if !seen["send_agent_message_request"] || !seen["ping"] {
		t.Fatalf("inbound top = %v", out["inboundMessageTypesTop"])
	}
	if outbound := out["outboundMessageTypesTop"].([][2]any); len(outbound) != 2 || outbound[0][0] != "agent_stream" {
		t.Fatalf("outbound top = %v", out["outboundMessageTypesTop"])
	}
	if agents := out["outboundAgentStreamAgentsTop"].([][2]any); len(agents) != 1 || agents[0][0] != "agent-1" {
		t.Fatalf("agent stream agents = %v", out["outboundAgentStreamAgentsTop"])
	}
	buffered := out["bufferedAmount"].(map[string]any)
	if buffered["max"] != int64(29) {
		t.Fatalf("buffered max = %v, want 29", buffered["max"])
	}
	latency := out["latency"].([]runtimeMetricsLatency)
	if len(latency) != 1 || latency[0].Type != "ping" || latency[0].Count != 1 {
		t.Fatalf("latency = %+v", latency)
	}

	metrics.flush(sessions, sockets, 12.5)
	if len(lines) != 1 {
		t.Fatalf("expected one log line, got %d", len(lines))
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &decoded); err != nil {
		t.Fatalf("the line must be JSON: %v (%q)", err, lines[0])
	}
	if !strings.Contains(lines[0], `"msg":"ws_runtime_metrics"`) {
		t.Fatalf("line must carry the msg key: %q", lines[0])
	}

	// The next window starts empty: a counter that never resets turns every line into a total.
	metrics.recordInbound("ping")
	out = metrics.snapshot(sessions, sockets, 13)
	if inbound := out["inboundMessageTypesTop"].([][2]any); len(inbound) != 1 || inbound[0][1] != int64(1) {
		t.Fatalf("second window must count from zero: %v", out["inboundMessageTypesTop"])
	}
}

// eventLoopDelay is Node's setTimeout drift; here it is how late the flush timer fired.
func TestRuntimeMetricsRecordsTimerDrift(t *testing.T) {
	metrics := newRuntimeMetrics()
	start := time.Now()
	metrics.noteTick(start)
	metrics.noteTick(start.Add(runtimeMetricsInterval + 40*time.Millisecond))

	out := metrics.snapshot(nil, nil, 1)
	delay := out["eventLoopDelay"].(map[string]any)
	if delay["maxMs"].(float64) < 39 {
		t.Fatalf("expected the 40ms late tick to be recorded, got %v", delay)
	}
}
