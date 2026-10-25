package relay

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// TestRoomKeySeparatesVersions guards the invariant the Workers host depends on:
// one Durable Object per key. v1 has no connection ids and forwards to every peer
// with the opposite role, so two versions sharing a room would cross-talk.
func TestRoomKeySeparatesVersions(t *testing.T) {
	v1, problem := NewConnection(url.Values{"serverId": {"srv_1"}, "role": {"client"}, "v": {"1"}})
	if problem != "" {
		t.Fatalf("v1 connection rejected: %s", problem)
	}
	v2, problem := NewConnection(url.Values{"serverId": {"srv_1"}, "role": {"client"}, "v": {"2"}})
	if problem != "" {
		t.Fatalf("v2 connection rejected: %s", problem)
	}
	if v1.RoomKey() == v2.RoomKey() {
		t.Fatalf("v1 and v2 share room key %q", v1.RoomKey())
	}
	if got, want := v2.RoomKey(), "relay-v2:srv_1"; got != want {
		t.Fatalf("room key = %q, want %q", got, want)
	}

	other, _ := NewConnection(url.Values{"serverId": {"srv_2"}, "role": {"client"}, "v": {"2"}})
	if other.RoomKey() == v2.RoomKey() {
		t.Fatalf("two servers share room key %q", v2.RoomKey())
	}
}

// TestNewConnectionRejectsBadQuery keeps the Worker's 400 bodies byte-identical
// to the TypeScript worker's, since they are user-visible.
func TestNewConnectionRejectsBadQuery(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
		want  string
	}{
		{"role", url.Values{"serverId": {"s"}, "role": {"relay"}}, "Missing or invalid role parameter"},
		{"serverId", url.Values{"role": {"client"}, "v": {"2"}}, "Missing serverId parameter"},
		{"version", url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"9"}}, "Invalid v parameter (expected 1 or 2)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, problem := NewConnection(tc.query)
			if problem != tc.want {
				t.Fatalf("problem = %q, want %q", problem, tc.want)
			}
		})
	}
}

// TestNewConnectionGeneratesClientID checks the v2 client id the caller tags the
// socket with — the routing tag is built from it.
func TestNewConnectionGeneratesClientID(t *testing.T) {
	conn, problem := NewConnection(url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"2"}})
	if problem != "" {
		t.Fatalf("connection rejected: %s", problem)
	}
	if !strings.HasPrefix(conn.ConnectionID(), "conn_") {
		t.Fatalf("connection id = %q, want conn_ prefix", conn.ConnectionID())
	}

	// v1 has no connection ids at all; routing is by role.
	legacy, _ := NewConnection(url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"1"}})
	if legacy.ConnectionID() != "" {
		t.Fatalf("v1 connection id = %q, want empty", legacy.ConnectionID())
	}
	if got, want := strings.Join(legacy.Tags(), ","), "client"; got != want {
		t.Fatalf("v1 tags = %q, want %q", got, want)
	}
}

// fakePeer records what the router asked it to do.
type fakePeer struct {
	id   string
	tags []string

	mu       sync.Mutex
	closed   bool
	closeMsg string
	sent     [][]byte
}

func (p *fakePeer) Send(_ context.Context, _ MessageType, data []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sent = append(p.sent, append([]byte(nil), data...))
	return nil
}

func (p *fakePeer) Close(_ StatusCode, reason string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.closeMsg = reason
}

func (p *fakePeer) ConnectionID() string { return p.id }

type fakeRoom struct{ peers []Peer }

func (r *fakeRoom) Peers(tag string) []Peer {
	var out []Peer
	for _, peer := range r.peers {
		switch p := peer.(type) {
		case *fakePeer:
			for _, candidate := range p.tags {
				if candidate == tag {
					out = append(out, p)
					break
				}
			}
		}
	}
	return out
}

// TestV1FrameBroadcastsToTheOppositeRole is the behaviour that makes version
// isolation mandatory: a v1 client frame has no destination id.
func TestV1FrameBroadcastsToTheOppositeRole(t *testing.T) {
	client, _ := NewConnection(url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"1"}})
	daemon, _ := NewConnection(url.Values{"serverId": {"s"}, "role": {"server"}, "v": {"1"}})

	clientPeer := &fakePeer{tags: client.Tags()}
	daemonPeer := &fakePeer{tags: daemon.Tags()}
	room := &fakeRoom{peers: []Peer{clientPeer, daemonPeer}}

	Router{}.Message(context.Background(), room, NewFrameBuffer(), clientPeer, client, MessageText, []byte("hello"))

	daemonPeer.mu.Lock()
	defer daemonPeer.mu.Unlock()
	if len(daemonPeer.sent) != 1 || string(daemonPeer.sent[0]) != "hello" {
		t.Fatalf("daemon frames = %q, want [hello]", daemonPeer.sent)
	}
	clientPeer.mu.Lock()
	defer clientPeer.mu.Unlock()
	if len(clientPeer.sent) != 0 {
		t.Fatalf("v1 frame was mirrored back to the sender: %q", clientPeer.sent)
	}
}
