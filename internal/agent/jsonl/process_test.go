package jsonl

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"runtime"
	"testing"
	"time"
)

func TestProcessRequestEventsAndV2ChunkReassembly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	// Small sh script that reads a JSON line and emits an event, a chunked event, and a response.
	payload := `{"type":"big_event","value":"hello-from-reassembled-chunks"}`
	half := len(payload) / 2
	c0 := base64.StdEncoding.EncodeToString([]byte(payload[:half]))
	c1 := base64.StdEncoding.EncodeToString([]byte(payload[half:]))

	script := fmt.Sprintf(`
read line
echo '{"type":"agent_start"}'
echo '{"type":"rpc_chunk","chunkId":"chk_1","index":0,"count":2,"byteLength":%d,"data":"%s"}'
echo '{"type":"rpc_chunk","chunkId":"chk_1","index":1,"count":2,"byteLength":%d,"data":"%s"}'
echo '{"type":"response","id":"req_1","command":"get_state","success":true,"data":{"sessionId":"s_123"}}'
`, len(payload), c0, len(payload), c1)

	proc, err := Start(LaunchConfig{
		Command: "/bin/sh",
		Args:    []string{"-c", script},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer proc.Close()

	events := make(chan map[string]any, 8)
	unsub := proc.OnEvent(func(ev map[string]any) {
		events <- ev
	})
	defer unsub()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rawData, err := proc.Request(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(rawData, &st); err != nil || st.SessionID != "s_123" {
		t.Fatalf("unexpected response data: %s (%v)", string(rawData), err)
	}

	ev1 := <-events
	if ev1["type"] != "agent_start" {
		t.Fatalf("expected agent_start, got %+v", ev1)
	}
	ev2 := <-events
	if ev2["type"] != "big_event" || ev2["value"] != "hello-from-reassembled-chunks" {
		t.Fatalf("expected reassembled big_event, got %+v", ev2)
	}
}
