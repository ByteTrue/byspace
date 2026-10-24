package agenthooks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// installInto prepares a provider whose config lives in a temp dir.
func installInto(t *testing.T, providerID string, existing string) (Provider, string) {
	t.Helper()
	dir := t.TempDir()
	provider, ok := Find(providerID)
	if !ok {
		t.Fatalf("unknown provider %q", providerID)
	}
	originalFile := provider.ConfigFile
	path := filepath.Join(dir, filepath.FromSlash(originalFile))
	if existing != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(existing), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Point ConfigPath at the temp dir: ConfigDir becomes the temp dir itself and ConfigFile the
	// basename, so ConfigPath joins them into the path we prepared.
	provider.ConfigDir = dir
	provider.ConfigDirEnv = ""
	provider.ConfigFile = originalFile
	return provider, path
}

// A user may have their own hooks in the same file. Overwriting the file silently deletes their
// work, so install merges and uninstall filters by marker.
func TestInstallPreservesUserHooks(t *testing.T) {
	existing := `{
  "hooks": {
    "Stop": [
      {"matcher": "", "hooks": [{"type": "command", "command": "echo user-hook"}]}
    ]
  },
  "otherSetting": true
}`
	provider, path := installInto(t, "claude", existing)

	if err := Install(provider); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "user-hook") {
		t.Fatal("the user's hook was deleted")
	}
	if !strings.Contains(text, "otherSetting") {
		t.Fatal("an unrelated setting was deleted")
	}
	if !strings.Contains(text, "hooks claude Stop") {
		t.Fatalf("our hook is missing: %s", text)
	}

	// Uninstall removes only ours.
	if err := Uninstall(provider); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(path)
	after := string(raw)
	if !strings.Contains(after, "user-hook") {
		t.Fatal("uninstall removed the user's hook")
	}
	if strings.Contains(after, "hooks claude") {
		t.Fatalf("our hook survived uninstall: %s", after)
	}
}

// Installing twice must not produce two entries: the hook would report twice per event.
func TestInstallIsIdempotent(t *testing.T) {
	provider, path := installInto(t, "codex", "")
	for i := 0; i < 3; i++ {
		if err := Install(provider); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	hooks := config["hooks"].(map[string]any)
	entries := hooks["Stop"].([]any)
	if len(entries) != 1 {
		t.Fatalf("%d entries for Stop after three installs", len(entries))
	}
}

// A malformed settings file is reported rather than replaced: silently overwriting it would
// destroy whatever the user was editing.
func TestInstallRefusesMalformedConfig(t *testing.T) {
	provider, path := installInto(t, "claude", "{not json")
	if err := Install(provider); err == nil {
		t.Fatal("a malformed config must be reported")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "{not json" {
		t.Fatal("the malformed file was overwritten")
	}
}

// Removing every hook must not leave an empty array behind: it reads as a configured but broken
// list.
func TestUninstallRemovesEmptyEventLists(t *testing.T) {
	provider, path := installInto(t, "claude", "")
	if err := Install(provider); err != nil {
		t.Fatal(err)
	}
	if err := Uninstall(provider); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if _, present := config["hooks"]; present {
		t.Fatalf("hooks key survived with nothing in it: %s", raw)
	}
}

// Same filename can be the user's own plugin; overwriting it deletes their code.
func TestPluginFileRefusesForeignFile(t *testing.T) {
	provider, path := installInto(t, "opencode", "export default function mine() {}\n")
	if err := Install(provider); err == nil {
		t.Fatal("a foreign plugin file must not be overwritten")
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "mine") {
		t.Fatal("the user's plugin was overwritten")
	}
}

func TestPluginFileInstallAndUninstall(t *testing.T) {
	provider, path := installInto(t, "opencode", "")
	if err := Install(provider); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), openCodePluginMarker) {
		t.Fatal("the plugin lacks its owner marker")
	}
	// The queue is what keeps an older busy report from landing after idle.
	if !strings.Contains(string(raw), "chain") {
		t.Fatal("the plugin does not serialise its reports")
	}

	if err := Uninstall(provider); err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatal("uninstall left the plugin behind")
	}
}

// The hook runs only inside a BySpace terminal: otherwise every agent event outside BySpace spawns
// a process that then has nothing to report.
func TestShellCommandIsGuarded(t *testing.T) {
	command := ShellCommand("claude", "Stop")
	if !strings.Contains(command, "BYSPACE_TERMINAL_ID") {
		t.Fatalf("not guarded: %s", command)
	}
	if !strings.Contains(command, "hooks claude Stop") {
		t.Fatalf("wrong event: %s", command)
	}
	if !strings.Contains(command, "BYSPACE_HOOK_CLI") {
		t.Fatalf("the CLI path is not overridable: %s", command)
	}
}

// Every provider's events must be ones the shim understands, or installing them runs a command
// that reports nothing.
func TestProvidersCoverTheShimEvents(t *testing.T) {
	want := map[string]int{"claude": 5, "codex": 5, "opencode": 5}
	for _, provider := range Providers {
		expected, ok := want[provider.ID]
		if !ok {
			t.Fatalf("unexpected provider %q", provider.ID)
		}
		if len(provider.Events) != expected {
			t.Fatalf("%s has %d events, want %d", provider.ID, len(provider.Events), expected)
		}
	}
}
