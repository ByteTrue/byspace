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
	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog("") != firstHost
	}, "host provider catalog probe")
	host := &providerCatalog{hash: "psh_host"}
	srv.storeProviderCatalog("", host)
	project := t.TempDir()
	if got := srv.providerCatalogOrBuild(project); got != host {
		t.Fatalf("workspace cold read did not use the host fast path: %#v", got)
	}
	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog(project) != nil
	}, "workspace provider catalog probe")
	catalog := srv.cachedProviderCatalog(project)
	wantModel := "anthropic/" + filepath.Base(project)
	for _, entry := range catalog.entries {
		if entry["provider"] != "pi" {
			continue
		}
		models := entry["models"].([]sdk.CatalogModel)
		hasExpectedModel := len(models) == 1 && models[0].ID == wantModel
		if !hasExpectedModel {
			t.Fatalf("workspace probe reused another cwd's Pi models: got %#v, want %q", models, wantModel)
		}
		return
	}
	t.Fatal("workspace catalog has no Pi entry")
}

func TestPiCatalogCacheTracksWorkspaceHostWorkspace(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeCwdCatalogFakePi(t, tmp)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	project := t.TempDir()
	projectModel := "anthropic/" + filepath.Base(project)
	requirePiModel(t, srv, project, projectModel)
	hostCwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	requirePiModel(t, srv, "", "anthropic/"+filepath.Base(hostCwd))
	requirePiModel(t, srv, project, projectModel)
}

func requirePiModel(t *testing.T, srv *Server, cwd, want string) {
	t.Helper()
	models := srv.probePiModelsInCwd(t.Context(), cwd)
	hasExpectedModel := len(models) == 1 && models[0].ID == want
	if !hasExpectedModel {
		t.Fatalf("Pi models for %q = %#v, want only %q", cwd, models, want)
	}
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
	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog("") != firstHost
	}, "host provider catalog probe")
	host := srv.cachedProviderCatalog("")
	if host == firstHost {
		t.Fatal("host probe did not finish")
	}
	if got := srv.providerCatalogOrBuild(project); got != host {
		t.Fatal("workspace cold read did not use the host catalog")
	}
	waitForCondition(t, 10*time.Second, func() bool {
		return hasFile(started)
	}, "workspace probe to start")

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

	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog(project) != nil
	}, "replacement workspace provider catalog")
}

func TestProviderCatalogRetriesWithFreshProbeDeadline(t *testing.T) {
	tmp := t.TempDir()
	project := t.TempDir()
	piCommand, started, _ := writeBlockingCwdCatalogFakePi(t, tmp, project)
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: piCommand})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	firstHost := srv.providerCatalogOrBuild("")
	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog("") != firstHost
	}, "host provider catalog probe")
	srv.providerCatalogProbeTimeout = 50 * time.Millisecond
	host := srv.cachedProviderCatalog("")
	if got := srv.providerCatalogOrBuild(project); got != host {
		t.Fatal("workspace cold read did not use the host catalog")
	}
	waitForCondition(t, 10*time.Second, func() bool {
		return hasFile(started)
	}, "workspace probe to start")

	srv.invalidateProviderCatalogs()
	refreshedHost := &providerCatalog{hash: "psh_refreshed_host"}
	srv.storeProviderCatalog("", refreshedHost)
	if got := srv.providerCatalogOrBuild(project); got != refreshedHost {
		t.Fatal("workspace refetch did not use the refreshed host catalog")
	}
	waitForCondition(t, 10*time.Second, func() bool {
		return hasFile(started + ".retry")
	}, "replacement probe after the first attempt timed out")
	waitForCondition(t, 10*time.Second, func() bool {
		return srv.cachedProviderCatalog(project) != nil
	}, "workspace catalog after the first attempt timed out")
}

func hasFile(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeBlockingCwdCatalogFakePi(t *testing.T, dir, project string) (string, string, string) {
	t.Helper()
	inner := writeCwdCatalogFakePi(t, dir)
	started := filepath.Join(dir, "workspace-probe-started")
	release := filepath.Join(dir, "workspace-probe-release")
	path := filepath.Join(dir, "blocking-cwd-catalog-pi.sh")
	script := fmt.Sprintf(`#!/bin/sh
if [ "$(basename "$PWD")" = %q ]; then
  if [ -f %q ]; then
    : > %q
  else
    : > %q
    while [ ! -f %q ]; do sleep 0.01; done
  fi
fi
exec %q "$@"
`, filepath.Base(project), started, started+".retry", started, release, inner)
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
	cached := srv.cachedProviderCatalog("")
	hasRefreshedHost := cached != nil && cached.hash != "psh_old_host"
	if !hasRefreshedHost {
		t.Fatalf("settings refresh did not rebuild the host catalog: %#v", cached)
	}
}
