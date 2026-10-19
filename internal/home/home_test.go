package home

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHomeServerIDAndKeyPairPersistence(t *testing.T) {
	tmp := t.TempDir()
	h, err := Resolve(tmp)
	if err != nil {
		t.Fatal(err)
	}

	id1, err := GetOrCreateServerID(h)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(id1, "srv_") || len(id1) != 16 {
		t.Fatalf("unexpected serverId format: %q", id1)
	}
	id2, err := GetOrCreateServerID(h)
	if err != nil || id1 != id2 {
		t.Fatalf("expected stable serverId, got %q vs %q (%v)", id1, id2, err)
	}

	kp1, pub1, err := LoadOrCreateKeyPair(h)
	if err != nil {
		t.Fatal(err)
	}
	kp2, pub2, err := LoadOrCreateKeyPair(h)
	if err != nil {
		t.Fatal(err)
	}
	if pub1 != pub2 || kp1.PublicKey != kp2.PublicKey || kp1.SecretKey != kp2.SecretKey {
		t.Fatal("expected persisted keypair to reload identically")
	}

	info, err := os.Stat(filepath.Join(h, KeyPairFilename))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected 0600 keypair file mode, got %o", info.Mode().Perm())
	}
}
