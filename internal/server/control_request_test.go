package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
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

func TestDaemonUpdateReplacesBinaryAndRequestsRestart(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "byspace")
	if err := os.WriteFile(executable, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(dir, "home"), Version: "0.20.2"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	srv.selfUpdateExecutable = executable
	srv.selfUpdateFetch = func(_ context.Context, version string) ([]byte, error) {
		return []byte("new-binary-" + version), nil
	}

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_update","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	reqFrame, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "daemon.update.request",
			"requestId": "req_update_1",
			"version":   "0.20.3",
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, reqFrame); err != nil {
		t.Fatal(err)
	}

	resp := readUntilSessionType(t, ctx, ws, "daemon.update.response", "")
	if resp["success"] != true || resp["restartRequired"] != true || resp["newVersion"] != "0.20.3" {
		t.Fatalf("unexpected daemon.update.response: %+v", resp)
	}

	body, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "new-binary-0.20.3" {
		t.Fatalf("binary contents = %q, want %q", string(body), "new-binary-0.20.3")
	}

	select {
	case got := <-srv.ControlRequests():
		if !got.Restart || got.Reason != "daemon_update" {
			t.Fatalf("expected restart control request with reason daemon_update, got %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("daemon.update.request did not trigger a restart control request")
	}
}
