package imageout

import (
	"os"
	"strings"
	"testing"
)

// A path or non-data URL is already addressable; re-encoding it would only make the message longer.
func TestRenderAsMarkdownUsesPath(t *testing.T) {
	got, ok := RenderAsMarkdown(ProviderImage{Path: "/tmp/shot.png", AltText: "a screenshot"}, "/home")
	if !ok {
		t.Fatal("no markdown")
	}
	if got != "![a screenshot](/tmp/shot.png)" {
		t.Fatalf("got %q", got)
	}
}

// A data: URL is kept as the source: the client renders it without a round trip.
func TestRenderAsMarkdownKeepsDataURL(t *testing.T) {
	source := "data:image/png;base64,iVBORw0KGgo="
	got, ok := RenderAsMarkdown(ProviderImage{URL: source}, "/home")
	if !ok {
		t.Fatal("no markdown")
	}
	if !strings.Contains(got, source) {
		t.Fatalf("the data URL was altered: %q", got)
	}
}

// Raw base64 is written to disk: an inline data URL for a multi-megabyte image bloats every timeline fetch.
func TestRenderAsMarkdownMaterializesRawBase64(t *testing.T) {
	home := t.TempDir()
	// A 1x1 PNG.
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	got, ok := RenderAsMarkdown(ProviderImage{Data: png, MimeType: "image/png"}, home)
	if !ok {
		t.Fatal("no markdown")
	}
	if !strings.HasPrefix(got, "![Image](") || !strings.Contains(got, "byspace-attachments") {
		t.Fatalf("got %q", got)
	}
	// The file exists where the markdown points.
	start := strings.Index(got, "(")
	end := strings.LastIndex(got, ")")
	path := got[start+1 : end]
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the referenced file does not exist: %v", err)
	}
	if !strings.HasSuffix(path, ".png") {
		t.Fatalf("path = %q", path)
	}
}

// An image with nothing to point at produces no message rather than an empty one.
func TestRenderAsMarkdownEmpty(t *testing.T) {
	for _, image := range []ProviderImage{
		{},
		{Path: "   "},
		{Data: "   ", MimeType: "image/png"},
	} {
		if _, ok := RenderAsMarkdown(image, t.TempDir()); ok {
			t.Fatalf("produced markdown for %+v", image)
		}
	}
}

// A closing bracket in the alt would end it early and corrupt the markdown. An opening one is harmless — the
// renderer escapes exactly what node's does, and escaping `[` as well would show a backslash to the user.
func TestRenderAsMarkdownEscapesAlt(t *testing.T) {
	got, _ := RenderAsMarkdown(ProviderImage{Path: "/tmp/a.png", AltText: "a [weird] name"}, "/home")
	if !strings.Contains(got, `a [weird\] name`) {
		t.Fatalf("got %q", got)
	}
	// A backslash in the alt is doubled so it does not escape the bracket escape.
	got, _ = RenderAsMarkdown(ProviderImage{Path: "/tmp/a.png", AltText: `back\slash`}, "/home")
	if !strings.Contains(got, `back\\slash`) {
		t.Fatalf("got %q", got)
	}
}

// Encoding the slashes too would produce a URL the client cannot resolve against the file route.
func TestEscapeMarkdownSourceKeepsSeparators(t *testing.T) {
	got := escapeMarkdownSource("/tmp/a b/c.png")
	if got != "/tmp/a%20b/c.png" {
		t.Fatalf("got %q", got)
	}
	// A remote URL is left alone.
	if escapeMarkdownSource("https://example.com/a b.png") != "https://example.com/a b.png" {
		t.Fatalf("a remote URL was rewritten")
	}
	// A data URL is already encoded.
	const data = "data:image/png;base64,AAAA"
	if escapeMarkdownSource(data) != data {
		t.Fatal("a data URL was re-encoded")
	}
}
