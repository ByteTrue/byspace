package server

import (
	"encoding/json"
	"testing"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// `fs.file.update` carries a FileVersion union, not a bare revision string. Sending the string made every update fail
// protocol validation, so a file pane never learned its file changed on disk — the "changed on disk" callout and its
// reload/overwrite actions were unreachable.
func TestFileUpdateVersionShape(t *testing.T) {
	encoded, err := json.Marshal(workspace.FileVersion{
		Status: "ready", Cwd: "/repo", Path: "a.txt", Size: 3, ModifiedAt: "2026-01-01T00:00:00Z", Revision: "r1",
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["status"] != "ready" {
		t.Fatalf("status = %v", decoded["status"])
	}
	for _, key := range []string{"cwd", "path", "size", "modifiedAt", "revision"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("%s missing from %s", key, encoded)
		}
	}
}

// A file that disappeared has to produce an update too: otherwise the pane keeps showing a document that no longer
// exists and the user's next save silently recreates it.
func TestStatFileVersionReportsMissing(t *testing.T) {
	version := workspace.StatFileVersion(t.TempDir(), "gone.txt")
	if version.Status != "missing" {
		t.Fatalf("status = %q", version.Status)
	}
	if version.Path == "" || version.Cwd == "" {
		t.Fatalf("version = %+v", version)
	}
}
