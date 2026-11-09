package gui

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/server"
)

// freeLoopbackAddr returns a loopback address with a port nothing is listening on.
func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}

// A restart or stop ask for the in-process daemon has to reach the app.
//
// The server cannot restart itself, and an ask nobody answered is exactly what left the app's
// restart button doing nothing at all.
func TestSupervisorForwardsControlRequestsToTheApp(t *testing.T) {
	sup := &DaemonSupervisor{
		Addr:          freeLoopbackAddr(t),
		HomeDir:       filepath.Join(t.TempDir(), "home"),
		Version:       "0.0.0-test",
		WatchInterval: time.Hour,
	}
	got := make(chan server.ControlRequest, 1)
	sup.SetControlHandler(func(req server.ControlRequest) { got <- req })
	if err := sup.Start(); err != nil {
		t.Fatal(err)
	}
	defer sup.Close()
	if !sup.OwnsInProcessDaemon() {
		t.Fatal("expected the supervisor to serve the daemon in-process")
	}
	sup.mu.Lock()
	addr := sup.Addr
	sup.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws://"+addr+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"gui_control","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	frame, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "restart_server_request",
			"requestId": "req_gui_restart",
			"reason":    "settings_daemon_restart",
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatal(err)
	}
	select {
	case req := <-got:
		if !req.Restart || req.Reason != "settings_daemon_restart" {
			t.Fatalf("the app was handed %+v", req)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the restart ask never reached the app")
	}
}
