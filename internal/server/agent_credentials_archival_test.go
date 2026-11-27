package server

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestAgentCredentialArchivedRecordFailsClosed(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	rec := store.AgentRecord{ID: "agt_archived", Cwd: t.TempDir(), Provider: "mock"}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	token, err := srv.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id, ok := srv.agentIDForCredential(token); !ok || id != rec.ID {
		t.Fatal("live agent credential did not authenticate")
	}
	archivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	rec.ArchivedAt = &archivedAt
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	if id, ok := srv.agentIDForCredential(token); ok {
		t.Errorf("archived agent credential authenticated as %q", id)
	}
	if _, err := os.Stat(srv.credentialStore().path(rec.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("archived agent credential was not revoked: %v", err)
	}
}

func TestAgentHotSwapCrossProviderRevokesOldCredential(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	f.service.startAgent = f.startMockTarget
	token, err := f.srv.ensureAgentCredential(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id, ok := f.srv.agentIDForCredential(token); !ok || id != f.old.ID {
		t.Fatal("old agent credential did not authenticate before handoff")
	}
	result, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err != nil {
		t.Fatalf("HotSwap() error = %v", err)
	}
	if id, ok := f.srv.agentIDForCredential(token); ok {
		t.Errorf("old agent credential authenticated after handoff as %q", id)
	}
	credentialPath := f.srv.credentialStore().path(f.old.ID)
	if _, err := os.Stat(credentialPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("old agent credential file survived handoff: %v", err)
	}

	raw, err := json.Marshal(agentCredentialRecord{AgentID: f.old.ID, Credential: token})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credentialPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if id, ok := f.srv.agentIDForCredential(token); ok {
		t.Errorf("surviving archived credential authenticated after cleanup failure as %q", id)
	}
	replacementToken, err := f.srv.ensureAgentCredential(result.ReplacementAgentID)
	if err != nil {
		t.Fatal(err)
	}
	if id, ok := f.srv.agentIDForCredential(replacementToken); !ok || id != result.ReplacementAgentID {
		t.Errorf("replacement credential did not authenticate: id=%q ok=%v", id, ok)
	}
}

func TestAgentCredentialRevocationDeletionFailureFailsClosed(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	rec := &store.AgentRecord{ID: "agent-active", Provider: "mock", Cwd: t.TempDir()}
	if err := srv.store.UpsertAgent(*rec); err != nil {
		t.Fatal(err)
	}
	token, err := srv.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	credentials := srv.credentialStore()
	path := credentials.path(rec.ID)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(path, "blocker")
	if err := os.WriteFile(blocker, []byte("prevent removal"), 0o600); err != nil {
		t.Fatal(err)
	}
	revokeErr := credentials.revoke(rec.ID)
	if revokeErr == nil {
		t.Fatal("revoke() error = nil, want deletion failure")
	}
	if strings.Contains(revokeErr.Error(), token) {
		t.Fatal("revoke error leaked credential contents")
	}
	if err := os.Remove(blocker); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if agentID, ok := srv.agentIDForCredential(token); ok || agentID != "" {
		t.Fatalf("surviving credential authenticated as %q after failed deletion", agentID)
	}
}

func TestAgentHotSwapSameProviderCredentialContinuity(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, "mock", chief.TierStandard)
	token, err := f.srv.ensureAgentCredential(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err != nil {
		t.Fatalf("HotSwap() error = %v", err)
	}
	if result.ReplacementAgentID != f.old.ID {
		t.Fatalf("same-provider replacement ID = %q, want %q", result.ReplacementAgentID, f.old.ID)
	}
	if id, ok := f.srv.agentIDForCredential(token); !ok || id != f.old.ID {
		t.Errorf("same-provider credential did not survive: id=%q ok=%v", id, ok)
	}
	stable, err := f.srv.ensureAgentCredential(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stable != token {
		t.Error("same-provider credential changed")
	}
}
