package projecticon

import (
	"encoding/binary"
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

// Only the project's top level is scanned outside the priority and package directories, and source
// trees are skipped even inside them (Node's search). Scanning everything picked up fixtures and
// imported assets as the project's icon.
func TestFindScansOnlyTheTopLevelOutsideAssetDirs(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "docs", "logo.png"), "png")
	write(t, filepath.Join(tmp, "public", "src", "favicon.svg"), "<svg/>")
	if got := Find(tmp); got != "" {
		t.Fatalf("found %q outside the searched directories", got)
	}
	write(t, filepath.Join(tmp, "public", "icons", "nested", "favicon.png"), "png")
	if got := Find(tmp); !strings.HasSuffix(got, filepath.Join("public", "icons", "nested", "favicon.png")) {
		t.Fatalf("priority directories are searched three levels deep, got %q", got)
	}
}

// Within one pattern the first name wins, in name order.
func TestFindTakesTheFirstNameForAWildcard(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "favicon-16x16.png"), "png")
	write(t, filepath.Join(tmp, "favicon-32x32.png"), "png")
	if got := Find(tmp); !strings.HasSuffix(got, "favicon-16x16.png") {
		t.Fatalf("got %q", got)
	}
}

func pngBytes(width, height uint32, size int) []byte {
	b := make([]byte, size)
	copy(b, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	binary.BigEndian.PutUint32(b[16:], width)
	binary.BigEndian.PutUint32(b[20:], height)
	return b
}

// Get accepts square images up to 32 KB, typed by their bytes rather than their name.
func TestGetAcceptsSmallSquareIcons(t *testing.T) {
	tmp := t.TempDir()
	write(t, filepath.Join(tmp, "favicon.ico"), string(pngBytes(32, 32, 64)))
	icon := Get(tmp)
	if icon == nil || icon.MimeType != "image/png" {
		t.Fatalf("a PNG named .ico should come back as image/png: %+v", icon)
	}

	wide := t.TempDir()
	write(t, filepath.Join(wide, "logo.png"), string(pngBytes(64, 32, 64)))
	if icon := Get(wide); icon != nil {
		t.Fatalf("a non-square logo is not an icon: %+v", icon)
	}

	large := t.TempDir()
	write(t, filepath.Join(large, "favicon.png"), string(pngBytes(32, 32, 33*1024)))
	if icon := Get(large); icon != nil {
		t.Fatalf("an icon over 32 KB is skipped: %+v", icon)
	}

	svg := t.TempDir()
	write(t, filepath.Join(svg, "icon.svg"), "<svg/>")
	if icon := Get(svg); icon == nil || icon.MimeType != "image/svg+xml" {
		t.Fatalf("an SVG is trusted to be square: %+v", icon)
	}
}

// An ICO container is served as its widest PNG frame.
func TestExtractIcoPngFrame(t *testing.T) {
	small := pngBytes(16, 16, 32)
	big := pngBytes(48, 48, 40)
	header := make([]byte, 6+2*16)
	binary.LittleEndian.PutUint16(header[2:], 1)
	binary.LittleEndian.PutUint16(header[4:], 2)
	offset := len(header)
	for i, frame := range [][]byte{small, big} {
		entry := header[6+i*16:]
		entry[0] = byte(16 + 32*i)
		binary.LittleEndian.PutUint32(entry[8:], uint32(len(frame)))
		binary.LittleEndian.PutUint32(entry[12:], uint32(offset))
		offset += len(frame)
	}
	ico := append(append(append([]byte{}, header...), small...), big...)
	if got := SniffMimeType(ico); got != "image/x-icon" {
		t.Fatalf("sniffed %q", got)
	}
	frame := ExtractIcoPngFrame(ico)
	if w, h, ok := ImageDimensions(frame, "image/png"); !ok || w != 48 || h != 48 {
		t.Fatalf("expected the 48px frame, got %dx%d %v", w, h, ok)
	}
}
