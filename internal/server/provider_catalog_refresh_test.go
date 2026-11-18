package server

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

// A workspace may answer immediately from the host catalog, but it still needs its own background
// probe: Pi can discover a different model list in that checkout.
func TestProviderCatalogHostFallbackStartsWorkspaceBuild(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFakePiScript(t, tmp)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	firstHost := srv.providerCatalogOrBuild("")
	deadline := time.Now().Add(10 * time.Second)
	for srv.cachedProviderCatalog("") == firstHost && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	host := &providerCatalog{hash: "psh_host"}
	srv.storeProviderCatalog("", host)
	project := t.TempDir()
	if got := srv.providerCatalogOrBuild(project); got != host {
		t.Fatalf("workspace cold read did not use the host fast path: %#v", got)
	}
	for srv.cachedProviderCatalog(project) == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if srv.cachedProviderCatalog(project) == nil {
		t.Fatal("workspace read reused the host catalog without starting its own build")
	}
}

// The settings sheet refreshes the host scope while the composer reads a workspace scope. A host
// refresh must invalidate every workspace copy or a reload keeps answering from the old catalog.
func TestProviderSettingsRefreshInvalidatesWorkspaceCatalogs(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFakePiScript(t, tmp)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	project := t.TempDir()
	srv.storeProviderCatalog("", &providerCatalog{hash: "psh_old_host"})
	srv.storeProviderCatalog(project, &providerCatalog{hash: "psh_old_project"})
	raw, _ := json.Marshal(map[string]any{
		"type":      "refresh_providers_snapshot_request",
		"requestId": "refresh-settings",
		"providers": []string{"pi"},
	})
	srv.handleSessionMessage(context.Background(), &recordingSink{}, raw)

	if cached := srv.cachedProviderCatalog(project); cached != nil {
		t.Fatalf("settings refresh kept the stale workspace catalog: %#v", cached)
	}
	if cached := srv.cachedProviderCatalog(""); cached == nil || cached.hash == "psh_old_host" {
		t.Fatalf("settings refresh did not rebuild the host catalog: %#v", cached)
	}
}
