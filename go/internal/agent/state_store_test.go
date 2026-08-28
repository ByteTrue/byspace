package agent

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"byspace/internal/privatepath"
)

func TestFileStateStoreRoundTripAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "agents-v1.json")
	store := newFileStateStore(path)
	now := time.Date(2026, time.August, 27, 12, 34, 56, 789, time.UTC)
	state := persistedState{Agents: []persistedAgent{{
		Snapshot: Snapshot{
			ID:                "agt_test",
			Provider:          "pi",
			CWD:               t.TempDir(),
			WorkspaceID:       "workspace-test",
			Title:             "Persistent agent",
			Labels:            map[string]string{"kind": "test"},
			Lifecycle:         LifecycleIdle,
			CreatedAt:         now,
			UpdatedAt:         now,
			LastUserMessageAt: now,
			RuntimeInfo: RuntimeInfo{
				Provider:         "pi",
				SessionID:        "session-test",
				NativeHandle:     "/tmp/session-test.jsonl",
				Model:            "model-test",
				ThinkingOptionID: "medium",
			},
			Capabilities: Capabilities{SupportsStreaming: true, SupportsSessionPersistence: true},
			Persistence: &PersistenceHandle{
				Provider:     "pi",
				SessionID:    "session-test",
				NativeHandle: "/tmp/session-test.jsonl",
			},
			TimelineEpoch:   "tl_test",
			TimelineHeadSeq: 1,
		},
		Timeline: TimelineSnapshot{Epoch: "tl_test", Rows: []TimelineRow{{
			Seq:       1,
			Timestamp: now,
			TurnID:    "turn_test",
			Item: TimelineItem{
				Type:            TimelineUserMessage,
				Text:            "persist me",
				ClientMessageID: "client-test",
			},
		}}},
	}}}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	fileInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && fileInfo.Mode().Perm() != 0o600 {
		t.Fatalf("file permissions = %04o", fileInfo.Mode().Perm())
	}
	directoryInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && directoryInfo.Mode().Perm() != 0o700 {
		t.Fatalf("directory permissions = %04o", directoryInfo.Mode().Perm())
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	state.Version = stateVersion
	if !reflect.DeepEqual(loaded, state) {
		t.Fatalf("loaded state mismatch:\n got: %#v\nwant: %#v", loaded, state)
	}
}

func TestFileStateStoreRejectsCorruptionWithoutOverwritingEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "agents-v1.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	corrupt := []byte(`{"version":1,"agents":[`)
	writePrivateStateFixture(t, path, corrupt)
	_, err := newFileStateStore(path).Load()
	if err == nil || !strings.Contains(err.Error(), path) {
		t.Fatalf("load error = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, corrupt) {
		t.Fatalf("corrupt evidence changed: %q", after)
	}
}

func TestFileStateStoreRejectsUnknownVersionAndPublicPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agents-v1.json")
	writePrivateStateFixture(t, path, []byte(`{"version":2,"agents":[]}`))
	if _, err := newFileStateStore(path).Load(); err == nil || !strings.Contains(err.Error(), "version 2") {
		t.Fatalf("version error = %v", err)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"agents":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := newFileStateStore(path).Load(); err == nil || !strings.Contains(err.Error(), "permissions") {
		t.Fatalf("permissions error = %v", err)
	}
}

func writePrivateStateFixture(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := privatepath.SecureFile(path); err != nil {
		t.Fatal(err)
	}
}

func TestFileStateStoreFailedEncodingPreservesPreviousState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agents-v1.json")
	store := newFileStateStore(path)
	if err := store.Save(persistedState{}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	invalid := persistedState{Agents: []persistedAgent{{
		Snapshot: Snapshot{ID: "agt_invalid"},
		Timeline: TimelineSnapshot{Rows: []TimelineRow{{Item: TimelineItem{Input: []byte("{")}}}},
	}}}
	if err := store.Save(invalid); err == nil {
		t.Fatal("invalid RawMessage was persisted")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, before) {
		t.Fatal("failed save replaced the previous state")
	}
}
