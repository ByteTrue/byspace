package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func TestTakeDaemonAuthPatchHashesAPlaintext(t *testing.T) {
	config := map[string]any{"auth": map[string]any{daemonAuthPatchKey: "hunter2"}}

	hash, applied, err := takeDaemonAuthPatch(config)
	if err != nil {
		t.Fatalf("takeDaemonAuthPatch: %v", err)
	}
	if !applied || hash == "" {
		t.Fatalf("applied=%v hash=%q, want a stored hash", applied, hash)
	}
	if _, stillThere := config["auth"]; stillThere {
		t.Fatal("the plaintext auth block must not survive into the config patch")
	}
	if !store.VerifyDaemonPassword(hash, "hunter2") {
		t.Fatal("the hash must verify against the submitted password")
	}
	if store.VerifyDaemonPassword(hash, "wrong") {
		t.Fatal("the hash must not verify against a different password")
	}
}

func TestTakeDaemonAuthPatchClearsOnNull(t *testing.T) {
	config := map[string]any{"auth": map[string]any{daemonAuthPatchKey: nil}}

	hash, applied, err := takeDaemonAuthPatch(config)
	if err != nil {
		t.Fatalf("takeDaemonAuthPatch: %v", err)
	}
	if !applied {
		t.Fatal("null must be treated as an explicit clear, not as an absent field")
	}
	if hash != "" {
		t.Fatalf("hash = %q, want empty for a clear", hash)
	}
	if _, stillThere := config["auth"]; stillThere {
		t.Fatal("the auth block must be removed from the patch")
	}
}

// A client that read the config and echoed it back sends only the derived `passwordSet`. Storing
// that would overwrite the hash with a boolean, so the patch must drop it and change nothing.
func TestTakeDaemonAuthPatchIgnoresDerivedPasswordSet(t *testing.T) {
	config := map[string]any{"auth": map[string]any{"passwordSet": true}}

	hash, applied, err := takeDaemonAuthPatch(config)
	if err != nil {
		t.Fatalf("takeDaemonAuthPatch: %v", err)
	}
	if applied || hash != "" {
		t.Fatalf("applied=%v hash=%q, want the derived view ignored", applied, hash)
	}
	if _, stillThere := config["auth"]; stillThere {
		t.Fatal("derived state must not be persisted")
	}
}

func TestTakeDaemonAuthPatchLeavesUnrelatedEditsAlone(t *testing.T) {
	config := map[string]any{"cors": map[string]any{"allowedOrigins": []any{"*"}}}

	hash, applied, err := takeDaemonAuthPatch(config)
	if err != nil {
		t.Fatalf("takeDaemonAuthPatch: %v", err)
	}
	if applied || hash != "" {
		t.Fatalf("applied=%v hash=%q, want no auth work", applied, hash)
	}
	if _, ok := config["cors"]; !ok {
		t.Fatal("an unrelated edit must survive untouched")
	}
}
