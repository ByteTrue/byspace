package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// An empty file is size 0, and the protocol requires the number on a ready version and on a
// written result. With omitempty the field vanished: subscribing to an empty file and saving an
// emptied file both failed client validation.
func TestEmptyFileVersionAndWriteCarrySize(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "empty.md"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	version, _ := json.Marshal(StatFileVersion(root, "empty.md"))
	if !strings.Contains(string(version), `"status":"ready"`) || !strings.Contains(string(version), `"size":0`) {
		t.Fatalf("version = %s", version)
	}

	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("text"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(WriteFile(root, "note.md", "", "", ""))
	if !strings.Contains(string(result), `"status":"written"`) || !strings.Contains(string(result), `"size":0`) {
		t.Fatalf("write result = %s", result)
	}
}
