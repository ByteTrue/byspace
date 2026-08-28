package daemon

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalCatalogIsStableAcrossEquivalentPaths(t *testing.T) {
	root := t.TempDir()
	alias := filepath.Join(t.TempDir(), "project-link")
	if err := os.Symlink(root, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	first, err := newLocalCatalog(root, filepath.Join(t.TempDir(), "missing-pi"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := newLocalCatalog(alias, filepath.Join(t.TempDir(), "missing-pi"))
	if err != nil {
		t.Fatal(err)
	}
	if first.project["projectId"] != second.project["projectId"] {
		t.Fatalf("project IDs differ: %v != %v", first.project["projectId"], second.project["projectId"])
	}
	if first.workspace["id"] != second.workspace["id"] {
		t.Fatalf("workspace IDs differ: %v != %v", first.workspace["id"], second.workspace["id"])
	}
	if got := first.provider["status"]; got != "unavailable" {
		t.Fatalf("provider status = %v", got)
	}
	if got := first.workspace["projectKind"]; got != "directory" {
		t.Fatalf("project kind = %v", got)
	}
}

func TestLocalCatalogRejectsNonDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newLocalCatalog(path, "pi"); err == nil {
		t.Fatal("non-directory workspace root was accepted")
	}
}
