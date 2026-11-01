package store

import (
	"encoding/base64"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func squarePNG(side uint32, size int) []byte {
	b := make([]byte, size)
	copy(b, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	binary.BigEndian.PutUint32(b[16:], side)
	binary.BigEndian.PutUint32(b[20:], side)
	return b
}

func newIconStore(t *testing.T) (*Store, ProjectRecord) {
	t.Helper()
	st := New(t.TempDir())
	project, _, err := st.CreateWorkspaceForDirectory(t.TempDir(), "icons", "")
	if err != nil {
		t.Fatal(err)
	}
	return st, project
}

// A custom icon gets a revision, which is what tells clients it is custom (the edit sheet's "Use
// automatic") and that their cached icon is stale.
func TestSetProjectCustomIconRecordsARevision(t *testing.T) {
	st, project := newIconStore(t)
	before := st.ProjectIconSnapshot(project)
	if before.Icon != nil || before.Revision != "automatic:none:v1" {
		t.Fatalf("a project without an icon: %+v", before)
	}

	data := base64.StdEncoding.EncodeToString(squarePNG(64, 128))
	updated, err := st.SetProjectCustomIcon(project.ProjectID, false, data)
	if err != nil {
		t.Fatal(err)
	}
	if updated.CustomIconRevision == nil || *updated.CustomIconRevision == "" {
		t.Fatalf("no revision recorded: %+v", updated)
	}
	custom := st.ProjectIconSnapshot(updated)
	if custom.Icon == nil || custom.Icon.MimeType != "image/png" || custom.Icon.Data != data || !strings.HasPrefix(custom.Revision, "custom:") {
		t.Fatalf("custom snapshot %+v", custom)
	}

	again, err := st.SetProjectCustomIcon(project.ProjectID, false, data)
	if err != nil || *again.CustomIconRevision == *updated.CustomIconRevision {
		t.Fatalf("every save is a new revision: %v %v", again.CustomIconRevision, err)
	}
	if st.ProjectIconSnapshot(again).Revision != custom.Revision {
		t.Fatal("the snapshot revision names the bytes, so the same bytes keep it")
	}

	automatic, err := st.SetProjectCustomIcon(project.ProjectID, true, "")
	if err != nil || automatic.CustomIconRevision != nil {
		t.Fatalf("automatic clears the revision: %+v %v", automatic, err)
	}
	if _, err := os.Stat(st.customIconPath(project.ProjectID)); !os.IsNotExist(err) {
		t.Fatalf("automatic removes the stored bytes: %v", err)
	}
}

func TestSetProjectCustomIconValidatesTheBytes(t *testing.T) {
	st, project := newIconStore(t)
	cases := []struct {
		name string
		data string
		want string
	}{
		{"empty", "", customIconTooLarge},
		{"too large", base64.StdEncoding.EncodeToString(squarePNG(64, maxCustomIconBytes+1)), customIconTooLarge},
		{"not an image", base64.StdEncoding.EncodeToString([]byte("hello world")), customIconBadFormat},
		{"not base64", "%%%", customIconBadFormat},
		{"not square", base64.StdEncoding.EncodeToString(func() []byte {
			b := squarePNG(64, 64)
			binary.BigEndian.PutUint32(b[20:], 32)
			return b
		}()), customIconNotSquare},
		{"over 1024px", base64.StdEncoding.EncodeToString(squarePNG(2048, 64)), customIconNotSquare},
	}
	for _, tc := range cases {
		if _, err := st.SetProjectCustomIcon(project.ProjectID, false, tc.data); err == nil || err.Error() != tc.want {
			t.Fatalf("%s: got %v, want %q", tc.name, err, tc.want)
		}
	}
	if _, err := st.SetProjectCustomIcon("prj_missing", true, ""); err != ErrProjectNotFound {
		t.Fatalf("unknown project: %v", err)
	}
}

// Without a custom icon the snapshot is the icon the repository ships.
func TestProjectIconSnapshotFindsTheShippedIcon(t *testing.T) {
	st, project := newIconStore(t)
	if err := os.MkdirAll(filepath.Join(project.RootPath, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project.RootPath, "public", "favicon.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	snapshot := st.ProjectIconSnapshot(project)
	if snapshot.Icon == nil || snapshot.Icon.MimeType != "image/svg+xml" || !strings.HasPrefix(snapshot.Revision, "automatic:") || snapshot.Revision == "automatic:none:v1" {
		t.Fatalf("shipped icon snapshot %+v", snapshot)
	}
	// A custom icon whose bytes went missing is its own cacheable result, not the shipped icon.
	revision := "rev-1"
	project.CustomIconRevision = &revision
	if missing := st.ProjectIconSnapshot(project); missing.Icon != nil || missing.Revision != "custom:none:rev-1" {
		t.Fatalf("missing custom icon %+v", missing)
	}
}
