package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// A worktree from someone else's PR must refuse setup: its byspace.json is that author's code.
func TestSetupBlockedForUntrustedWorkspace(t *testing.T) {
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(work, "setup-ran")
	if err := os.WriteFile(filepath.Join(work, "byspace.json"), []byte(`{"setup":"echo x > setup-ran"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Close() }()

	wsID := store.NewWorkspaceID()
	prj, wsr, err := srv.store.EnsureWorkspaceForCwd(work)
	if err != nil {
		t.Fatal(err)
	}
	_ = prj
	wsr.WorkspaceID = wsID
	wsr.UntrustedSource = &store.UntrustedSource{
		Kind: "change_request", Forge: "github", Number: 5, HeadRepository: "attacker/fork",
	}
	if err := srv.store.UpsertWorkspace(wsr); err != nil {
		t.Fatal(err)
	}

	blocked, reason := srv.automationBlocked(wsID)
	if !blocked {
		t.Fatal("expected the workspace to be blocked")
	}
	if reason == "" {
		t.Fatal("expected an explanation naming the change request")
	}

	// runWorkspaceSetup must not execute the command, and must record "blocked".
	srv.runWorkspaceSetup(wsID, work, "main", []string{"echo x > setup-ran"})
	if _, statErr := os.Stat(marker); statErr == nil {
		t.Fatal("setup ran despite the block")
	}
	srv.mu.Lock()
	snap := srv.setupSnapshots[wsID]
	srv.mu.Unlock()
	if snap == nil || snap.Status != "blocked" {
		t.Fatalf("expected a blocked snapshot, got %+v", snap)
	}
}

// Without the marker the same workspace is allowed.
func TestSetupAllowedForTrustedWorkspace(t *testing.T) {
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Close() }()
	_, wsr, err := srv.store.EnsureWorkspaceForCwd(work)
	if err != nil {
		t.Fatal(err)
	}
	if blocked, _ := srv.automationBlocked(wsr.WorkspaceID); blocked {
		t.Fatal("an ordinary workspace must not be blocked")
	}
}
