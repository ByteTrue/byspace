package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

// The name the app shows is the contract: " copy", then " copy 2". A "-copy" suffix looked similar but the
// menu offers nothing the daemon invents, so the two surfaces disagreed about where the new file went.
func TestDuplicateEntryUsesCopySuffix(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src", "file.ts")
	if err := os.MkdirAll(filepath.Dir(src), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("export const a = 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	first, err := DuplicateEntry(root, "src/file.ts")
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if first != "src/file copy.ts" {
		t.Fatalf("first duplicate = %q, want src/file copy.ts", first)
	}

	second, err := DuplicateEntry(root, "src/file.ts")
	if err != nil {
		t.Fatalf("second duplicate: %v", err)
	}
	if second != "src/file copy 2.ts" {
		t.Fatalf("second duplicate = %q, want src/file copy 2.ts", second)
	}

	raw, err := os.ReadFile(filepath.Join(root, first))
	if err != nil {
		t.Fatalf("read duplicate: %v", err)
	}
	if string(raw) != "export const a = 1;\n" {
		t.Fatalf("duplicate content = %q", raw)
	}
}

// Folders are offered by the same menu, so the daemon has to recurse rather than fail on a directory.
func TestDuplicateEntryCopiesDirectoryTree(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "src", "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "a.ts"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "b.ts"), []byte("b\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	duplicate, err := DuplicateEntry(root, "src")
	if err != nil {
		t.Fatalf("duplicate directory: %v", err)
	}
	if duplicate != "src copy" {
		t.Fatalf("duplicate = %q, want src copy", duplicate)
	}

	raw, err := os.ReadFile(filepath.Join(root, "src copy", "nested", "b.ts"))
	if err != nil {
		t.Fatalf("read nested duplicate: %v", err)
	}
	if string(raw) != "b\n" {
		t.Fatalf("nested duplicate content = %q", raw)
	}
}

// Duplicating the root would copy the whole workspace into a child of itself.
func TestDuplicateEntryRejectsWorkspaceRoot(t *testing.T) {
	root := t.TempDir()
	if _, err := DuplicateEntry(root, "."); err == nil {
		t.Fatal("expected an error duplicating the workspace root")
	}
}

// The menu is offered from a diff that can be minutes old; the file may already be gone.
func TestDuplicateEntryReportsMissingSource(t *testing.T) {
	root := t.TempDir()
	_, err := DuplicateEntry(root, "gone.ts")
	if err == nil || err.Error() != "File or folder no longer exists" {
		t.Fatalf("error = %v, want the missing-entry message", err)
	}
}
