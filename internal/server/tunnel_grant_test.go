package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestTunnelGrantRecordsAndReplies(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	raw, _ := json.Marshal(map[string]any{
		"type":      "tunnel.grant.request",
		"requestId": "g1",
		"publicKey": "pk_source",
		"port":      3425,
	})
	sink := &recordingSink{}
	srv.handleSessionMessage(context.Background(), sink, raw)

	sink.mu.Lock()
	defer sink.mu.Unlock()
	joined := strings.Join(sink.texts, "\n")
	if !strings.Contains(joined, "tunnel.grant.response") {
		t.Fatalf("no grant response: %s", joined)
	}
	if !srv.tunnelGrants().Allowed("pk_source", 3425) {
		t.Fatal("grant was not recorded")
	}
}
