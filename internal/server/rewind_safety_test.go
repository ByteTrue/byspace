package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestRewindConversationTruncatesCanonicalTimelineExclusively(t *testing.T) {
	session := providers.StartMockSession(providers.MockLaunchOptions{Cwd: t.TempDir()})
	for _, item := range []sdk.TimelineItem{
		{Type: "user_message", MessageID: "msg_1", Text: "hello"},
		{Type: "assistant_message", MessageID: "reply_1", Text: "first reply"},
		{Type: "user_message", MessageID: "msg_2", Text: "write a file"},
		{Type: "assistant_message", MessageID: "reply_2", Text: "second reply"},
	} {
		session.AppendTimelineItem(item)
	}
	mp := &managedPi{record: store.AgentRecord{Provider: "mock", Cwd: t.TempDir()}, session: session}
	if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_2", "conversation"); err != nil {
		t.Fatal(err)
	}
	entries := session.Timeline()
	if len(entries) != 2 || entries[0].Item.MessageID != "msg_1" || entries[1].Item.MessageID != "reply_1" {
		t.Fatalf("timeline = %#v, want only the first turn", entries)
	}
}

type rewindOrderSession struct {
	providers.ManagedSession
	entries  []sdk.TimelineEntry
	calls    []string
	convErr  error
	fileErr  error
	stateErr error
}

func (s *rewindOrderSession) Timeline() []sdk.TimelineEntry { return s.entries }
func (s *rewindOrderSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.entries = entries
}
func (s *rewindOrderSession) TreeEntryForMessage(id string) (string, bool) { return id, true }
func (s *rewindOrderSession) RewindConversation(context.Context, string) error {
	s.calls = append(s.calls, "conversation")
	return s.convErr
}
func (s *rewindOrderSession) RewindFiles(context.Context, string) error {
	s.calls = append(s.calls, "files")
	return s.fileErr
}
func (s *rewindOrderSession) RewindCapabilities() providers.RewindCapabilities {
	return providers.RewindCapabilities{Conversation: true, Files: true}
}
func (s *rewindOrderSession) GetState(context.Context) (*sdk.SessionState, error) {
	return nil, s.stateErr
}

func TestRewindOrdersDestructiveFilesAfterConversation(t *testing.T) {
	newSession := func() *rewindOrderSession {
		return &rewindOrderSession{entries: []sdk.TimelineEntry{{Item: sdk.TimelineItem{Type: "user_message", MessageID: "msg_1"}}}}
	}
	t.Run("conversation failure leaves files untouched", func(t *testing.T) {
		session := newSession()
		session.convErr = errors.New("fork failed")
		mp := &managedPi{record: store.AgentRecord{Provider: "claude"}, session: session}
		if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "both"); err == nil {
			t.Fatal("expected fork failure")
		}
		if strings.Join(session.calls, ",") != "conversation" {
			t.Fatalf("calls = %v", session.calls)
		}
	})
	t.Run("file failure is explicit after conversation success", func(t *testing.T) {
		session := newSession()
		session.fileErr = errors.New("checkpoint failed")
		mp := &managedPi{record: store.AgentRecord{Provider: "claude"}, session: session}
		err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "both")
		if err == nil || !strings.Contains(err.Error(), "conversation rewind succeeded but file rewind failed") {
			t.Fatalf("error = %v", err)
		}
		if strings.Join(session.calls, ",") != "conversation,files" {
			t.Fatalf("calls = %v", session.calls)
		}
	})
}

type combinedRewindSession struct {
	*rewindOrderSession
	combinedErr error
}

func (s *combinedRewindSession) RewindConversationAndFiles(context.Context, string) error {
	s.calls = append(s.calls, "combined")
	return s.combinedErr
}

func TestCombinedNativeRewindUsesThePreparedSessionPrimitive(t *testing.T) {
	base := &rewindOrderSession{entries: []sdk.TimelineEntry{{Item: sdk.TimelineItem{Type: "user_message", MessageID: "msg_1"}}}}
	session := &combinedRewindSession{rewindOrderSession: base, combinedErr: errors.New("checkpoint failed")}
	mp := &managedPi{record: store.AgentRecord{Provider: "claude"}, session: session}
	if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "both"); err == nil {
		t.Fatal("expected the native failure")
	}
	if strings.Join(base.calls, ",") != "combined" || len(base.entries) != 1 {
		t.Fatalf("calls=%v entries=%v", base.calls, base.entries)
	}
}

func TestRewindDoesNotReportSuccessWhenHandlePersistenceFails(t *testing.T) {
	session := &rewindOrderSession{
		entries:  []sdk.TimelineEntry{{Item: sdk.TimelineItem{Type: "user_message", MessageID: "msg_1"}}},
		stateErr: errors.New("state unavailable"),
	}
	mp := &managedPi{record: store.AgentRecord{Provider: "claude"}, session: session}
	err := (&Server{store: &store.Store{}}).rewindConversation(context.Background(), mp, "msg_1", "conversation")
	if err == nil || !strings.Contains(err.Error(), "saving the replacement session failed") {
		t.Fatalf("error = %v", err)
	}
}

func TestNativeRewindNeverDiscardsUnrelatedWorkspaceChanges(t *testing.T) {
	cwd := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = cwd
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, output)
		}
	}
	runGit("init")
	for _, name := range []string{"tracked.txt", "other-session.txt"} {
		if err := os.WriteFile(filepath.Join(cwd, name), []byte("base\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	runGit("add", "tracked.txt", "other-session.txt")
	runGit("-c", "user.name=BySpace Test", "-c", "user.email=byspace@example.invalid", "commit", "-m", "base")
	want := map[string]string{
		"tracked.txt":       "unrelated edit\n",
		"other-session.txt": "second session edit\n",
		"untracked.txt":     "keep untracked\n",
	}
	for name, contents := range want {
		if err := os.WriteFile(filepath.Join(cwd, name), []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	assertPreserved := func(t *testing.T) {
		t.Helper()
		for name, contents := range want {
			got, err := os.ReadFile(filepath.Join(cwd, name))
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			if string(got) != contents {
				t.Fatalf("%s = %q, want %q", name, got, contents)
			}
		}
	}

	t.Run("chat only leaves files untouched", func(t *testing.T) {
		session := providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: "e2e-fast-stream"})
		session.AppendTimelineItem(sdk.TimelineItem{Type: "user_message", MessageID: "msg_1", Text: "hello"})
		mp := &managedPi{record: store.AgentRecord{Provider: "mock", Cwd: cwd}, session: session}
		if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "conversation"); err != nil {
			t.Fatal(err)
		}
		assertPreserved(t)
	})

	t.Run("unsupported files rewind fails without touching files", func(t *testing.T) {
		session := providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: "e2e-fast-stream"})
		session.AppendTimelineItem(sdk.TimelineItem{Type: "user_message", MessageID: "msg_1", Text: "hello"})
		mp := &managedPi{record: store.AgentRecord{Provider: "mock", Cwd: cwd}, session: session}
		if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "files"); err == nil {
			t.Fatal("files rewind succeeded without native file checkpoints")
		}
		assertPreserved(t)
	})

	t.Run("both uses one session scoped native revert", func(t *testing.T) {
		reverts := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/api/session":
				_, _ = w.Write([]byte(`{"id":"ses_native"}`))
			case "/api/session/ses_native/revert/stage":
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["messageID"] != "msg_1" || body["files"] != true {
					t.Errorf("stage body = %#v", body)
				}
				_, _ = w.Write([]byte("{}"))
			case "/api/session/ses_native/revert/commit":
				reverts++
				_, _ = w.Write([]byte("{}"))
			default:
				http.NotFound(w, r)
			}
		}))
		defer server.Close()
		session, err := providers.StartOpenCodeSession(providers.LaunchConfig{Cwd: cwd}, server.URL)
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		session.SeedTimeline([]sdk.TimelineEntry{{Item: sdk.TimelineItem{Type: "user_message", MessageID: "msg_1", Text: "hello"}}})
		mp := &managedPi{record: store.AgentRecord{Provider: "opencode", Cwd: cwd}, session: session}
		if err := (&Server{}).rewindConversation(context.Background(), mp, "msg_1", "both"); err != nil {
			t.Fatal(err)
		}
		if reverts != 1 {
			t.Fatalf("native revert count = %d, want 1", reverts)
		}
		assertPreserved(t)
	})
}
