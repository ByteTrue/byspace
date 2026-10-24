package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// An already-imported session must not appear in the picker again: the row would fail or silently
// duplicate when clicked, and the count tells the user the list is filtered rather than short.
func TestImportedProviderHandles(t *testing.T) {
	srv := newTunnelTestServer(t, nil)

	// Nothing imported yet.
	handles, err := srv.importedProviderHandles()
	if err != nil {
		t.Fatal(err)
	}
	if len(handles) != 0 {
		t.Fatalf("handles = %v", handles)
	}

	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_imported", Provider: "pi", Cwd: "/tmp", LastStatus: "idle",
		Persistence: &store.AgentPersistenceHandle{Provider: "pi", SessionID: "/sessions/abc.jsonl"},
	}); err != nil {
		t.Fatal(err)
	}

	handles, err = srv.importedProviderHandles()
	if err != nil {
		t.Fatal(err)
	}
	if !handles["pi:/sessions/abc.jsonl"] {
		t.Fatalf("an imported session is not recorded: %v", handles)
	}
}
