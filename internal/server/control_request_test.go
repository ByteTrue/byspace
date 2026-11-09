package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A restart or stop ask has to be acknowledged and handed to the process owner.
//
// It used to reach a channel nobody read and produce no reply at all, so the app's restart button
// neither restarted the daemon nor reported that nothing happened.
func TestControlRequestIsAckedAndReachesTheProcessOwner(t *testing.T) {
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "0.20.2-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_control","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	for _, tc := range []struct {
		msgType string
		status  string
		restart bool
	}{
		{"restart_server_request", "restart_requested", true},
		{"shutdown_server_request", "shutdown_requested", false},
	} {
		frame, _ := json.Marshal(map[string]any{
			"type": "session",
			"message": map[string]any{
				"type":      tc.msgType,
				"requestId": "req_" + tc.msgType,
				"reason":    "control test",
			},
		})
		if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
			t.Fatal(err)
		}
		ack := readUntilSessionType(t, ctx, ws, "status", tc.status)
		if ack["requestId"] != "req_"+tc.msgType {
			t.Fatalf("%s ack carried requestId %v", tc.msgType, ack["requestId"])
		}
		select {
		case got := <-srv.ControlRequests():
			if got.Restart != tc.restart || got.Reason != "control test" {
				t.Fatalf("%s handed the owner %+v", tc.msgType, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s never reached the process owner", tc.msgType)
		}
	}
}
