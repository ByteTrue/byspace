package daemon

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebAssetsServeIndexFilesAndSPAFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "_expo", "static"), 0o700); err != nil {
		t.Fatal(err)
	}
	originalIndex := "<!doctype html><html><head><title>byspace</title></head><body>app</body></html>"
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(originalIndex), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "_expo", "static", "app.js"), []byte("asset"), 0o600); err != nil {
		t.Fatal(err)
	}
	assets, err := openWebAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	defer assets.Close()
	server := httptest.NewServer(assets)
	defer server.Close()

	for _, requestPath := range []string{"/", "/h/srv_test/workspace/ws_test"} {
		response, err := http.Get(server.URL + requestPath)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status = %d", requestPath, response.StatusCode)
		}
		if !strings.Contains(string(body), initialDaemonConnectionScript) {
			t.Fatalf("GET %s did not inject initial daemon hint", requestPath)
		}
		if got := response.Header.Get("Cache-Control"); got != "no-store" {
			t.Fatalf("GET %s cache control = %q", requestPath, got)
		}
	}

	response, err := http.Get(server.URL + "/_expo/static/app.js")
	if err != nil {
		t.Fatal(err)
	}
	body, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(body) != "asset" {
		t.Fatalf("asset body = %q", body)
	}
	if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache control = %q", got)
	}

	request, err := http.NewRequest(http.MethodHead, server.URL+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, readErr = io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(body) != 0 || response.StatusCode != http.StatusOK {
		t.Fatalf("HEAD / status = %d, body = %q", response.StatusCode, body)
	}

	onDisk, err := os.ReadFile(filepath.Join(root, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != originalIndex {
		t.Fatal("daemon modified exported index.html")
	}
}

func TestWebAssetsDoNotEscapeRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html><head></head><body>app</body></html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	assets, err := openWebAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	defer assets.Close()

	recorder := httptest.NewRecorder()
	assets.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://localhost/escape", nil))
	if strings.Contains(recorder.Body.String(), "outside-secret") {
		t.Fatal("served a symlink target outside the Web root")
	}

	recorder = httptest.NewRecorder()
	assets.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "http://localhost/", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d", recorder.Code)
	}
}

func TestOpenWebAssetsRequiresIndex(t *testing.T) {
	if _, err := openWebAssets(t.TempDir()); err == nil {
		t.Fatal("Web root without index.html was accepted")
	}
}
