package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

// A close mid-turn must release every waiter. Without this a `wait_for_finish` blocks until its
// own timeout even though the agent is already gone.
func TestClosedSessionReleasesWaiters(t *testing.T) {
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rec := store.AgentRecord{
		ID: "agt_wait", Cwd: work, Provider: "pi", LastStatus: "idle",
		CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	mp, err := srv.ensureAgentLoaded("agt_wait")
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		done <- mp.session.WaitForFinish(ctx)
	}()
	time.Sleep(100 * time.Millisecond)

	// Closing must return the waiter promptly, not after its 5s timeout.
	_ = mp.session.Close()
	select {
	case <-done:
		// Released.
	case <-time.After(2 * time.Second):
		t.Fatal("waiter was not released by close")
	}
}
