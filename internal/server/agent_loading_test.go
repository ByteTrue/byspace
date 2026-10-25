package server

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// Two requests arriving while an agent is cold must share one provider process. Without the
// in-flight registry both see "not loaded" and each spawns one; the loser's process is orphaned
// and keeps the session file open.
func TestEnsureAgentLoadedDeduplicatesConcurrentLoads(t *testing.T) {
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rec := store.AgentRecord{
		ID: "agt_conc", Cwd: workDir, Provider: "pi",
		LastStatus: "idle",
		CreatedAt:  "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	got := make([]*managedPi, 8)
	for i := range got {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			mp, loadErr := srv.ensureAgentLoaded("agt_conc")
			if loadErr == nil {
				got[idx] = mp
			}
		}(i)
	}
	wg.Wait()

	first := got[0]
	if first == nil {
		t.Fatal("no caller got an agent")
	}
	for _, mp := range got[1:] {
		if mp != nil && mp != first {
			t.Fatal("concurrent loads produced more than one session")
		}
	}
	srv.mu.Lock()
	count := len(srv.agents)
	srv.mu.Unlock()
	if count != 1 {
		t.Fatalf("agents map holds %d sessions, want 1", count)
	}
}

// An archived agent is history. Resuming it would resurrect a conversation the user removed
// and start spending tokens on it again.
func TestEnsureAgentLoadedRejectsArchived(t *testing.T) {
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	archived := "2026-01-01T00:00:00Z"
	rec := store.AgentRecord{
		ID: "agt_arch", Cwd: workDir, Provider: "pi",
		LastStatus: "idle", ArchivedAt: &archived,
		CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	if _, loadErr := srv.ensureAgentLoaded("agt_arch"); loadErr == nil {
		t.Fatal("loading an archived agent must fail")
	}
	srv.mu.Lock()
	count := len(srv.agents)
	srv.mu.Unlock()
	if count != 0 {
		t.Fatalf("an archived agent must not spawn a provider, got %d sessions", count)
	}
}

// A record naming a provider this build does not register must fail with that reason rather
// than an opaque exec error.
func TestEnsureAgentLoadedRejectsUnknownProvider(t *testing.T) {
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rec := store.AgentRecord{
		ID: "agt_unknown", Cwd: workDir, Provider: "not-a-provider",
		LastStatus: "idle",
		CreatedAt:  "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	_, loadErr := srv.ensureAgentLoaded("agt_unknown")
	if loadErr == nil {
		t.Fatal("expected an error for an unknown provider")
	}
	if !strings.Contains(loadErr.Error(), "unavailable provider") {
		t.Fatalf("error should name the provider problem: %v", loadErr)
	}
}
