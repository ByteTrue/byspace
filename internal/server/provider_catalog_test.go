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
	first := srv.providerCatalogOrBuild(ctx, "")
	if first == nil || len(first.entries) == 0 {
		t.Fatalf("expected a populated catalog, got %#v", first)
	}
	second := srv.providerCatalogOrBuild(ctx, "")
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

	srv.storeProviderCatalog("", &providerCatalog{entries: []map[string]any{{"provider": "one"}}, hash: "psh_one"})
	srv.storeProviderCatalog("", &providerCatalog{entries: []map[string]any{{"provider": "two"}}, hash: "psh_two"})
	cached := srv.cachedProviderCatalog("")
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

// A workspace catalog is its own scope. The same provider can look available in one checkout and
// unavailable in another, and a host-wide refresh must not answer a workspace read — the app keys
// its cached snapshot by cwd for exactly this reason.
func TestProviderCatalogScopesByCwd(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	project := t.TempDir()
	srv.storeProviderCatalog("", &providerCatalog{entries: []map[string]any{{"provider": "host"}}, hash: "psh_host"})
	srv.storeProviderCatalog(project, &providerCatalog{entries: []map[string]any{{"provider": "project"}}, hash: "psh_project"})

	if cached := srv.cachedProviderCatalog(""); cached == nil || cached.hash != "psh_host" {
		t.Fatalf("host scope was overwritten: %#v", cached)
	}
	if cached := srv.cachedProviderCatalog(project); cached == nil || cached.hash != "psh_project" {
		t.Fatalf("project scope missing: %#v", cached)
	}

	// Dropping one scope leaves the other alone, so a narrowed refresh cannot invalidate the rest.
	srv.storeProviderCatalog(project, nil)
	if cached := srv.cachedProviderCatalog(project); cached != nil {
		t.Fatalf("project scope survived a drop: %#v", cached)
	}
	if cached := srv.cachedProviderCatalog(""); cached == nil || cached.hash != "psh_host" {
		t.Fatalf("dropping the project scope also cleared the host one: %#v", cached)
	}
}

// Builds overlap whenever a providers edit lands during one. The build that started first must not
// win by finishing last: it was probed from the config before the edit, and caching and
// broadcasting it put back a provider list without the provider just added (an e2e caught the
// added provider's row vanishing half a second after it appeared).
func TestProviderCatalogDropsBuildsOvertakenByNewerOnes(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	// The startup prebuild runs in the background; let it land so it cannot race this test.
	srv.providerCatalogOrBuild(context.Background(), "")

	older := srv.beginProviderCatalogBuild()
	newer := srv.beginProviderCatalogBuild()
	if !srv.commitProviderCatalog("", newer, &providerCatalog{hash: "psh_newer"}) {
		t.Fatal("the newest build was rejected")
	}
	if srv.commitProviderCatalog("", older, &providerCatalog{hash: "psh_older"}) {
		t.Fatal("a build that finished after a newer one replaced it")
	}
	if cached := srv.cachedProviderCatalog(""); cached == nil || cached.hash != "psh_newer" {
		t.Fatalf("expected the newer catalog to stay cached, got %#v", cached)
	}

	// Scopes are independent: a workspace build is not stale because of a host one.
	project := t.TempDir()
	if !srv.commitProviderCatalog(project, older, &providerCatalog{hash: "psh_project"}) {
		t.Fatal("a workspace build was rejected because of a newer host build")
	}

	// A providers edit makes every running build stale, even one that would be the newest.
	running := srv.beginProviderCatalogBuild()
	srv.invalidateProviderCatalogs()
	if srv.commitProviderCatalog("", running, &providerCatalog{hash: "psh_before_edit"}) {
		t.Fatal("a build started before a providers edit was cached after it")
	}
	if !srv.commitProviderCatalog("", srv.beginProviderCatalogBuild(), &providerCatalog{hash: "psh_after_edit"}) {
		t.Fatal("a build started after the edit was rejected")
	}
}
