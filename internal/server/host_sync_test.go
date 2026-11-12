package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/hostsync"
)

type hostSyncReply struct {
	RequestID string            `json:"requestId"`
	Records   []hostsync.Record `json:"records"`
	Error     string            `json:"error"`
}

// lastHostSyncReply finds the exchange response the dispatcher sent, whatever envelope wraps it.
func lastHostSyncReply(t *testing.T, sink *recordingSink) hostSyncReply {
	t.Helper()
	sink.mu.Lock()
	defer sink.mu.Unlock()
	for i := len(sink.texts) - 1; i >= 0; i-- {
		text := sink.texts[i]
		if !strings.Contains(text, "hosts.sync.exchange.response") {
			continue
		}
		var found *hostSyncReply
		var walk func(v any)
		walk = func(v any) {
			m, ok := v.(map[string]any)
			if !ok || found != nil {
				return
			}
			if _, has := m["records"]; has {
				b, _ := json.Marshal(m)
				var r hostSyncReply
				_ = json.Unmarshal(b, &r)
				found = &r
				return
			}
			for _, child := range m {
				walk(child)
			}
		}
		var root any
		if err := json.Unmarshal([]byte(text), &root); err != nil {
			t.Fatalf("response is not JSON: %v", err)
		}
		walk(root)
		if found == nil {
			t.Fatalf("no payload in %s", text)
		}
		return *found
	}
	t.Fatal("no hosts.sync.exchange.response was sent")
	return hostSyncReply{}
}

func exchange(t *testing.T, srv *Server, body map[string]any) hostSyncReply {
	t.Helper()
	body["type"] = "hosts.sync.exchange.request"
	body["requestId"] = "req-1"
	raw, _ := json.Marshal(body)
	sink := &recordingSink{}
	srv.handleSessionMessage(context.Background(), sink, raw)
	return lastHostSyncReply(t, sink)
}

// A client edits on one daemon, carries the result to a second daemon, and both end up with the
// same record stamped by the first daemon. This is the whole sync path for a client that moves
// between daemons.
func TestHostSyncExchangeCarriesEditsBetweenDaemons(t *testing.T) {
	laptop := newTestServer(t, t.TempDir())
	vps := newTestServer(t, t.TempDir())

	fromLaptop := exchange(t, laptop, map[string]any{
		"changes": []map[string]any{{"kind": "host", "id": "srv_nas", "data": map[string]any{"label": "NAS"}}},
	})
	if fromLaptop.Error != "" || len(fromLaptop.Records) != 1 {
		t.Fatalf("laptop reply = %+v", fromLaptop)
	}
	if fromLaptop.Records[0].Author != laptop.ServerID() {
		t.Fatalf("author = %q, want the daemon that stamped it (%q)", fromLaptop.Records[0].Author, laptop.ServerID())
	}

	fromVPS := exchange(t, vps, map[string]any{"records": fromLaptop.Records})
	if fromVPS.Error != "" || len(fromVPS.Records) != 1 || fromVPS.Records[0].Author != laptop.ServerID() {
		t.Fatalf("vps reply = %+v", fromVPS)
	}
}

// The daemon refuses to store credentials and says why, instead of dropping the request.
func TestHostSyncExchangeRejectsCredentials(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	reply := exchange(t, srv, map[string]any{
		"changes": []map[string]any{{"kind": "host", "id": "srv_x", "data": map[string]any{"password": "p"}}},
	})
	if !strings.Contains(reply.Error, "credentials") || len(reply.Records) != 0 {
		t.Fatalf("reply = %+v, want a credentials error and no records", reply)
	}
}

func TestServerInfoAdvertisesHostSync(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	b, err := json.Marshal(srv.buildServerInfoPayload())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"hostSync":true`) {
		t.Fatalf("server_info does not advertise hostSync: %s", b)
	}
}
