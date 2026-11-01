package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakePiDeltas builds a pi script that streams n text deltas as fast as the pipe allows,
// which is what a fast model looks like to the daemon.
func fakePiDeltas(t *testing.T, n int) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	var b strings.Builder
	b.WriteString("#!/bin/sh\nwhile read line; do\n  case \"$line\" in\n    *'\"type\":\"prompt\"'*)\n")
	b.WriteString("      echo '{\"type\":\"agent_start\"}'\n")
	b.WriteString("      echo '{\"type\":\"turn_start\"}'\n")
	b.WriteString("      echo '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"content\":[]}}'\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "      echo '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"tok%d \"}}'\n", i)
	}
	b.WriteString("      echo '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[]}}'\n")
	b.WriteString("      echo '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\"}}'\n")
	b.WriteString("      echo '{\"type\":\"agent_end\",\"willRetry\":false}'\n")
	b.WriteString("      echo '{\"type\":\"agent_settled\"}'\n")
	b.WriteString("      ;;\n  esac\ndone\n")
	dir := t.TempDir()
	path := filepath.Join(dir, "delta-pi.sh")
	if err := os.WriteFile(path, []byte(b.String()), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestStreamFramesAreCoalesced locks in the frame budget the relay bills against.
//
// Every websocket frame is one Durable Object request on the relay, whose free plan allows
// 100,000 per day. Forwarding one frame per token delta (what the Go port did before the
// coalescer) made a single afternoon of ordinary agent work 2.26M requests, and a 200-word
// answer alone ~1,230 of them. The budget: at most one frame per coalescing window per agent,
// with nothing dropped.
func TestStreamFramesAreCoalesced(t *testing.T) {
	const deltas = 600
	expected := ""
	for i := 0; i < deltas; i++ {
		expected += fmt.Sprintf("tok%d ", i)
	}

	tmp := t.TempDir()
	fakePi := fakePiDeltas(t, deltas)
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: fakePi})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()

	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"frame-rate","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":            "create_agent_request",
			"requestId":       "fr_create",
			"clientMessageId": "client-msg-frame-rate",
			"initialPrompt":   "stream tokens",
			"config":          map[string]any{"provider": "pi", "cwd": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	var (
		frames     int
		itemFrames int
		received   strings.Builder
		firstFrame time.Time
		lastFrame  time.Time
		done       bool
	)
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) && !done {
		readCtx, readCancel := context.WithTimeout(ctx, 2*time.Second)
		_, data, err := ws.Read(readCtx)
		readCancel()
		if err != nil {
			break
		}
		var envelope struct {
			Type    string `json:"type"`
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal(data, &envelope) != nil || envelope.Type != "session" {
			continue
		}
		if firstFrame.IsZero() {
			firstFrame = time.Now()
		}
		lastFrame = time.Now()
		frames++
		if envelope.Message.Type != "agent_stream" {
			continue
		}
		event, _ := envelope.Message.Payload["event"].(map[string]any)
		kind, _ := event["type"].(string)
		switch kind {
		case "timeline":
			itemFrames++
			item, _ := event["item"].(map[string]any)
			if itemType, _ := item["type"].(string); itemType == "assistant_message" {
				if text, ok := item["text"].(string); ok {
					received.WriteString(text)
				}
			}
		case "turn_completed":
			done = true
		}
	}

	span := lastFrame.Sub(firstFrame)
	t.Logf("deltas=%d frames=%d timelineFrames=%d span=%s", deltas, frames, itemFrames, span.Round(time.Millisecond))

	if !done {
		t.Fatalf("turn did not complete: frames=%d", frames)
	}
	if got := received.String(); got != expected {
		t.Fatalf("merged text corrupted: got %d bytes, want %d", len(got), len(expected))
	}
	// One frame per window, plus slack for the leading flush, the barrier before turn_completed,
	// and the non-timeline frames that share this connection.
	ceiling := int(span/agentStreamCoalesceWindow) + 20
	if frames > ceiling {
		t.Fatalf("%d deltas became %d frames in %s; ceiling is %d (one frame per %s)",
			deltas, frames, span.Round(time.Millisecond), ceiling, agentStreamCoalesceWindow)
	}
}
