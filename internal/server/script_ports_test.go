package server

import (
	"testing"
)

// A dev server needs one stable port per (workspace, script) so its URL keeps working across
// restarts; two workspaces must never receive the same number.
func TestServicePortAllocatorStableAndDistinct(t *testing.T) {
	a := newServicePortAllocator()

	first, err := a.Allocate("wks_1", "dev", 0)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.Allocate("wks_1", "dev", 0)
	if err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Fatalf("allocation must be stable: %d then %d", first, again)
	}

	other, err := a.Allocate("wks_2", "dev", 0)
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Fatalf("two workspaces got the same port %d", first)
	}

	a.Release("wks_1", "dev")
	if _, ok := a.Lookup("wks_1", "dev"); ok {
		t.Fatal("release must drop the assignment")
	}
}

// An explicit port in byspace.json is honoured; asking for one that is taken is an error rather
// than a silent reassignment, so the user learns their config conflicts.
func TestServicePortAllocatorHonoursRequested(t *testing.T) {
	a := newServicePortAllocator()
	assigned, err := a.Allocate("wks_1", "api", 0)
	if err != nil {
		t.Fatal(err)
	}
	// Asking for a port this allocator already handed out must fail: the other script may not
	// have bound it yet, so a bindability check alone would hand out a duplicate.
	got, err := a.Allocate("wks_2", "api", assigned)
	if err == nil {
		t.Fatalf("expected a conflict error when requesting an assigned port, got %d", got)
	}
	// A free explicit port is honoured.
	explicit, err := a.Allocate("wks_3", "web", 0)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.Allocate("wks_4", "web", explicit)
	if err == nil || again != 0 {
		t.Fatalf("expected rejection for an assigned port, got %d err=%v", again, err)
	}
}
