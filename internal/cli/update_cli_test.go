package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/selfupdate"
)

func TestByspaceUpdateCheckAndUpToDate(t *testing.T) {
	payload := []byte("binary-payload")
	sum := sha256.Sum256(payload)
	sumHex := hex.EncodeToString(sum[:])
	assetName := selfupdate.BinaryAsset()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(selfupdate.Release{
			Version: "0.25.0",
			URL:     "https://github.com/ByteTrue/byspace/releases/tag/v0.25.0",
			Assets: map[string]selfupdate.Asset{
				assetName: {
					URL:    "http://" + r.Host + "/" + assetName,
					Size:   int64(len(payload)),
					SHA256: sumHex,
				},
			},
		})
	}))
	defer srv.Close()
	t.Setenv("BYSPACE_UPDATE_FEED", srv.URL)

	// 1. `byspace update check` when a newer version is out.
	var out, errOut bytes.Buffer
	if code := Main("0.21.2", []string{"update", "check"}, &out, &errOut); code != 0 {
		t.Fatalf("update check failed (code %d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "byspace 0.25.0 is available (you have 0.21.2)") {
		t.Fatalf("unexpected output: %q", out.String())
	}

	// 2. `byspace update` when already on the latest version.
	out.Reset()
	errOut.Reset()
	if code := Main("0.25.0", []string{"update"}, &out, &errOut); code != 0 {
		t.Fatalf("update failed (code %d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "✓ byspace 0.25.0 is the latest") {
		t.Fatalf("unexpected output: %q", out.String())
	}
}
