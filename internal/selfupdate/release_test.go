package selfupdate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestDownloadAssetResumesAcrossDroppedConnection(t *testing.T) {
	oldWaits := retryWaits
	retryWaits = []time.Duration{time.Millisecond, time.Millisecond}
	defer func() { retryWaits = oldWaits }()

	body := bytes.Repeat([]byte("byspace-resume-test-"), 8192)
	sum := sha256.Sum256(body)
	var ranges []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rng := r.Header.Get("Range")
		ranges = append(ranges, rng)
		if len(ranges) == 1 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			_, _ = w.Write(body[:4096])
			if fl, ok := w.(http.Flusher); ok {
				fl.Flush()
			}
			if hj, ok := w.(http.Hijacker); ok {
				if conn, _, err := hj.Hijack(); err == nil {
					_ = conn.Close()
				}
			}
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 4096-%d/%d", len(body)-1, len(body)))
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)-4096))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[4096:])
	}))
	defer srv.Close()

	var lastDone, lastTotal int64
	ctx := WithProgress(context.Background(), func(d, tot int64) {
		lastDone, lastTotal = d, tot
	})
	dest := filepath.Join(t.TempDir(), "byspace.new")
	err := DownloadAsset(ctx, Asset{
		URL:    srv.URL + "/byspace",
		Size:   int64(len(body)),
		SHA256: hex.EncodeToString(sum[:]),
	}, dest)
	if err != nil {
		t.Fatalf("DownloadAsset with resume: %v", err)
	}
	if len(ranges) != 2 || ranges[0] != "" || ranges[1] != "bytes=4096-" {
		t.Fatalf("unexpected Range requests: %v", ranges)
	}
	if lastDone != int64(len(body)) || lastTotal != int64(len(body)) {
		t.Fatalf("progress = %d/%d, want %d/%d", lastDone, lastTotal, len(body), len(body))
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
	p := filepath.FromSlash("/Applications/BySpace.app/Contents/MacOS/byspace")
	want := filepath.FromSlash("/Applications/BySpace.app")
	if got := BundleOf(p); got != want {
		t.Fatalf("BundleOf(%q) = %q, want %s", p, got, want)
	}
	if got := BundleOf("/usr/local/bin/byspace"); got != "" {
		t.Fatalf("BundleOf(/usr/local/bin/byspace) = %q, want empty", got)
	}
}

func TestBuildRelaunchScriptUsesOpenMinusNRetriesAndExecFallback(t *testing.T) {
	script := BuildRelaunchScript("/Applications/BySpace.app", false, "/tmp/relaunch.log", []string{"0.5", "1"})
	if !strings.Contains(script, "open -n '/Applications/BySpace.app' --args 'tray'") {
		t.Fatalf("expected open -n with tray arg, got %s", script)
	}
	if !strings.Contains(script, "for w in 0.5 1; do try && exit 0; sleep $w; done; try") {
		t.Fatalf("expected retry loop in relaunch script, got %s", script)
	}
	if !strings.Contains(script, "exec '/Applications/BySpace.app/Contents/MacOS/byspace' 'tray'") {
		t.Fatalf("expected direct exec fallback for locked-screen updates, got %s", script)
	}
}

func TestEnsureBundleCLISymlinkLinksAndRespectsStandaloneCopyUnlessForced(t *testing.T) {
	tmp := t.TempDir()
	bundle := filepath.Join(tmp, "BySpace.app")
	macOSDir := filepath.Join(bundle, "Contents", "MacOS")
	if err := os.MkdirAll(macOSDir, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(macOSDir, "byspace")
	if err := os.WriteFile(target, []byte("app-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	binDir := filepath.Join(tmp, "bin")

	// 1. When ~/.local/bin/byspace is absent, creates symlink automatically.
	linkPath, ok := EnsureBundleCLISymlink(bundle, binDir, false)
	if !ok || linkPath == "" {
		t.Fatalf("expected symlink creation to succeed, got ok=%v path=%q", ok, linkPath)
	}
	if dest, err := os.Readlink(linkPath); err != nil || dest != target {
		t.Fatalf("readlink = %q (err=%v), want %q", dest, err, target)
	}

	// 2. When a standalone regular file exists and force=false, leaves it untouched.
	_ = os.Remove(linkPath)
	if err := os.WriteFile(linkPath, []byte("standalone-cli"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := EnsureBundleCLISymlink(bundle, binDir, false); ok {
		t.Fatal("expected standalone CLI copy not to be overwritten when force=false")
	}

	// 3. With force=true, replaces standalone copy with symlink to the .app binary.
	if _, ok := EnsureBundleCLISymlink(bundle, binDir, true); !ok {
		t.Fatal("expected force=true to replace standalone copy with symlink")
	}
	if dest, err := os.Readlink(linkPath); err != nil || dest != target {
		t.Fatalf("readlink after force = %q (err=%v), want %q", dest, err, target)
	}
}
