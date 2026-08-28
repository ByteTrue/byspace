package relay

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadOrCreateIdentityPersistsPrivateStableIdentity(t *testing.T) {
	path := IdentityPath(t.TempDir())
	first, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	second, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatalf("reload identity: %v", err)
	}
	if first != second {
		t.Fatal("Relay identity changed across reload")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat identity: %v", err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("identity permissions = %04o, want 0600", got)
		}
	}
	if got := first.PublicKeyBase64(); len(got) == 0 {
		t.Fatal("public key encoding is empty")
	}
	if got := first.ClientAuthTokenBase64(); len(got) == 0 {
		t.Fatal("auth token encoding is empty")
	}
}

func TestLoadOrCreateIdentityRejectsSymlinkedState(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation may require elevated Windows privileges")
	}
	directory := t.TempDir()
	target := filepath.Join(directory, "target.json")
	if err := os.WriteFile(target, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := IdentityPath(directory)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("symlinked Relay identity was accepted")
	}
}

func TestLoadOrCreateIdentityFailsClosedWithoutOverwritingInvalidState(t *testing.T) {
	path := IdentityPath(t.TempDir())
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	invalid := []byte("not json\n")
	if err := os.WriteFile(path, invalid, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("invalid identity was accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(invalid) {
		t.Fatal("invalid identity was overwritten")
	}
}

func TestLoadIdentityRejectsTrailingJSON(t *testing.T) {
	path := IdentityPath(t.TempDir())
	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, []byte("{}\n")...)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("identity with trailing JSON was accepted")
	}
}

func TestLoadIdentityRejectsMismatchedKeypair(t *testing.T) {
	path := IdentityPath(t.TempDir())
	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored identityFile
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	other := make([]byte, KeySize)
	other[0] = 9
	stored.PublicKeyB64 = base64.StdEncoding.EncodeToString(other)
	data, err = json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("mismatched keypair was accepted")
	}
}
