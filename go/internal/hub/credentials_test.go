package hub

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"byspace/internal/privatepath"
)

func TestHumanCredentialRoundTripIsOriginScopedAndPrivate(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	credential, err := NewHumanCredential("https://hub.byspace.test/", "organization-1", strings.Repeat("s", 32), time.Unix(1, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveHumanCredential(home, credential); err != nil {
		t.Fatal(err)
	}
	path, err := humanCredentialPath(home, credential.HubOrigin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := privatepath.ValidateDirectory(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
	if _, err := privatepath.ValidateFile(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadHumanCredential(home, "https://hub.byspace.test")
	if err != nil {
		t.Fatal(err)
	}
	if loaded != credential {
		t.Fatalf("LoadHumanCredential() = %+v", loaded)
	}
	if _, err := LoadHumanCredential(home, "https://other.byspace.test"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("cross-origin LoadHumanCredential() error = %v", err)
	}
}

func TestHumanCredentialQuarantinesCrossOriginRecord(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	credential, err := NewHumanCredential("https://hub-a.byspace.test", "organization-1", strings.Repeat("s", 32), time.Unix(1, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveHumanCredential(home, credential); err != nil {
		t.Fatal(err)
	}
	source, _ := humanCredentialPath(home, credential.HubOrigin)
	target, _ := humanCredentialPath(home, "https://hub-b.byspace.test")
	if err := os.Rename(source, target); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadHumanCredential(home, "https://hub-b.byspace.test"); err == nil || !strings.Contains(err.Error(), "quarantined") {
		t.Fatalf("LoadHumanCredential() error = %v", err)
	}
	if _, err := os.Stat(target); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("invalid canonical credential remains: %v", err)
	}
	matches, err := filepath.Glob(strings.TrimSuffix(target, ".json") + ".invalid-*.json")
	if err != nil || len(matches) != 1 {
		t.Fatalf("quarantined credentials = %v, error = %v", matches, err)
	}
	if _, err := privatepath.ValidateFile(matches[0]); err != nil {
		t.Fatal(err)
	}
}
