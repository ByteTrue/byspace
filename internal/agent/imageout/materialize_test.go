package imageout

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Providers return generated images as a base64 blob; the conversation renders an image by
// path, so without materialising it the model's image output is invisible.
func TestMaterializeWritesDecodableFile(t *testing.T) {
	home := t.TempDir()
	payload := []byte("\x89PNG\r\n\x1a\nfake-image-bytes")
	path, err := Materialize(home, base64.StdEncoding.EncodeToString(payload), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, ".png") {
		t.Fatalf("path = %q", path)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("bytes differ: %q", got)
	}
	// The directory and file are private: generated images can contain anything the model saw.
	// Windows has no POSIX permission bits; the assertion only means something where it does.
	if runtime.GOOS != "windows" {
		if info, err := os.Stat(path); err != nil || info.Mode().Perm() != fileMode {
			t.Fatalf("file mode = %v", info.Mode().Perm())
		}
		if info, err := os.Stat(filepath.Dir(path)); err != nil || info.Mode().Perm() != privateDirMode {
			t.Fatalf("dir mode = %v", info.Mode().Perm())
		}
	}
}

// Materialising the same image twice reuses the file instead of leaving a fresh copy each time —
// otherwise replaying a conversation with images grows the directory on every replay.
func TestMaterializeIsIdempotent(t *testing.T) {
	home := t.TempDir()
	payload := base64.StdEncoding.EncodeToString([]byte("same bytes"))
	first, err := Materialize(home, payload, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Materialize(home, payload, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("different paths: %q vs %q", first, second)
	}
	entries, _ := os.ReadDir(filepath.Join(home, AttachmentDirName))
	if len(entries) != 1 {
		t.Fatalf("expected one file, got %d", len(entries))
	}
}

// A data: URL carries its own mime type, which wins over the caller's.
func TestMaterializeAcceptsDataURL(t *testing.T) {
	home := t.TempDir()
	body := base64.StdEncoding.EncodeToString([]byte("gif-bytes"))
	path, err := Materialize(home, "data:image/gif;base64,"+body, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, ".gif") {
		t.Fatalf("path = %q; the data URL's mime type should decide", path)
	}
}

func TestMaterializeRejectsBadInput(t *testing.T) {
	home := t.TempDir()
	if _, err := Materialize(home, "", "image/png"); err == nil {
		t.Fatal("empty data must fail")
	}
	if _, err := Materialize(home, "not-base64!!!", "image/png"); err == nil {
		t.Fatal("invalid base64 must fail")
	}
	if _, err := Materialize("", base64.StdEncoding.EncodeToString([]byte("x")), "image/png"); err == nil {
		t.Fatal("no home directory must fail")
	}
}

// An unknown type still gets written: the bytes are the model's output, and refusing to store
// them loses it entirely.
func TestMaterializeUnknownMimeType(t *testing.T) {
	home := t.TempDir()
	path, err := Materialize(home, base64.StdEncoding.EncodeToString([]byte("x")), "application/octet-stream")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, ".bin") {
		t.Fatalf("path = %q", path)
	}
}

func TestExtensionFor(t *testing.T) {
	cases := map[string]string{
		"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
		"IMAGE/GIF": "gif", "image/webp": "webp", "image/svg+xml": "svg",
		"": "bin", "text/plain": "bin",
	}
	for mime, want := range cases {
		if got := extensionFor(mime); got != want {
			t.Fatalf("extensionFor(%q) = %q, want %q", mime, got, want)
		}
	}
}
