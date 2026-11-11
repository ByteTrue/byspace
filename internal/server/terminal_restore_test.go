package server

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/ByteTrue/byspace/internal/terminal"
)

// A restored terminal is listed by `list_terminals`, so it must also be reachable through
// `terminalSlotsByID`; otherwise its tab shows up after a daemon restart and every click answers
// "Terminal not found" until the user creates a new tab.
//
// The create-after-restore part is the other half: restore used to allocate from slot 1 while
// create used len(s.terminals), so the first new tab silently replaced the last restored shell.
func TestRestoredTerminalsKeepTheirSlotMapping(t *testing.T) {
	homeDir := t.TempDir()
	cwd := t.TempDir()
	sessions := []terminal.PersistedTerminalSession{{
		ID:   "term_restored",
		Cwd:  cwd,
		Name: "restored",
	}}
	payload, err := json.Marshal(sessions)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(terminal.TerminalSessionsFile(homeDir), payload, 0o600); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: homeDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	srv.mu.Lock()
	restored, ok := srv.terminalSlotsByID["term_restored"]
	restoredSession := srv.terminals[restored]
	srv.mu.Unlock()
	if !ok || restoredSession == nil || restoredSession.ID != "term_restored" {
		t.Fatalf("restored terminal is not registered: slot=%d ok=%v session=%v", restored, ok, restoredSession)
	}

	// The same insertion path every create handler uses must not reuse the restored slot.
	created, err := terminal.StartSession(terminal.StartOptions{
		ID:   "term_created",
		Cwd:  cwd,
		Rows: 10,
		Cols: 40,
	})
	if err != nil {
		t.Fatal(err)
	}
	createdSlot := srv.registerTerminalSession(created)
	if createdSlot == restored {
		t.Fatalf("created terminal reused the restored slot %d", restored)
	}

	srv.mu.Lock()
	restoredAfter := srv.terminals[restored]
	createdAfter := srv.terminals[createdSlot]
	all := make(map[string]uint8, len(srv.terminals))
	for slot, session := range srv.terminals {
		if session != nil {
			all[session.ID] = slot
		}
	}
	slotsByID := make(map[string]uint8, len(srv.terminalSlotsByID))
	for id, slot := range srv.terminalSlotsByID {
		slotsByID[id] = slot
	}
	srv.mu.Unlock()

	if restoredAfter == nil || restoredAfter.ID != "term_restored" {
		t.Fatalf("restored terminal was overwritten by the new one: %v", restoredAfter)
	}
	if createdAfter == nil || createdAfter.ID != "term_created" {
		t.Fatalf("created terminal is not at slot %d: %v", createdSlot, createdAfter)
	}
	// Every terminal the list can return must resolve through the same map the subscribe, input
	// and kill handlers use.
	for id, slot := range all {
		if got, registered := slotsByID[id]; !registered || got != slot {
			t.Fatalf("terminal %q at slot %d is missing from terminalSlotsByID (got %d, %v)", id, slot, got, registered)
		}
	}
}
