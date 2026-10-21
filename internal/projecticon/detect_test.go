package projecticon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A web project keeps its icon under public/; that must win over a stray logo deeper in the tree.
func TestFindPrefersPriorityDirs(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "public", "favicon.svg"), "<svg/>")
	write(t, filepath.Join(tmp, "src", "deep", "logo.png"), "png")

	got := Find(tmp)
	if !strings.HasSuffix(got, filepath.Join("public", "favicon.svg")) {
		t.Fatalf("got %q, want the public favicon", got)
	}
}

// Asking the user to upload an icon for a repo that already ships one is busywork.
func TestFindRootIcon(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "icon.png"), "png")
	if got := Find(tmp); !strings.HasSuffix(got, "icon.png") {
		t.Fatalf("got %q", got)
	}
}

// node_modules must never be descended into: it makes the scan slow and can surface a
// dependency's icon as the project's.
func TestFindIgnoresNodeModules(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "node_modules", "somepkg", "favicon.svg"), "<svg/>")
	if got := Find(tmp); got != "" {
		t.Fatalf("found an icon inside node_modules: %q", got)
	}

	// A real icon next to node_modules is still found.
	write(t, filepath.Join(tmp, "favicon.svg"), "<svg/>")
	if got := Find(tmp); !strings.HasSuffix(got, "favicon.svg") {
		t.Fatalf("got %q", got)
	}
}

// In a monorepo the app's icon is the project's icon.
func TestFindMonorepoPackageIcon(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "packages", "app", "public", "favicon.svg"), "<svg/>")
	got := Find(tmp)
	if !strings.Contains(got, filepath.Join("packages", "app")) {
		t.Fatalf("got %q, want the package icon", got)
	}
}

// An .svg must beat an .ico of the same name: it scales.
func TestFindPrefersSVGOverICO(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "favicon.svg"), "<svg/>")
	write(t, filepath.Join(tmp, "favicon.ico"), "ico")
	if got := Find(tmp); !strings.HasSuffix(got, "favicon.svg") {
		t.Fatalf("got %q", got)
	}
}

// A wildcard pattern must not match everything.
func TestFindNoIcon(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "readme.md"), "hi")
	if got := Find(tmp); got != "" {
		t.Fatalf("expected no icon, got %q", got)
	}
}

func TestMimeTypeFor(t *testing.T) {
	cases := map[string]string{
		"favicon.svg": "image/svg+xml",
		"icon.PNG":    "image/png",
		"favicon.ico": "image/x-icon",
		"x.jpg":       "image/jpeg",
		"x.txt":       "",
	}
	for path, want := range cases {
		if got := MimeTypeFor(path); got != want {
			t.Fatalf("MimeTypeFor(%q) = %q, want %q", path, got, want)
		}
	}
}
