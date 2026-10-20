package pi

import (
	"os"
	"strings"
	"testing"
)

// The extension is the only route to pi's entry capture and tree navigation, so rewind and
// message-id mapping depend on this file being written and loadable.
func TestWriteIntegrationExtension(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension()
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	body, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("extension not written: %v", readErr)
	}
	source := string(body)
	for _, want := range []string{
		"byspace_tree",
		"byspace_capture",
		EntryCaptureMarker,
		CommandResultMarker,
		"navigateTree",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("extension is missing %q", want)
		}
	}

	// cleanup must remove the temp directory so a long-lived daemon does not leak one per agent.
	cleanup()
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("cleanup did not remove %s", path)
	}
}

// BYSPACE_PI_EXTENSION_PATH lets an operator point at a patched bridge; it must win over the
// generated one.
func TestWriteIntegrationExtensionHonoursOverride(t *testing.T) {
	dir := t.TempDir()
	override := dir + "/custom.mjs"
	if err := os.WriteFile(override, []byte("export default () => {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BYSPACE_PI_EXTENSION_PATH", override)

	path, cleanup, err := WriteIntegrationExtension()
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if path != override {
		t.Fatalf("override ignored: got %q", path)
	}
}
