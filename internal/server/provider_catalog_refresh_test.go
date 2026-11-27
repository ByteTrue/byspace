package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// A workspace may answer immediately from the host catalog, but it still needs its own background
// probe: Pi can discover a different model list in that checkout.
func TestProviderCatalogHostFallbackStartsWorkspaceBuild(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeCwdCatalogFakePi(t, tmp)})
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
	catalog := srv.cachedProviderCatalog(project)
	if catalog == nil {
		t.Fatal("workspace read reused the host catalog without starting its own build")
	}
	wantModel := "anthropic/" + filepath.Base(project)
	for _, entry := range catalog.entries {
		if entry["provider"] != "pi" {
			continue
		}
		models := entry["models"].([]sdk.CatalogModel)
		if len(models) != 1 || models[0].ID != wantModel {
			t.Fatalf("workspace probe reused another cwd's Pi models: got %#v, want %q", models, wantModel)
		}
		return
	}
	t.Fatal("workspace catalog has no Pi entry")
}

func writeCwdCatalogFakePi(t *testing.T, dir string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	path := filepath.Join(dir, "cwd-catalog-pi.sh")
	script := `#!/bin/sh
model_id="$(basename "$PWD")"
while read line; do
  req_id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  [ -z "$req_id" ] && req_id="req_1"
  case "$line" in
    *'"type":"get_state"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"sess_fake_1\",\"sessionFile\":\"$0.jsonl\",\"thinkingLevel\":\"medium\",\"isStreaming\":false,\"isCompacting\":false,\"messageCount\":0,\"pendingMessageCount\":0}}"
      ;;
    *'"type":"get_available_models"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_available_models\",\"success\":true,\"data\":{\"models\":[{\"provider\":\"anthropic\",\"id\":\"$model_id\",\"name\":\"$model_id\"}]}}"
      ;;
    *'"type":"get_commands"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_commands\",\"success\":true,\"data\":{\"commands\":[]}}"
      ;;
  esac
done
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProviderCatalogRetriesBuildInvalidatedWhileProbing(t *testing.T) {
	tmp := t.TempDir()
	project := t.TempDir()
	piCommand, started, release := writeBlockingCwdCatalogFakePi(t, tmp, project)
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: piCommand})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	firstHost := srv.providerCatalogOrBuild("")
	deadline := time.Now().Add(10 * time.Second)
	for srv.cachedProviderCatalog("") == firstHost && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	host := srv.cachedProviderCatalog("")
	if host == firstHost {
		t.Fatal("host probe did not finish")
	}
	if got := srv.providerCatalogOrBuild(project); got != host {
		t.Fatal("workspace cold read did not use the host catalog")
	}
	probeDeadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(started); err == nil {
			break
		}
		if time.Now().After(probeDeadline) {
			t.Fatal("workspace probe did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// A home refresh invalidates W1 and publishes a fresh host catalog. The client's workspace
	// refetch arrives while W1 still owns the build marker.
	srv.invalidateProviderCatalogs()
	refreshedHost := &providerCatalog{hash: "psh_refreshed_host"}
	srv.storeProviderCatalog("", refreshedHost)
	if got := srv.providerCatalogOrBuild(project); got != refreshedHost {
		t.Fatal("workspace refetch did not use the refreshed host catalog")
	}
	if err := os.WriteFile(release, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	retryDeadline := time.Now().Add(10 * time.Second)
	for srv.cachedProviderCatalog(project) == nil && time.Now().Before(retryDeadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if srv.cachedProviderCatalog(project) == nil {
		t.Fatal("invalidated workspace build was dropped without a replacement")
	}
}

func writeBlockingCwdCatalogFakePi(t *testing.T, dir, project string) (string, string, string) {
	t.Helper()
	inner := writeCwdCatalogFakePi(t, dir)
	started := filepath.Join(dir, "workspace-probe-started")
	release := filepath.Join(dir, "workspace-probe-release")
	path := filepath.Join(dir, "blocking-cwd-catalog-pi.sh")
	script := fmt.Sprintf(`#!/bin/sh
if [ "$(basename "$PWD")" = %q ] && [ ! -f %q ]; then
  : > %q
  while [ ! -f %q ]; do sleep 0.01; done
fi
exec %q "$@"
`, filepath.Base(project), release, started, release, inner)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path, started, release
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
