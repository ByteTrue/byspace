package providers

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os/exec"
	"sync"
	"testing"
	"time"
)

// fakeServer starts an HTTP server and returns its URL.
func fakeServer(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("[]"))
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return "http://" + listener.Addr().String()
}

// A server the user already runs is adopted rather than duplicated.
func TestAcquireExisting(t *testing.T) {
	url := fakeServer(t)
	pool := NewOpenCodePool(t.TempDir(), "opencode", nil)
	if server := pool.AcquireExisting(url); server == nil || server.URL != url {
		t.Fatalf("adopt = %+v", server)
	}
	// A dead URL is not adopted.
	if server := pool.AcquireExisting("http://127.0.0.1:1"); server != nil {
		t.Fatalf("a dead server was adopted: %+v", server)
	}
	if server := pool.AcquireExisting(""); server != nil {
		t.Fatal("an empty url was adopted")
	}
}

// Two agents created at once must not spawn two servers.
func TestAcquireDeduplicatesConcurrentStarts(t *testing.T) {
	pool := NewOpenCodePool(t.TempDir(), "opencode", nil)
	var starts int
	var mu sync.Mutex

	pool.startProcess = func(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
		mu.Lock()
		starts++
		mu.Unlock()
		// A process that will never be waited on; the test only counts launches.
		return &exec.Cmd{}, nil
	}
	pool.allocPort = func() (int, error) { return 7100, nil }
	pool.probe = func(server *OpenCodeServer) bool { return true }

	if _, err := pool.Acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if starts != 1 {
		t.Fatalf("servers started = %d, want 1 (the second acquire reuses the first)", starts)
	}
}

// A server that never answers must fail rather than be handed out: its URL produces "connection refused"
// from a code path that looks like the session is fine.
func TestStartFailsWhenServerDoesNotAnswer(t *testing.T) {
	pool := NewOpenCodePool(t.TempDir(), "opencode", nil)
	pool.startProcess = func(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
		return &exec.Cmd{}, nil
	}
	pool.allocPort = func() (int, error) { return 7101, nil }
	pool.probe = func(server *OpenCodeServer) bool { return false }
	pool.startupTimeout = 200 * time.Millisecond

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := pool.Acquire(ctx); err == nil {
		t.Fatal("a server that never answers must not be returned")
	}
}

// A launch failure is reported, not swallowed.
func TestStartProcessErrorIsReported(t *testing.T) {
	pool := NewOpenCodePool(t.TempDir(), "opencode", nil)
	pool.startProcess = func(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
		return nil, errors.New("no such binary")
	}
	if _, err := pool.Acquire(context.Background()); err == nil {
		t.Fatal("a launch failure must be returned")
	}
}

// The command line is `opencode serve --port <n>` with the configured args first.
func TestStartBuildsServeCommand(t *testing.T) {
	pool := NewOpenCodePool(t.TempDir(), "opencode", []string{"--verbose"})
	var gotArgs []string
	pool.startProcess = func(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
		gotArgs = append([]string{command}, args...)
		return &exec.Cmd{}, nil
	}
	pool.allocPort = func() (int, error) { return 7102, nil }
	pool.probe = func(server *OpenCodeServer) bool { return true }
	server, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if server.URL != "http://127.0.0.1:7102" {
		t.Fatalf("url = %q", server.URL)
	}
	want := []string{"opencode", "--verbose", "serve", "--port", "7102"}
	if len(gotArgs) != len(want) {
		t.Fatalf("args = %v", gotArgs)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("args = %v, want %v", gotArgs, want)
		}
	}
}
