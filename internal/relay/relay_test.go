package relay

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestRelayV2ControlAndBufferedDataForwarding(t *testing.T) {
	srv := NewServer(Options{})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	wsBase := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Health endpoint
	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on /health, got %d", resp.StatusCode)
	}

	// 2. Connect server-control
	ctrlWS, _, err := websocket.Dial(ctx, wsBase+"?serverId=srv_test&role=server&v=2", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ctrlWS.CloseNow()

	// Expect initial sync
	_, syncData, err := ctrlWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var syncMsg struct {
		Type          string   `json:"type"`
		ConnectionIDs []string `json:"connectionIds"`
	}
	if err := json.Unmarshal(syncData, &syncMsg); err != nil || syncMsg.Type != "sync" {
		t.Fatalf("unexpected sync message: %s", string(syncData))
	}

	// 3. Connect client with explicit connectionId before server-data connects
	cliWS, _, err := websocket.Dial(ctx, wsBase+"?serverId=srv_test&role=client&v=2&connectionId=conn_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cliWS.CloseNow()

	// Expect control notification "connected"
	_, connData, err := ctrlWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var connMsg struct {
		Type         string `json:"type"`
		ConnectionID string `json:"connectionId"`
	}
	if err := json.Unmarshal(connData, &connMsg); err != nil || connMsg.Type != "connected" || connMsg.ConnectionID != "conn_1" {
		t.Fatalf("unexpected control notification: %s", string(connData))
	}

	// Client sends a frame BEFORE server-data connects (should be buffered)
	if err := cliWS.Write(ctx, websocket.MessageText, []byte(`{"type":"e2ee_hello"}`)); err != nil {
		t.Fatal(err)
	}

	// Give relay a moment to buffer the frame
	time.Sleep(30 * time.Millisecond)

	// 4. Connect server-data for conn_1 -> should immediately receive flushed frame
	srvDataWS, _, err := websocket.Dial(ctx, wsBase+"?serverId=srv_test&role=server&v=2&connectionId=conn_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer srvDataWS.CloseNow()

	msgType, flushed, err := srvDataWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if msgType != websocket.MessageText || string(flushed) != `{"type":"e2ee_hello"}` {
		t.Fatalf("expected flushed e2ee_hello, got %v %q", msgType, string(flushed))
	}

	// 5. Server sends binary frame back to client
	binPayload := []byte{0x01, 0x02, 0x03}
	if err := srvDataWS.Write(ctx, websocket.MessageBinary, binPayload); err != nil {
		t.Fatal(err)
	}
	gotType, gotBytes, err := cliWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if gotType != websocket.MessageBinary || string(gotBytes) != string(binPayload) {
		t.Fatalf("unexpected binary frame on client: %v %v", gotType, gotBytes)
	}
}
