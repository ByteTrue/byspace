package hub

import (
	"bytes"
	"encoding/base64"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"byspace/internal/privatepath"
)

func TestRelationshipStoreRoundTripAndRemove(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state", "hub-relationship-v1.json")
	store := newRelationshipStore(path)
	want := testPendingRecord()
	if err := store.Save(want); err != nil {
		t.Fatal(err)
	}
	if _, err := privatepath.ValidateDirectory(filepath.Dir(path)); err != nil {
		t.Fatalf("relationship directory is not private: %v", err)
	}
	if _, err := privatepath.ValidateFile(path); err != nil {
		t.Fatalf("relationship file is not private: %v", err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Relationship.DaemonID != want.Relationship.DaemonID || got.Enrollment == nil || got.Enrollment.Token != strings.Repeat("e", 32) {
		t.Fatalf("Load() = %#v", got)
	}
	if err := store.Remove(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("relationship still exists: %v", err)
	}
}

func TestRelationshipStoreDiscardRetriesDirectorySyncAfterRemoval(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state", "hub-relationship-v1.json")
	store := newRelationshipStore(path)
	if err := store.Save(testPendingRecord()); err != nil {
		t.Fatal(err)
	}
	calls := 0
	store.syncDirectory = func(string) error {
		calls++
		if calls == 1 {
			return errors.New("injected first sync failure")
		}
		return nil
	}
	if err := store.Discard(); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("sync calls = %d, want 2", calls)
	}
	if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("discarded relationship still exists: %v", err)
	}
}

func TestRelationshipStoreReportsPostReplaceSyncUncertainty(t *testing.T) {
	t.Parallel()
	store := newRelationshipStore(filepath.Join(t.TempDir(), "state", "hub-relationship-v1.json"))
	store.syncDirectory = func(string) error { return errors.New("injected sync failure") }
	if err := store.Save(testPendingRecord()); err == nil || !relationshipWasReplaced(err) {
		t.Fatalf("Save() error = %v, want post-replace uncertainty", err)
	}
	store.syncDirectory = syncRelationshipDirectory
	stored, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.State != "pending" {
		t.Fatalf("Load() = %#v", stored)
	}
}

func TestRelationshipStoreQuarantinesInvalidAuthority(t *testing.T) {
	t.Parallel()
	directory := filepath.Join(t.TempDir(), "state")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := privatepath.SecureDirectory(directory); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "hub-relationship-v1.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"state":"active","unknown":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := privatepath.SecureFile(path); err != nil {
		t.Fatal(err)
	}
	store := newRelationshipStore(path)
	store.now = func() time.Time { return time.Unix(123, 0) }
	if _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "quarantined") {
		t.Fatalf("Load() error = %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("invalid canonical record remains: %v", err)
	}
	quarantine := filepath.Join(directory, "hub-relationship.invalid-123000000000.json")
	if _, err := os.Stat(quarantine); err != nil {
		t.Fatalf("quarantine: %v", err)
	}
}

func TestRelationshipStoreRejectsWidenedScopeBeforeSave(t *testing.T) {
	t.Parallel()
	stored := testPendingRecord()
	stored.Relationship.Scopes = []string{executionScope, "trusted_client.*"}
	if err := newRelationshipStore(filepath.Join(t.TempDir(), "state.json")).Save(stored); err == nil {
		t.Fatal("Save() succeeded")
	}
}

func TestRevokedRelationshipContainsNoAuthority(t *testing.T) {
	t.Parallel()
	stored := testPendingRecord()
	stored.State = "revoked"
	stored.Relationship.IdempotencyKey = ""
	stored.Credential = nil
	stored.Enrollment = nil
	stored.Identity = nil
	stored.Reason = "Hub revoked this relationship"
	if err := newRelationshipStore(filepath.Join(t.TempDir(), "state.json")).Save(stored); err != nil {
		t.Fatal(err)
	}
}

func testPendingRecord() record {
	return record{
		Version: relationshipVersion,
		State:   "pending",
		Relationship: relationship{
			DaemonID:       "11111111-1111-4111-8111-111111111111",
			IdempotencyKey: "22222222-2222-4222-8222-222222222222",
			HubOrigin:      "https://hub.byspace.test",
			CreatedAt:      "2026-08-28T00:00:00Z",
			Scopes:         []string{executionScope},
		},
		Credential: &credential{Secret: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))},
		Enrollment: &enrollment{Token: strings.Repeat("e", 32)},
		Identity: &identity{
			ServerID: "srv_123456789012", DaemonPublicKey: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)),
		},
	}
}
