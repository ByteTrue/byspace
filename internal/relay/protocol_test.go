package relay

import (
	"net/url"
	"strings"
	"testing"
)

// TestRoomKeySeparatesServers guards the invariant the Workers host depends on:
// one Durable Object per key.
func TestRoomKeySeparatesServers(t *testing.T) {
	conn, problem := NewConnection(url.Values{"serverId": {"srv_1"}, "role": {"client"}, "v": {"2"}})
	if problem != "" {
		t.Fatalf("connection rejected: %s", problem)
	}
	if got, want := conn.RoomKey(), "relay:srv_1"; got != want {
		t.Fatalf("room key = %q, want %q", got, want)
	}

	other, _ := NewConnection(url.Values{"serverId": {"srv_2"}, "role": {"client"}, "v": {"2"}})
	if other.RoomKey() == conn.RoomKey() {
		t.Fatalf("two servers share room key %q", conn.RoomKey())
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
		{"version", url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"9"}}, "Invalid v parameter (expected 2)"},
		{"legacy version", url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"1"}}, "Invalid v parameter (expected 2)"},
		{"missing version", url.Values{"serverId": {"s"}, "role": {"client"}}, "Invalid v parameter (expected 2)"},
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

// TestNewConnectionGeneratesClientID checks the client id the caller tags the
// socket with — the routing tag is built from it.
func TestNewConnectionGeneratesClientID(t *testing.T) {
	conn, problem := NewConnection(url.Values{"serverId": {"s"}, "role": {"client"}, "v": {"2"}})
	if problem != "" {
		t.Fatalf("connection rejected: %s", problem)
	}
	if !strings.HasPrefix(conn.ConnectionID(), "conn_") {
		t.Fatalf("connection id = %q, want conn_ prefix", conn.ConnectionID())
	}
}
