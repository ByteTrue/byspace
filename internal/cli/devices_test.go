package cli

import (
	"bytes"
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/server"
)

// devicesAgainst runs the command against a daemon this test started, dialing its WebSocket directly.
func devicesAgainst(t *testing.T, srv *server.Server, args ...string) string {
	t.Helper()
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	prev := dialDevicesWS
	dialDevicesWS = func(ctx context.Context, _ string) (*websocket.Conn, error) {
		conn, _, err := websocket.Dial(ctx, wsURL, nil)
		return conn, err
	}
	t.Cleanup(func() { dialDevicesWS = prev })

	var out, errOut bytes.Buffer
	code := Main("test", append([]string{"devices"}, args...), &out, &errOut)
	if code != 0 {
		t.Fatalf("byspace devices %s failed (%d): %s", strings.Join(args, " "), code, errOut.String())
	}
	return out.String()
}

func TestDevicesAddListAndRemove(t *testing.T) {
	srv, err := server.New(server.Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	if out := devicesAgainst(t, srv, "list"); !strings.Contains(out, "no devices") {
		t.Fatalf("empty chain listed %q", out)
	}

	added := devicesAgainst(t, srv, "add", "--public-key", "pk_b", "srv_b")
	if !strings.Contains(added, "added srv_b") {
		t.Fatalf("add output = %q", added)
	}

	listed := devicesAgainst(t, srv, "list")
	if !strings.Contains(listed, "srv_b") || !strings.Contains(listed, "pk_b") {
		t.Fatalf("list output = %q, want the member and its key", listed)
	}

	removed := devicesAgainst(t, srv, "remove", "srv_b")
	if !strings.Contains(removed, "removed srv_b") {
		t.Fatalf("remove output = %q", removed)
	}
	if out := devicesAgainst(t, srv, "list"); !strings.Contains(out, "no devices") {
		t.Fatalf("removed member still listed: %q", out)
	}
}

func TestDevicesAddRequiresAPublicKey(t *testing.T) {
	var out, errOut bytes.Buffer
	code := Main("test", []string{"devices", "add", "srv_b"}, &out, &errOut)
	if code == 0 {
		t.Fatal("devices add without a public key succeeded")
	}
	if !strings.Contains(errOut.String(), "public-key") {
		t.Fatalf("error = %q, want it to name the missing flag", errOut.String())
	}
}
