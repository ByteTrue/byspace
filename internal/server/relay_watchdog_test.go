package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// TestRelayControlChannelSurvivesASilentRelay pins the watchdog's liveness signal.
//
// The control channel sends one `sync` when the daemon joins and then nothing until a device
// connects. A watchdog that measures liveness by inbound messages therefore declares a healthy
// relay dead on its own timer and reconnects forever: `relay: <host> unreachable (attempt 1):
// failed to get reader: use of closed network connection`, once per backoff round, with no
// device ever able to connect. The pong is the only thing that keeps arriving, so it has to be
// what the watchdog trusts.
func TestRelayControlChannelSurvivesASilentRelay(t *testing.T) {
	previousInterval, previousTimeout := relayPingInterval, relayPingTimeout
	relayPingInterval, relayPingTimeout = 40*time.Millisecond, 200*time.Millisecond
	t.Cleanup(func() {
		relayPingInterval, relayPingTimeout = previousInterval, previousTimeout
	})

	// The relay behaves like the real one: it greets the daemon with a single sync and then stays
	// silent. Protocol pings are answered by the WebSocket layer, not by the relay's own code.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		// Read everything so the library keeps processing control frames (a pong is only
		// delivered to the socket when something is reading).
		go func() {
			for {
				if _, _, err := conn.Read(r.Context()); err != nil {
					return
				}
			}
		}()
		_ = conn.Write(r.Context(), websocket.MessageText, []byte(`{"type":"sync","connectionIds":[]}`))
		<-r.Context().Done()
	}))
	defer server.Close()

	srv := &Server{serverID: "srv_watchdog"}
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	done := make(chan error, 1)
	go func() { done <- srv.ConnectRelay(ctx, url) }()

	// The handler runs for the whole window: a watchdog that closes the socket on staleness
	// returns early with a read error.
	select {
	case err := <-done:
		if err != nil && !strings.Contains(err.Error(), "context deadline") {
			t.Fatalf("the control channel was torn down while the relay was healthy: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ConnectRelay did not return after the context deadline")
	}
}
