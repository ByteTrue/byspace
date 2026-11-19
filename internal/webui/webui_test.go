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

	// 4. Connection hint + local credential only injected on direct loopback requests
	loopbackHandler := NewFSHandler(mockFS).
		WithConnectionHint("BySpace").
		WithLocalCredential("local-cli-token-123")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6777/", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	loopbackHandler.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"listen":"127.0.0.1:6777"`) || !strings.Contains(rec.Body.String(), `"password":"local-cli-token-123"`) {
		t.Fatalf("expected direct loopback request to receive credential in connection hint, got %q", rec.Body.String())
	}

	// Non-loopback remote address must NOT receive the local credential
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://192.168.1.50:6777/", nil)
	req.RemoteAddr = "192.168.1.99:54321"
	loopbackHandler.ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), `"password"`) || strings.Contains(rec.Body.String(), "local-cli-token-123") {
		t.Fatalf("non-loopback request must never receive local credential, got %q", rec.Body.String())
	}

	// Reverse-proxied request on loopback (X-Forwarded-For or non-loopback Host) must NOT receive the local credential
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6777/", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	loopbackHandler.ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), `"password"`) || strings.Contains(rec.Body.String(), "local-cli-token-123") {
		t.Fatalf("proxied request must never receive local credential, got %q", rec.Body.String())
	}
}
