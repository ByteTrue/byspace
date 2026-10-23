package server

import (
	"context"
	"path/filepath"
	"testing"
)

// The snapshot has to be a read, not a probe. Building one runs every provider CLI, and a client
// that waited for that probe could submit a new-workspace form while the selected provider was
// still unknown — the form then failed with "Select a model" even though the catalog was one round
// trip away.
func TestProviderCatalogServesRepeatRequestsFromCache(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ctx := context.Background()
	first := srv.providerCatalogOrBuild(ctx)
	if first == nil || len(first.entries) == 0 {
		t.Fatalf("expected a populated catalog, got %#v", first)
	}
	second := srv.providerCatalogOrBuild(ctx)
	if second != first {
		t.Fatalf("second request rebuilt the catalog instead of reading the cache")
	}
	if second.hash == "" {
		t.Fatalf("catalog hash is empty")
	}
}

// A rebuild must be able to replace the cached catalog, otherwise a providers edit would never
// reach a client that asks for the snapshot again.
func TestStoreProviderCatalogReplacesCachedValue(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	srv.storeProviderCatalog(&providerCatalog{entries: []map[string]any{{"provider": "one"}}, hash: "psh_one"})
	srv.storeProviderCatalog(&providerCatalog{entries: []map[string]any{{"provider": "two"}}, hash: "psh_two"})
	cached := srv.cachedProviderCatalog()
	if cached == nil || cached.hash != "psh_two" {
		t.Fatalf("expected the newest catalog to win, got %#v", cached)
	}
}

// notModified must still carry the hash, because the client keeps its cached body and needs to
// know which catalog the daemon considers current.
func TestProviderCatalogPayloadNotModifiedKeepsHash(t *testing.T) {
	catalog := &providerCatalog{
		entries:     []map[string]any{{"provider": "mock"}},
		hash:        "psh_abc",
		fetchedAt:   map[string]string{"mock": "2024-01-01T00:00:00Z"},
		generatedAt: "2024-01-01T00:00:01Z",
		compact:     map[string]any{},
	}
	payload := catalog.payload("req_1", "", true)
	if payload["notModified"] != true {
		t.Fatalf("expected notModified, got %#v", payload["notModified"])
	}
	if payload["snapshotHash"] != "psh_abc" {
		t.Fatalf("notModified dropped the hash: %#v", payload["snapshotHash"])
	}
	if entries, ok := payload["entries"].([]any); !ok || len(entries) != 0 {
		t.Fatalf("notModified must send an empty entries array, got %#v", payload["entries"])
	}
	if _, present := payload["cwd"]; present {
		t.Fatalf("cwd must be omitted when empty, not sent as null")
	}

	full := catalog.payload("req_2", "/tmp/project", false)
	if full["cwd"] != "/tmp/project" {
		t.Fatalf("expected cwd in the payload, got %#v", full["cwd"])
	}
	if full["snapshotHash"] != "psh_abc" || full["entries"] == nil {
		t.Fatalf("full payload lost catalog fields: %#v", full)
	}
}
