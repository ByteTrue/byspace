package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func TestProviderAddACPValidatesCanonicalInput(t *testing.T) {
	t.Setenv("BYSPACE_HOME", t.TempDir())
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "missing kind", want: "usage:"},
		{name: "invalid ID", args: []string{"acp", "--id", "Agy", "--label", "Antigravity", "--", "agy", "acp"}, want: "invalid provider ID"},
		{name: "built-in ID", args: []string{"acp", "--id", "pi", "--label", "Pi", "--", "pi"}, want: "built in"},
		{name: "empty label", args: []string{"acp", "--id", "agy", "--label", " ", "--", "agy", "acp"}, want: "label cannot be empty"},
		{name: "empty argv", args: []string{"acp", "--id", "agy", "--label", "Antigravity", "--"}, want: "argv cannot be empty"},
		{name: "empty argument", args: []string{"acp", "--id", "agy", "--label", "Antigravity", "--", "agy", ""}, want: "empty arguments"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stdout bytes.Buffer
			err := runProviderAddCmd(tt.args, &stdout)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want substring %q", err, tt.want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout = %q, want no success output", stdout.String())
			}
		})
	}
	if _, err := os.Stat(filepath.Join(os.Getenv("BYSPACE_HOME"), "config.json")); !os.IsNotExist(err) {
		t.Fatalf("invalid input wrote config.json: %v", err)
	}
}

func TestProviderAddACPPersistsExactEntryAndIsIdempotent(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	st := store.New(homeDir)
	if _, err := st.SaveDaemonConfigChecked(map[string]any{
		"appendSystemPrompt": "keep me",
		"providers": map[string]any{
			"other": map[string]any{"extends": "acp", "label": "Other", "command": []any{"other-acp"}},
		},
	}); err != nil {
		t.Fatal(err)
	}
	args := []string{"add", "acp", "--id", "agy", "--label", "  Antigravity  ", "--", "agy", "acp"}
	var stdout bytes.Buffer
	if err := runProviderGroupCmd(args, &stdout); err != nil {
		t.Fatal(err)
	}
	if stdout.String() != "added provider agy\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	configPath := filepath.Join(homeDir, "config.json")
	first, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var disk map[string]any
	if err := json.Unmarshal(first, &disk); err != nil {
		t.Fatal(err)
	}
	agents := disk["agents"].(map[string]any)
	providerEntries := agents["providers"].(map[string]any)
	want := map[string]any{"extends": "acp", "label": "Antigravity", "command": []any{"agy", "acp"}}
	if !reflect.DeepEqual(providerEntries["agy"], want) {
		t.Fatalf("agy = %#v, want %#v", providerEntries["agy"], want)
	}
	if providerEntries["other"] == nil || disk["daemon"].(map[string]any)["appendSystemPrompt"] != "keep me" {
		t.Fatalf("unrelated settings were not preserved: %s", first)
	}

	stdout.Reset()
	if err := runProviderGroupCmd(args, &stdout); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) || stdout.String() != "provider agy unchanged\n" {
		t.Fatalf("identical rerun changed config or output: before=%s after=%s stdout=%q", first, second, stdout.String())
	}
}

func TestProviderAddACPRejectsConflictingEntryWithoutWriting(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	st := store.New(homeDir)
	if _, err := st.SaveDaemonConfigChecked(map[string]any{
		"providers": map[string]any{"agy": map[string]any{"extends": "acp", "label": "Mine", "command": []any{"custom-agy"}}},
	}); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(homeDir, "config.json")
	before, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	err = runProviderGroupCmd([]string{"add", "acp", "--id", "agy", "--label", "Antigravity", "--", "agy", "acp"}, &stdout)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("error = %v", err)
	}
	after, readErr := os.ReadFile(configPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !bytes.Equal(before, after) || stdout.Len() != 0 {
		t.Fatalf("conflict changed config or printed success: before=%s after=%s stdout=%q", before, after, stdout.String())
	}
}
