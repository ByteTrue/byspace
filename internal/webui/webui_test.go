package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestWebUIHandlerRoutingAndCompression(t *testing.T) {
	mockFS := fstest.MapFS{
		"index.html":                      {Data: []byte("<html>app</html>")},
		"assets/main-0123456789abcdef.js": {Data: []byte("console.log(1)")},
		"assets/main-0123456789abcdef.js.br": {
			Data: []byte("brotli-bytes"),
		},
	}

	h := NewFSHandler(mockFS)
	if h == nil {
		t.Fatal("expected non-nil handler")
	}

	// 1. Excluded path should not be served
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	if h.TryServe(rec, req) {
		t.Fatal("expected /api/health to be excluded")
	}

	// 2. SPA fallback -> index.html with no-store
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/workspaces/123", nil)
	if !h.TryServe(rec, req) {
		t.Fatal("expected SPA route to be served")
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "<html>app</html>" {
		t.Fatalf("unexpected SPA response: %d %q", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("expected no-store on index.html, got %q", rec.Header().Get("Cache-Control"))
	}

	// 3. Hashed asset with precompressed brotli
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/assets/main-0123456789abcdef.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	if !h.TryServe(rec, req) {
		t.Fatal("expected hashed asset to be served")
	}
	if rec.Header().Get("Content-Encoding") != "br" {
		t.Fatalf("expected br encoding, got %q", rec.Header().Get("Content-Encoding"))
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("expected immutable cache header, got %q", rec.Header().Get("Cache-Control"))
	}
	if rec.Body.String() != "brotli-bytes" {
		t.Fatalf("unexpected body: %q", rec.Body.String())
	}

	// 4. Explicit connection hint + WithoutPrecompression for Wails in-process asset serving
	wailsHandler := NewFSHandler(mockFS).
		WithoutPrecompression().
		WithExplicitConnectionHint("127.0.0.1:6777", "BySpace")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "https://wails.localhost/", nil)
	wailsHandler.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"listen":"127.0.0.1:6777"`) || !strings.Contains(rec.Body.String(), `"useTls":false`) {
		t.Fatalf("expected explicit loopback connection hint, got %q", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "https://wails.localhost/assets/main-0123456789abcdef.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	wailsHandler.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "" {
		t.Fatalf("expected uncompressed asset for Wails scheme handler, got Content-Encoding=%q", rec.Header().Get("Content-Encoding"))
	}
	if rec.Body.String() != "console.log(1)" {
		t.Fatalf("expected raw js body, got %q", rec.Body.String())
	}
}
