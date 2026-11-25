package providers

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestACPProviderCatalogReadsNativeModelsAndModes(t *testing.T) {
	config := fakeACPConformanceConfig(t, "models,modes", "")
	env := config["env"].(map[string]any)
	env["BYSPACE_ACP_FAKE_NO_BROWSER_FILE"] = filepath.Join(t.TempDir(), "no-browser")
	cwd := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	catalog, err := FetchACPProviderCatalog(ctx, "fake", config, cwd)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Models) != 2 || catalog.Models[0].ID != "model-a" || !catalog.Models[0].IsDefault || catalog.Models[1].IsDefault {
		t.Fatalf("unexpected models: %#v", catalog.Models)
	}
	for _, model := range catalog.Models {
		if model.Provider != "fake" || !model.IsSelectable {
			t.Fatalf("model was not made selectable for the custom provider: %#v", model)
		}
	}
	if len(catalog.Modes) != 2 || catalog.Modes[0].ID != "mode-a" || catalog.Modes[1].Label != "Mode B" {
		t.Fatalf("unexpected modes: %#v", catalog.Modes)
	}
	cwdBytes, err := os.ReadFile(env["BYSPACE_ACP_FAKE_CWD_FILE"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(cwdBytes)); got != cwd {
		t.Fatalf("probe cwd = %q, want %q", got, cwd)
	}
	noBrowser, err := os.ReadFile(env["BYSPACE_ACP_FAKE_NO_BROWSER_FILE"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if string(noBrowser) != "true" {
		t.Fatalf("NO_BROWSER = %q, want true", noBrowser)
	}
	if _, err := os.Stat(env["BYSPACE_ACP_FAKE_EXIT_FILE"].(string)); err != nil {
		t.Fatalf("probe process was not closed: %v", err)
	}
}

func TestACPProviderCatalogUsesHomeForGlobalRefresh(t *testing.T) {
	config := fakeACPConformanceConfig(t, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := FetchACPProviderCatalog(ctx, "fake", config, ""); err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	cwdBytes, err := os.ReadFile(config["env"].(map[string]any)["BYSPACE_ACP_FAKE_CWD_FILE"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(cwdBytes)); got != home {
		t.Fatalf("global probe cwd = %q, want home %q", got, home)
	}
}

func TestACPProviderCatalogDeadlineClosesProcess(t *testing.T) {
	config := fakeACPConformanceConfig(t, "", "hang")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := FetchACPProviderCatalog(ctx, "fake", config, t.TempDir())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("probe error = %v, want deadline exceeded", err)
	}
	if _, err := os.Stat(config["env"].(map[string]any)["BYSPACE_ACP_FAKE_EXIT_FILE"].(string)); err != nil {
		t.Fatalf("timed-out probe process was not closed: %v", err)
	}
}
