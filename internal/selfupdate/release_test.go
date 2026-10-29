package selfupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSemverNewerAndReleased(t *testing.T) {
	if Released("dev") || Released("0.21.2-3-gabcdef") || Released("0.21.2-dirty") {
		t.Fatal("source/dev versions must not be reported as Released")
	}
	if !Released("0.21.2") || !Released("v0.22.0-beta.1") {
		t.Fatal("valid release versions must be reported as Released")
	}
	if !Newer("0.22.0", "0.21.9") {
		t.Fatal("0.22.0 > 0.21.9")
	}
	if !Newer("0.22.0", "0.22.0-beta.2") {
		t.Fatal("stable > prerelease of same version")
	}
	if !Newer("0.22.0-beta.10", "0.22.0-beta.2") {
		t.Fatal("numeric prerelease identifiers must compare numerically")
	}
	if Newer("0.21.2", "0.21.2") {
		t.Fatal("equal versions are not newer")
	}
}

func TestStageAndInstallBinaryVerifiesSHA256AndRejectsTamperedPayload(t *testing.T) {
	payload := []byte("#!/bin/sh\necho new-byspace\n")
	sum := sha256.Sum256(payload)
	sumHex := hex.EncodeToString(sum[:])
	assetName := BinaryAsset()

	var tamper bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/feed":
			_ = json.NewEncoder(w).Encode(Release{
				Version: "0.99.0",
				URL:     "https://github.com/ByteTrue/byspace/releases/tag/v0.99.0",
				Assets: map[string]Asset{
					assetName: {
						URL:    "http://" + r.Host + "/download/" + assetName,
						Size:   int64(len(payload)),
						SHA256: sumHex,
					},
				},
			})
		case "/download/" + assetName:
			if tamper {
				_, _ = w.Write([]byte("corrupted-by-mirror"))
				return
			}
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	t.Setenv("BYSPACE_UPDATE_FEED", srv.URL+"/feed")

	rel, err := Latest(context.Background())
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if rel.Version != "0.99.0" {
		t.Fatalf("rel.Version = %q, want 0.99.0", rel.Version)
	}

	dir := t.TempDir()
	exe := filepath.Join(dir, "byspace")
	if err := os.WriteFile(exe, []byte("old-byspace"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Tampered download must fail SHA-256 verification and leave old binary intact.
	tamper = true
	if _, err := StageBinary(context.Background(), rel, exe); err == nil || !strings.Contains(err.Error(), "SHA-256 mismatch") {
		t.Fatalf("expected SHA-256 mismatch error, got %v", err)
	}

	// 2. Authentic download stages and installs cleanly.
	tamper = false
	staged, err := StageBinary(context.Background(), rel, exe)
	if err != nil {
		t.Fatalf("StageBinary: %v", err)
	}
	if err := InstallBinary(staged, exe); err != nil {
		t.Fatalf("InstallBinary: %v", err)
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("installed binary = %q, want %q", got, payload)
	}
}

func TestBundleOfDetectsMacAppBundle(t *testing.T) {
	p := "/Applications/BySpace.app/Contents/MacOS/byspace"
	if got := BundleOf(p); got != "/Applications/BySpace.app" {
		t.Fatalf("BundleOf(%q) = %q, want /Applications/BySpace.app", p, got)
	}
	if got := BundleOf("/usr/local/bin/byspace"); got != "" {
		t.Fatalf("BundleOf(/usr/local/bin/byspace) = %q, want empty", got)
	}
}
