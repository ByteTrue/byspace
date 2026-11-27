package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	agentroles "github.com/ByteTrue/byspace/internal/agent/roles"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/attention"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/proc"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func initTestGitRepo(t *testing.T, dir string) {
	t.Helper()
	run := func(args ...string) {
		t.Helper()
		cmd := proc.CommandContext(context.Background(), "git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
		}
	}
	run("init", "-b", "main")
	run("config", "user.email", "test@byspace.local")
	run("config", "user.name", "BySpace Test")
	run("config", "core.autocrlf", "false")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("seed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "README.md")
	run("commit", "-m", "initial commit")
}

func decodeRecordedMessages(t *testing.T, sink *recordingSink) []map[string]any {
	t.Helper()
	sink.mu.Lock()
	texts := append([]string(nil), sink.texts...)
	sink.mu.Unlock()
	out := make([]map[string]any, 0, len(texts))
	for _, raw := range texts {
		var msg map[string]any
		if err := json.Unmarshal([]byte(raw), &msg); err != nil {
			t.Fatalf("invalid wire json %q: %v", raw, err)
		}
		out = append(out, msg)
	}
	return out
}

func callChiefRPC(t *testing.T, srv *Server, msgType string, payload map[string]any) map[string]any {
	t.Helper()
	agentID, _ := payload["callerAgentId"].(string)
	if agentID == "" && (msgType == "chief.thread.submit.request" || msgType == "chief.thread.verdict.request") {
		agentID = "agt_test_author"
		if msgType == "chief.thread.verdict.request" {
			agentID = "agt_test_verifier"
		}
		if mission := srv.chiefMissionForThread(stringPayload(payload, "missionId"), stringPayload(payload, "threadId")); mission != nil {
			for _, thread := range mission.Threads {
				if thread.ID != stringPayload(payload, "threadId") {
					continue
				}
				if msgType == "chief.thread.submit.request" && thread.AuthorAgentID != "" {
					agentID = thread.AuthorAgentID
				}
				if msgType == "chief.thread.verdict.request" && thread.VerifierAgentID != "" {
					agentID = thread.VerifierAgentID
				}
			}
		}
	}
	if agentID != "" {
		return callChiefRPCAs(t, srv, agentID, msgType, payload)
	}
	return callChiefRPCUnbound(t, srv, msgType, payload)
}

func stringPayload(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func callChiefRPCAs(t *testing.T, srv *Server, agentID, msgType string, payload map[string]any) map[string]any {
	t.Helper()
	sink := &recordingSink{}
	srv.bindSinkAgentIdentity(sink, agentID)
	return callChiefRPCOnSink(t, srv, sink, msgType, payload)
}

func callChiefRPCUnbound(t *testing.T, srv *Server, msgType string, payload map[string]any) map[string]any {
	t.Helper()
	return callChiefRPCOnSink(t, srv, &recordingSink{}, msgType, payload)
}

func callChiefRPCOnSink(t *testing.T, srv *Server, sink *recordingSink, msgType string, payload map[string]any) map[string]any {
	t.Helper()
	body := make(map[string]any, len(payload)+1)
	for k, v := range payload {
		body[k] = v
	}
	body["type"] = msgType
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	srv.handleSessionMessage(t.Context(), sink, raw)
	msgs := decodeRecordedMessages(t, sink)
	if len(msgs) == 0 {
		t.Fatalf("%s produced no response", msgType)
	}
	last := msgs[len(msgs)-1]
	inner, _ := last["message"].(map[string]any)
	p, _ := inner["payload"].(map[string]any)
	if p == nil {
		p, _ = last["payload"].(map[string]any)
	}
	if p == nil {
		t.Fatalf("%s missing payload: %+v", msgType, last)
	}
	return p
}

func waitForCondition(t *testing.T, timeout time.Duration, fn func() bool, desc string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", desc)
}

type chiefFakeNonPiSession struct {
	providers.ManagedSession
	mu       sync.Mutex
	status   string
	lastErr  string
	state    *sdk.SessionState
	handlers []func(map[string]any)
	prompts  []string
}

func newChiefFakeNonPiSession(cwd, sid, handle string) *chiefFakeNonPiSession {
	return &chiefFakeNonPiSession{
		ManagedSession: providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: "e2e-fast-stream"}),
		status:         "idle",
		state: &sdk.SessionState{
			SessionID:   sid,
			SessionFile: handle,
		},
	}
}

func (f *chiefFakeNonPiSession) Status() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status
}

func (f *chiefFakeNonPiSession) LastError() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastErr
}

func (f *chiefFakeNonPiSession) GetState(context.Context) (*sdk.SessionState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state == nil {
		return nil, nil
	}
	cp := *f.state
	return &cp, nil
}

func (f *chiefFakeNonPiSession) OnEvent(fn func(map[string]any)) func() {
	f.mu.Lock()
	f.handlers = append(f.handlers, fn)
	f.mu.Unlock()
	return func() {}
}

func (f *chiefFakeNonPiSession) Prompt(_ context.Context, msg string, _ []sdk.ImageContent) error {
	f.mu.Lock()
	f.prompts = append(f.prompts, msg)
	f.status = "running"
	f.mu.Unlock()
	return nil
}

func (f *chiefFakeNonPiSession) emit(ev map[string]any) {
	f.mu.Lock()
	handlers := make([]func(map[string]any), len(f.handlers))
	copy(handlers, f.handlers)
	f.mu.Unlock()
	for _, fn := range handlers {
		fn(ev)
	}
}

func TestChiefDerivedProviderVerifierPosture(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	srv.store.SaveDaemonConfig(map[string]any{"providers": map[string]any{
		"derived-claude":   map[string]any{"extends": "claude"},
		"derived-opencode": map[string]any{"extends": "opencode"},
		"derived-codex":    map[string]any{"extends": "codex"},
	}})

	for _, tc := range []struct {
		provider string
		protocol string
	}{
		{provider: "derived-claude", protocol: "claude"},
		{provider: "derived-opencode", protocol: "opencode"},
		{provider: "derived-codex", protocol: "codex"},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			rec, err := srv.chief.createWorkerRecord("msn_derived", "thr_"+tc.protocol, chief.RoleVerifier, "", "", t.TempDir(), "Verifier", chief.Profile{Provider: tc.provider, ModeID: "full-access"})
			if err != nil {
				t.Fatal(err)
			}
			if rec.Provider != tc.provider {
				t.Fatalf("derived provider ID changed: got %q want %q", rec.Provider, tc.provider)
			}
			switch tc.protocol {
			case "claude", "opencode":
				if rec.Config == nil || derefStr(rec.Config.ModeID) != "plan" {
					t.Fatalf("derived %s verifier mode = %+v, want plan", tc.protocol, rec.Config)
				}
			case "codex":
				if rec.Config == nil || rec.Config.ProviderOptions["sandbox_mode"] != "read-only" ||
					rec.Config.ProviderOptions["approval_policy"] != "never" || rec.Config.FeatureValues["plan_mode"] != true {
					t.Fatalf("derived codex verifier posture = %+v, want read-only + never + plan", rec.Config)
				}
			}
		})
	}

	author, err := srv.chief.createWorkerRecord("msn_derived", "thr_author", chief.RoleAuthor, "", "", t.TempDir(), "Author", chief.Profile{
		Provider: "derived-codex", ModeID: "full-access", FeatureValues: map[string]any{"plan_mode": false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if derefStr(author.Config.ModeID) != "full-access" || author.Config.FeatureValues["plan_mode"] != false || author.Config.ProviderOptions["approval_policy"] != nil {
		t.Fatalf("author settings were changed by verifier posture: %+v", author.Config)
	}
}

func TestChiefSyncPersistencePreservesNonPiProviderAndDiscardedGuard(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTestServer(t, t.TempDir())
	cwd := t.TempDir()

	// Non-Pi persistence stamps mp.record.Provider ("codex") and preserves non-empty NativeHandle/Metadata.
	fakeCodex := newChiefFakeNonPiSession(cwd, "sess_codex_1", "")
	mp := &managedPi{
		record: store.AgentRecord{
			ID:       "agt_codex_sync",
			Provider: "codex",
			Cwd:      cwd,
			Persistence: &store.AgentPersistenceHandle{
				Provider:     "codex",
				SessionID:    "sess_codex_old",
				NativeHandle: "native_codex_thread",
				Metadata:     map[string]any{"threadMode": "app-server"},
			},
		},
		session: fakeCodex,
	}
	srv.mu.Lock()
	srv.agents[mp.record.ID] = mp
	srv.mu.Unlock()
	if err := srv.store.UpsertAgent(mp.record); err != nil {
		t.Fatal(err)
	}

	if err := srv.syncPiPersistenceChecked(mp); err != nil {
		t.Fatal(err)
	}
	persisted, err := srv.store.GetAgent(mp.record.ID)
	if err != nil || persisted == nil || persisted.Persistence == nil {
		t.Fatalf("missing persistence after sync: %+v err=%v", persisted, err)
	}
	if persisted.Persistence.Provider != "codex" {
		t.Fatalf("Persistence.Provider = %q, want codex", persisted.Persistence.Provider)
	}
	if persisted.Persistence.SessionID != "sess_codex_1" {
		t.Fatalf("Persistence.SessionID = %q, want sess_codex_1", persisted.Persistence.SessionID)
	}
	if persisted.Persistence.Metadata["threadMode"] != "app-server" {
		t.Fatalf("Persistence.Metadata lost: %+v", persisted.Persistence.Metadata)
	}

	// Preserve commit 249a805c discarded-agent guard inside s.mu without spawning /bin/sh.
	gated := &gatedStateSession{
		ManagedSession: providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: "e2e-fast-stream"}),
		entered:        make(chan struct{}),
		release:        make(chan struct{}),
	}
	mpDiscarded := &managedPi{
		record:  store.AgentRecord{ID: "discarded-nonpi", Provider: "codex", Cwd: cwd},
		session: gated,
	}
	srv.mu.Lock()
	srv.agents[mpDiscarded.record.ID] = mpDiscarded
	srv.mu.Unlock()
	if err := srv.store.UpsertAgent(mpDiscarded.record); err != nil {
		t.Fatal(err)
	}
	syncDone := make(chan error, 1)
	go func() { syncDone <- srv.syncPiPersistenceChecked(mpDiscarded) }()
	<-gated.entered
	srv.discardCreatedAgent(mpDiscarded, mpDiscarded.record.ID)
	close(gated.release)
	if err := <-syncDone; err != nil {
		t.Fatal(err)
	}
	persisted, err = srv.store.GetAgent(mpDiscarded.record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted != nil {
		t.Fatalf("persistence sync recreated discarded agent: %+v", persisted)
	}

	verifierSession := newChiefFakeNonPiSession(cwd, "sess_verifier_sync", "native-verifier")
	verifierRec := store.AgentRecord{
		ID: "agt_verifier_sync", Provider: "codex", Cwd: cwd,
		Labels: chief.BuildOrchestrationLabels("mis_sync", "thr_sync", chief.RoleVerifier, true),
	}
	srv.agents[verifierRec.ID] = &managedPi{record: verifierRec, session: verifierSession}
	if err := srv.store.UpsertAgent(verifierRec); err != nil {
		t.Fatal(err)
	}
	if err := srv.chief.promptAgentWithText(t.Context(), verifierRec.ID, "verify the submitted work", nil); err != nil {
		t.Fatal(err)
	}
	verifierSession.mu.Lock()
	verifierPrompt := strings.Join(verifierSession.prompts, "\n")
	verifierSession.mu.Unlock()
	if verifierPrompt == "" {
		t.Fatalf("verifier orchestration prompt not injected: %q", verifierPrompt)
	}
}

func TestChiefReadOnlyVerifierPostureAndOrchestrationPrompt(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTestServer(t, t.TempDir())

	claudeRec := store.AgentRecord{
		Provider: "claude",
		Labels:   chief.BuildOrchestrationLabels("mis_1", "thr_1", chief.RoleVerifier, true),
	}
	applyReadOnlyVerifierPosture(&claudeRec)
	if claudeRec.Config == nil || claudeRec.Config.ModeID == nil || *claudeRec.Config.ModeID != "plan" {
		t.Fatalf("claude verifier ModeID = %+v, want plan", claudeRec.Config)
	}

	opencodeRec := store.AgentRecord{
		Provider: "opencode",
		Labels:   chief.BuildOrchestrationLabels("mis_1", "thr_1", chief.RoleVerifier, true),
	}
	applyReadOnlyVerifierPosture(&opencodeRec)
	if opencodeRec.Config == nil || opencodeRec.Config.ModeID == nil || *opencodeRec.Config.ModeID != "plan" {
		t.Fatalf("opencode verifier ModeID = %+v, want plan", opencodeRec.Config)
	}

	codexRec := store.AgentRecord{
		Provider: "codex",
		Labels:   chief.BuildOrchestrationLabels("mis_1", "thr_1", chief.RoleVerifier, true),
	}
	applyReadOnlyVerifierPosture(&codexRec)
	if codexRec.Config == nil || codexRec.Config.ProviderOptions["sandbox_mode"] != "read-only" ||
		codexRec.Config.ProviderOptions["approval_policy"] != "never" || codexRec.Config.FeatureValues["plan_mode"] != true {
		t.Fatalf("codex verifier read-only posture not enforced: %+v", codexRec.Config)
	}

	authorPrompt := srv.systemPromptFor(store.AgentRecord{
		Labels: chief.BuildOrchestrationLabels("mis_1", "thr_1", chief.RoleAuthor, true),
	})
	if !strings.Contains(authorPrompt, agentroles.OrchestrationPrompt(chief.RoleAuthor)) {
		t.Fatalf("author orchestration prompt not injected: %q", authorPrompt)
	}
	verifierPrompt := srv.systemPromptFor(codexRec)
	if !strings.Contains(verifierPrompt, agentroles.OrchestrationPrompt(chief.RoleVerifier)) {
		t.Fatalf("verifier orchestration prompt not injected: %q", verifierPrompt)
	}
}

func TestChiefUnifiedTurnCompletedChatterShieldAndPerTurnFinishKey(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	home := t.TempDir()
	srv := newTestServer(t, home)
	cwd := t.TempDir()
	_, ws, err := srv.ensureWorkspaceForCwd(cwd)
	if err != nil {
		t.Fatal(err)
	}

	clientSink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[clientSink] = true
	srv.mu.Unlock()

	shieldedRec := store.AgentRecord{
		ID:          "agt_shielded_mock",
		Provider:    "mock",
		Cwd:         cwd,
		WorkspaceID: ws.WorkspaceID,
		Labels:      chief.BuildOrchestrationLabels("mis_shield", "thr_shield", chief.RoleAuthor, true),
		LastStatus:  "idle",
		Config:      &store.AgentConfig{Model: chiefStrPtr("e2e-fast-stream")},
	}
	_ = srv.store.UpsertAgent(shieldedRec)
	mpShielded, err := srv.startOrGetPiAgent(shieldedRec)
	if err != nil {
		t.Fatal(err)
	}
	srv.mu.Lock()
	srv.timelineViews[clientSink] = map[string]bool{shieldedRec.ID: true}
	srv.mu.Unlock()

	if err := mpShielded.session.Prompt(t.Context(), "emit a synthetic notification", nil); err != nil {
		t.Fatal(err)
	}
	if err := mpShielded.session.WaitForFinish(t.Context()); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, 3*time.Second, func() bool {
		rec, _ := srv.store.GetAgent(shieldedRec.ID)
		return rec != nil && rec.LastStatus == "idle" && rec.Persistence != nil
	}, "mock byspace_turn_completed persistence & status")

	persistedShielded, _ := srv.store.GetAgent(shieldedRec.ID)
	if persistedShielded.RequiresAttention {
		t.Fatalf("chatter-shielded worker got RequiresAttention=true (%v) on finished turn", persistedShielded.AttentionReason)
	}
	if persistedShielded.Persistence.Provider != "mock" {
		t.Fatalf("mock persistence provider = %q, want mock", persistedShielded.Persistence.Provider)
	}

	fakeNonPi := newChiefFakeNonPiSession(cwd, "sess_claude_1", "claude-handle")
	nonPiShielded := &managedPi{
		record: store.AgentRecord{
			ID:         "agt_claude_worker",
			Provider:   "claude",
			Cwd:        cwd,
			LastStatus: "running",
			Labels:     chief.BuildOrchestrationLabels("mis_shield", "thr_shield", chief.RoleVerifier, true),
		},
		session: fakeNonPi,
		turnSeq: 1,
	}
	srv.mu.Lock()
	srv.agents[nonPiShielded.record.ID] = nonPiShielded
	srv.timelineViews[clientSink][nonPiShielded.record.ID] = true
	srv.mu.Unlock()
	_ = srv.store.UpsertAgent(nonPiShielded.record)

	srv.handleTurnCompleted(nonPiShielded, fakeNonPi, nonPiShielded.record, "turn_nonpi_1", time.Now().UTC().Format(time.RFC3339Nano))
	waitForCondition(t, 2*time.Second, func() bool {
		rec, _ := srv.store.GetAgent(nonPiShielded.record.ID)
		return rec != nil && rec.LastStatus == "idle" && rec.Persistence != nil
	}, "non-pi handleTurnCompleted persistence")

	recClaude, _ := srv.store.GetAgent(nonPiShielded.record.ID)
	if recClaude.RequiresAttention {
		t.Fatalf("chatter-shielded claude verifier should suppress finished attention")
	}
	if recClaude.Persistence == nil || recClaude.Persistence.Provider != "claude" {
		t.Fatalf("claude persistence provider = %+v, want claude", recClaude.Persistence)
	}

	soloRec := store.AgentRecord{
		ID:         "agt_solo",
		Provider:   "claude",
		Cwd:        cwd,
		LastStatus: "running",
	}
	mpSolo := &managedPi{record: soloRec, session: fakeNonPi, turnSeq: 2}
	srv.mu.Lock()
	srv.agents[soloRec.ID] = mpSolo
	srv.mu.Unlock()
	_ = srv.store.UpsertAgent(soloRec)
	srv.handleTurnCompleted(mpSolo, fakeNonPi, soloRec, "", time.Now().UTC().Format(time.RFC3339Nano))
	soloAfter, _ := srv.store.GetAgent(soloRec.ID)
	if !soloAfter.RequiresAttention || soloAfter.AttentionReason == nil || *soloAfter.AttentionReason != AttentionReasonFinished {
		t.Fatalf("solo agent expected AttentionReasonFinished, got %+v", soloAfter)
	}

	srv.notifiedChildrenMu.Lock()
	srv.notifiedChildren = make(map[string]bool)
	srv.notifiedChildrenMu.Unlock()
	srv.notifyParentChildFinished(t.Context(), "agt_missing_child", "seq:1", finishReasonFinished)
	srv.notifyParentChildFinished(t.Context(), "agt_missing_child", "seq:1", finishReasonFinished)
	srv.notifyParentChildFinished(t.Context(), "agt_missing_child", "seq:2", finishReasonFinished)
	srv.notifiedChildrenMu.Lock()
	key1 := srv.notifiedChildren["agt_missing_child\x00seq:1\x00"+finishReasonFinished]
	key2 := srv.notifiedChildren["agt_missing_child\x00seq:2\x00"+finishReasonFinished]
	count := len(srv.notifiedChildren)
	srv.notifiedChildrenMu.Unlock()
	if !key1 || !key2 || count != 2 {
		t.Fatalf("per-turn finish notification keys unexpected: key1=%v key2=%v count=%d", key1, key2, count)
	}
}

func TestChiefUniversalVerifierMutationAuditAcrossProviders(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	repo := t.TempDir()
	initTestGitRepo(t, repo)

	srv := newTestServer(t, t.TempDir())
	srv.store.SaveDaemonConfig(map[string]any{"defaultProvider": "mock"})
	createResp := callChiefRPC(t, srv, "chief.mission.create.request", map[string]any{
		"requestId": "req_create",
		"goal":      "Verify read-only enforcement",
		"tier":      "L1",
		"baseCwd":   repo,
	})
	missionMap := createResp["mission"].(map[string]any)
	missionID := missionMap["id"].(string)
	chiefID := missionMap["chiefAgentId"].(string)

	thResp := callChiefRPC(t, srv, "chief.thread.create.request", map[string]any{
		"requestId": "req_th",
		"missionId": missionID,
		"title":     "Fix widget",
		"goal":      "Update widget cleanly",
	})
	thMap := thResp["thread"].(map[string]any)
	threadID := thMap["id"].(string)
	verifierID := thMap["verifierAgentId"].(string)
	authorID := thMap["authorAgentId"].(string)

	if err := os.WriteFile(filepath.Join(repo, "widget.txt"), []byte("author change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	subResp := callChiefRPC(t, srv, "chief.thread.submit.request", map[string]any{
		"requestId":     "req_sub",
		"missionId":     missionID,
		"threadId":      threadID,
		"callerAgentId": authorID,
		"summary":       "Added widget.txt",
		"changedFiles":  []string{"widget.txt"},
	})
	if accepted, _ := subResp["accepted"].(bool); !accepted {
		t.Fatalf("expected submit accepted, got %+v", subResp)
	}

	verRec, _ := srv.store.GetAgent(verifierID)
	srv.chief.capturePreTurnBaseline(*verRec)

	if err := os.WriteFile(filepath.Join(repo, "verifier_cheat.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	verResp := callChiefRPC(t, srv, "chief.thread.verdict.request", map[string]any{
		"requestId":     "req_ver",
		"missionId":     missionID,
		"threadId":      threadID,
		"callerAgentId": verifierID,
		"outcome":       "pass",
		"summary":       "Looks good",
	})
	if accepted, _ := verResp["accepted"].(bool); accepted {
		t.Fatalf("mutating verifier verdict should be rejected/tainted: %+v", verResp)
	}
	if esc, _ := verResp["escalatedToChief"].(bool); !esc {
		t.Fatalf("mutating verifier should escalateToChief: %+v", verResp)
	}
	thAfter, _ := verResp["thread"].(map[string]any)
	if thAfter["status"] != chief.ThreadStatusBlocked {
		t.Fatalf("thread status = %v, want blocked", thAfter["status"])
	}
	verdictMap, _ := thAfter["lastVerdict"].(map[string]any)
	if verdictMap == nil || verdictMap["tainted"] != true {
		t.Fatalf("expected tainted=true on lastVerdict, got %+v", verdictMap)
	}

	chiefRec, _ := srv.store.GetAgent(chiefID)
	if !chiefRec.RequiresAttention || chiefRec.AttentionReason == nil || *chiefRec.AttentionReason != AttentionReasonPermission {
		t.Fatalf("chief expected AttentionReasonPermission escalation, got %+v", chiefRec)
	}
	if attention.IsPushEligibleReason(AttentionReasonError) {
		t.Fatal("IsPushEligibleReason(error) must remain false")
	}

	_ = srv.clearAgentAttention(chiefID)
	th2Resp := callChiefRPC(t, srv, "chief.thread.create.request", map[string]any{
		"requestId": "req_th2",
		"missionId": missionID,
		"title":     "Post-turn verifier check",
		"goal":      "Detect silent verifier writes",
	})
	th2Map := th2Resp["thread"].(map[string]any)
	th2ID := th2Map["id"].(string)
	ver2ID := th2Map["verifierAgentId"].(string)

	ver2Rec, _ := srv.store.GetAgent(ver2ID)
	ver2Rec.Provider = "codex"
	applyReadOnlyVerifierPosture(ver2Rec)
	_ = srv.store.UpsertAgent(*ver2Rec)

	srv.chief.capturePreTurnBaseline(*ver2Rec)
	if err := os.WriteFile(filepath.Join(repo, "silent_mutation.txt"), []byte("sneaky edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv.chief.OnAgentTurnCompleted(t.Context(), *ver2Rec, "turn_codex_1")

	mAfter, err := srv.chief.store.GetMission(missionID)
	if err != nil {
		t.Fatal(err)
	}
	var th2 chief.Thread
	for _, th := range mAfter.Threads {
		if th.ID == th2ID {
			th2 = th
		}
	}
	if th2.Status != chief.ThreadStatusBlocked || th2.LastVerdict == nil || !th2.LastVerdict.Tainted {
		t.Fatalf("post-turn verifier audit failed to taint codex thread: %+v", th2)
	}
}

func TestChiefProcessExitRecoveryAndDeduplicatedEscalation(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	repo := t.TempDir()
	initTestGitRepo(t, repo)

	srv := newTestServer(t, t.TempDir())
	createResp := callChiefRPC(t, srv, "chief.mission.create.request", map[string]any{
		"requestId": "req_m",
		"goal":      "Crash recovery verification",
		"tier":      "L1",
		"baseCwd":   repo,
	})
	mMap := createResp["mission"].(map[string]any)
	missionID := mMap["id"].(string)
	chiefID := mMap["chiefAgentId"].(string)

	thResp := callChiefRPC(t, srv, "chief.thread.create.request", map[string]any{
		"requestId": "req_t",
		"missionId": missionID,
		"title":     "Crash thread",
		"goal":      "Recover from process exit",
	})
	thMap := thResp["thread"].(map[string]any)
	threadID := thMap["id"].(string)
	authorID := thMap["authorAgentId"].(string)
	authorRec, _ := srv.store.GetAgent(authorID)

	authorRec.Provider = "mock"
	_ = srv.store.UpsertAgent(*authorRec)

	srv.chief.OnAgentProcessExit(t.Context(), *authorRec, "signal: killed")
	m1, _ := srv.chief.store.GetMission(missionID)
	if len(m1.Threads) == 0 || m1.Threads[0].SystemAttention == nil || m1.Threads[0].SystemAttention.AutoActionTaken == nil || *m1.Threads[0].SystemAttention.AutoActionTaken != "cold_resume" {
		t.Fatalf("expected cold_resume recovery action on first process exit, got %+v", m1.Threads[0].SystemAttention)
	}
	chief1, _ := srv.store.GetAgent(chiefID)
	if chief1.RequiresAttention {
		t.Fatalf("chief should not escalate on successful cold resume attempt #1: %+v", chief1)
	}

	srv.mu.Lock()
	delete(srv.agents, authorID)
	srv.mu.Unlock()
	authorRec.Provider = "nonexistent-provider-crash-test"
	_ = srv.store.UpsertAgent(*authorRec)

	for i := 0; i < maxChiefColdResumeAttempts; i++ {
		srv.chief.OnAgentProcessExit(t.Context(), *authorRec, "process vanished permanently")
	}
	chief2, _ := srv.store.GetAgent(chiefID)
	if !chief2.RequiresAttention || chief2.AttentionReason == nil || *chief2.AttentionReason != AttentionReasonPermission {
		t.Fatalf("expected AttentionReasonPermission after cold-resume exhaustion, got %+v", chief2)
	}
	firstTS := ""
	if chief2.AttentionTimestamp != nil {
		firstTS = *chief2.AttentionTimestamp
	}

	time.Sleep(10 * time.Millisecond)
	srv.chief.OnAgentProcessExit(t.Context(), *authorRec, "process vanished permanently again")
	chief3, _ := srv.store.GetAgent(chiefID)
	if chief3.AttentionTimestamp == nil || *chief3.AttentionTimestamp != firstTS {
		t.Fatalf("duplicate incident shifted timestamp %q -> %v", firstTS, chief3.AttentionTimestamp)
	}

	_ = srv.clearAgentAttention(chiefID)
	srv.chief.OnAgentPermissionRequested(t.Context(), *authorRec, map[string]any{"toolName": "bash"})
	buckets := srv.computeWorkspaceStatusBuckets()
	chiefRecNow, _ := srv.store.GetAgent(chiefID)
	if buckets[chiefRecNow.WorkspaceID] != bucketNeedsInput {
		t.Fatalf("chief workspace bucket = %q, want %q when permission_blocked", buckets[chiefRecNow.WorkspaceID], bucketNeedsInput)
	}
	_, _ = srv.chief.store.UpdateMission(missionID, func(m *chief.Mission) error {
		m.Status = chief.MissionStatusWaitingHuman
		m.PendingDecision = &chief.HumanDecision{
			ID:        "dec_1",
			Kind:      "approve_plan",
			Title:     "Approve step",
			Summary:   "Proceed with recovery",
			ThreadID:  chiefStrPtr(threadID),
			Options:   []chief.HumanDecisionOption{{ID: "approve", Label: "Approve"}},
			CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
		return nil
	})
	_ = srv.chief.router.ResolveIncident(missionID, threadID, chief.AttentionKindProcessCrash)
	resResp := callChiefRPC(t, srv, "chief.mission.resolve_decision.request", map[string]any{
		"requestId":  "req_res",
		"missionId":  missionID,
		"decisionId": "dec_1",
		"optionId":   "approve",
		"note":       "go ahead",
	})
	if errVal := resResp["error"]; errVal != nil {
		t.Fatalf("resolve_decision failed: %v", errVal)
	}
	mResolved := resResp["mission"].(map[string]any)
	if mResolved["status"] != chief.MissionStatusActive {
		t.Fatalf("resolved mission status = %v, want active", mResolved["status"])
	}
}

func TestChiefMissionUpgradeL0ToL1AndL2(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	home := t.TempDir()
	srv := newTestServer(t, home)

	repoL1 := t.TempDir()
	initTestGitRepo(t, repoL1)
	_, wsL1, err := srv.ensureWorkspaceForCwd(repoL1)
	if err != nil {
		t.Fatal(err)
	}
	soloL1 := store.AgentRecord{
		ID:       newAgentID(),
		Provider: "mock",
		Cwd:      repoL1, WorkspaceID: wsL1.WorkspaceID,
		Title:      chiefStrPtr("Solo Worker"),
		LastStatus: "idle",
		CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := srv.store.UpsertAgent(soloL1); err != nil {
		t.Fatal(err)
	}

	upgL1 := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId":   "req_upg_l1",
		"soloAgentId": soloL1.ID,
		"targetTier":  "L1",
		"title":       "Verify solo work",
	})
	if upgL1["error"] != nil {
		t.Fatalf("L0->L1 upgrade error: %v", upgL1["error"])
	}
	mL1 := upgL1["mission"].(map[string]any)
	if mL1["tier"] != "L1" {
		t.Fatalf("L1 mission tier = %v", mL1["tier"])
	}
	threadsL1 := mL1["threads"].([]any)
	if len(threadsL1) != 1 {
		t.Fatalf("expected 1 thread, got %d", len(threadsL1))
	}
	th1 := threadsL1[0].(map[string]any)
	if th1["authorAgentId"] != soloL1.ID || th1["isolation"] != "none" {
		t.Fatalf("L0->L1 did not preserve author in-place or isolation=none: %+v", th1)
	}
	updatedSolo, _ := srv.store.GetAgent(soloL1.ID)
	if updatedSolo.Labels[chief.LabelRole] != chief.RoleAuthor || updatedSolo.Labels[chief.LabelChatterShield] != "true" {
		t.Fatalf("solo agent missing orchestration labels after L0->L1: %+v", updatedSolo.Labels)
	}

	repoL2 := t.TempDir()
	initTestGitRepo(t, repoL2)
	_, wsL2, err := srv.ensureWorkspaceForCwd(repoL2)
	if err != nil {
		t.Fatal(err)
	}
	soloL2 := store.AgentRecord{
		ID:          newAgentID(),
		Provider:    "mock",
		Cwd:         repoL2,
		WorkspaceID: wsL2.WorkspaceID,
		Title:       chiefStrPtr("Solo Feature"),
		LastStatus:  "idle",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}
	_ = srv.store.UpsertAgent(soloL2)
	mpSoloL2, err := srv.startOrGetPiAgent(soloL2)
	if err != nil {
		t.Fatal(err)
	}
	mpSoloL2.session.AppendTimelineItem(sdk.TimelineItem{Type: "user_message", MessageID: "u1", Text: "Refactor parser"})
	mpSoloL2.session.AppendTimelineItem(sdk.TimelineItem{Type: "assistant_message", MessageID: "a1", Text: "Started edits in draft.txt"})

	if err := os.WriteFile(filepath.Join(repoL2, "README.md"), []byte("dirty tracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoL2, "draft.txt"), []byte("untracked carry\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	failDirty := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId":   "req_fail_dirty",
		"soloAgentId": soloL2.ID,
		"targetTier":  "L2",
		"dirtyPolicy": "fail_if_dirty",
		"title":       "Should fail dirty",
	})
	if failDirty["error"] == nil {
		t.Fatalf("expected fail_if_dirty rejection on dirty checkout, got %+v", failDirty)
	}

	carryResp := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId":   "req_carry",
		"soloAgentId": soloL2.ID,
		"targetTier":  "L2",
		"dirtyPolicy": "carry_into_thread_1",
		"title":       "Carried feature",
		"goal":        "emit a synthetic notification",
	})
	if carryResp["error"] != nil {
		t.Fatalf("carry_into_thread_1 upgrade failed: %v", carryResp["error"])
	}
	mL2 := carryResp["mission"].(map[string]any)
	thL2 := mL2["threads"].([]any)[0].(map[string]any)
	if thL2["isolation"] != "worktree" {
		t.Fatalf("expected worktree isolation for L2, got %+v", thL2)
	}
	wtCwd := thL2["cwd"].(string)
	if wtCwd == repoL2 {
		t.Fatalf("L2 thread cwd must be worktree, got base repo %s", wtCwd)
	}
	carriedBytes, readErr := os.ReadFile(filepath.Join(wtCwd, "draft.txt"))
	if readErr != nil || string(carriedBytes) != "untracked carry\n" {
		t.Fatalf("carried untracked file missing in worktree %s: content=%q err=%v", wtCwd, string(carriedBytes), readErr)
	}
	baseStatus, _ := workspace.Git(t.Context(), repoL2, "status", "--porcelain")
	if strings.TrimSpace(baseStatus) != "" {
		t.Fatalf("base checkout should be clean after carry_into_thread_1, got: %q", baseStatus)
	}
	l2AuthorID := thL2["authorAgentId"].(string)
	waitForCondition(t, 2*time.Second, func() bool {
		srv.mu.Lock()
		mp := srv.agents[l2AuthorID]
		srv.mu.Unlock()
		if mp == nil || mp.session == nil {
			return false
		}
		for _, entry := range mp.session.Timeline() {
			if strings.Contains(entry.Item.Text, "Refactor parser") && strings.Contains(entry.Item.Text, "Started edits in draft.txt") {
				return true
			}
		}
		return false
	}, "L2 author seeded with buildForkContextAttachment history")
}

func TestChiefConfigValidationReloadLabelStrippingAndWorkspaceBuckets(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTestServer(t, t.TempDir())

	existingCfg := map[string]any{
		"agentProfiles": []any{
			map[string]any{"id": "p_strong", "name": "Strong", "provider": "mock", "tier": "strong"},
			map[string]any{"id": "p_fast", "name": "Fast", "provider": "mock", "tier": "fast"},
		},
	}
	if _, err := srv.store.SaveDaemonConfigChecked(existingCfg); err != nil {
		t.Fatal(err)
	}

	cfgResp := callChiefRPC(t, srv, "set_daemon_config_request", map[string]any{
		"requestId": "req_bad_cfg",
		"config": map[string]any{
			"chief": map[string]any{
				"roles": map[string]any{
					"author":   map[string]any{"primaryProfileId": "p_strong"},
					"verifier": map[string]any{"primaryProfileId": "p_fast"},
				},
			},
		},
	})
	if cfgResp["error"] == nil {
		t.Fatalf("expected merged config validation rejection for verifier tier < author tier, got %+v", cfgResp)
	}

	hasChiefReload := false
	for _, p := range reloadablePaths {
		if p == "daemon.chief" {
			hasChiefReload = true
			break
		}
	}
	if !hasChiefReload {
		t.Fatal("daemon.chief must be in reloadablePaths")
	}

	cwd := t.TempDir()
	_, ws, err := srv.ensureWorkspaceForCwd(cwd)
	if err != nil {
		t.Fatal(err)
	}
	userAgent := store.AgentRecord{
		ID:          newAgentID(),
		Provider:    "mock",
		Cwd:         cwd,
		WorkspaceID: ws.WorkspaceID,
		Labels:      map[string]string{"existing": "keep"},
		LastStatus:  "idle",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}
	_ = srv.store.UpsertAgent(userAgent)

	updResp := callChiefRPC(t, srv, "update_agent_request", map[string]any{
		"requestId": "req_upd",
		"agentId":   userAgent.ID,
		"labels": map[string]string{
			agentroles.RoleLabel:                   "chief",
			agentroles.AutoArchiveLabel:            "true",
			agentroles.OrchestrationRoleLabel:      "verifier",
			agentroles.OrchestrationMissionIDLabel: "mis_forged",
			"team":                                 "core",
		},
	})
	if updResp["accepted"] != true {
		t.Fatalf("update_agent failed: %+v", updResp)
	}
	afterUpd, _ := srv.store.GetAgent(userAgent.ID)
	if afterUpd.Labels[agentroles.RoleLabel] != "" || afterUpd.Labels[agentroles.AutoArchiveLabel] != "" ||
		afterUpd.Labels[agentroles.OrchestrationRoleLabel] != "" || afterUpd.Labels[agentroles.OrchestrationMissionIDLabel] != "" {
		t.Fatalf("reserved labels were not stripped: %+v", afterUpd.Labels)
	}
	if afterUpd.Labels["team"] != "core" || afterUpd.Labels["existing"] != "keep" {
		t.Fatalf("non-reserved labels lost: %+v", afterUpd.Labels)
	}

	chiefRec, _, err := srv.chief.findOrEnsureChiefAgent("", "")
	if err != nil {
		t.Fatal(err)
	}
	mFatal, err := srv.chief.store.CreateMission(chief.Mission{
		ID:           chief.NewID("mis"),
		Title:        "Status bucket mission",
		Goal:         "Surface fatal attention",
		ChiefAgentID: chiefRec.ID,
		BaseCwd:      chiefRec.Cwd,
		Tier:         chief.TierL1,
		Status:       chief.MissionStatusActive,
		SystemAttention: &chief.SystemAttention{
			Kind:     chief.AttentionKindVerifyEscalated,
			Severity: chief.SeverityFatal,
			Summary:  "tainted",
			Since:    time.Now().UTC().Format(time.RFC3339Nano),
		},
		Threads: []chief.Thread{},
	})
	if err != nil {
		t.Fatal(err)
	}
	buckets := srv.computeWorkspaceStatusBuckets()
	if buckets[chiefRec.WorkspaceID] != bucketFailed {
		t.Fatalf("expected Chief workspace bucket=%q for fatal SystemAttention, got %q", bucketFailed, buckets[chiefRec.WorkspaceID])
	}

	_, _ = srv.chief.store.UpdateMission(mFatal.ID, func(m *chief.Mission) error {
		m.Status = chief.MissionStatusWaitingHuman
		m.PendingDecision = &chief.HumanDecision{
			ID: "dec_status_bucket", Kind: "approve_plan", Title: "Human decision",
			Summary: "Choose how to proceed", Options: []chief.HumanDecisionOption{{ID: "approve", Label: "Approve"}},
			CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
		return nil
	})
	buckets = srv.computeWorkspaceStatusBuckets()
	if buckets[chiefRec.WorkspaceID] != bucketNeedsInput {
		t.Fatalf("expected Chief workspace bucket=%q for pending decision, got %q", bucketNeedsInput, buckets[chiefRec.WorkspaceID])
	}
}

func TestChiefStartLogsPendingBellRecoveryCorruption(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BYSPACE_HOME", home)
	srv := newTestServer(t, home)
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	mission, err := srv.chief.store.CreateMission(chief.Mission{
		ID: "mis_corrupt_replay", Title: "Corrupt replay", Goal: "Surface recovery errors",
		BaseCwd: t.TempDir(), Tier: chief.TierL0, Status: chief.MissionStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	eventsPath := filepath.Join(home, "orchestration", "missions", mission.ID, "events.jsonl")
	if err := os.WriteFile(eventsPath, []byte("{not-json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv.chief.Start()
	waitForCondition(t, 2*time.Second, func() bool { return strings.Contains(logs.String(), "replay pending Chief bells") }, "pending bell recovery error log")
	if !strings.Contains(logs.String(), mission.ID) {
		t.Fatalf("recovery log does not name corrupt mission %s: %s", mission.ID, logs.String())
	}
}

func TestNonNilPathsPreservesWhitespace(t *testing.T) {
	got := nonNilPaths([]string{"", " leading.txt ", "line\nbreak.txt", "plain.txt"})
	want := []string{" leading.txt ", "line\nbreak.txt", "plain.txt"}
	if len(got) != len(want) {
		t.Fatalf("nonNilPaths() = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("nonNilPaths()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestCollectGitChangedFilesPreservesWhitespaceAndNewlines(t *testing.T) {
	repo := t.TempDir()
	initTestGitRepo(t, repo)
	baseHead, err := workspace.Git(t.Context(), repo, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	paths := []string{" leading.txt", "space name.txt"}
	for _, name := range paths {
		if err := os.WriteFile(filepath.Join(repo, name), []byte("payload\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := workspace.Git(t.Context(), repo, "add", "--", "."); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.Git(t.Context(), repo, "commit", "-m", "whitespace paths"); err != nil {
		t.Fatal(err)
	}
	baseline := &gitCheckoutBaseline{headSha: strings.TrimSpace(baseHead)}
	srv := newTestServer(t, t.TempDir())
	changed := srv.chief.collectGitChangedFiles(t.Context(), repo, baseline)
	got := make(map[string]bool, len(changed))
	for _, name := range changed {
		got[name] = true
	}
	for _, name := range paths {
		if !got[name] {
			t.Errorf("collectGitChangedFiles() = %#v, missing exact path %q", changed, name)
		}
	}
}

func TestChiefTerminalVerifierMutationRaisesAttentionWithoutReopening(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	repo := t.TempDir()
	initTestGitRepo(t, repo)
	chiefRec := &store.AgentRecord{ID: "agt_terminal_chief", Cwd: repo, WorkspaceID: "ws_terminal"}
	if err := srv.store.UpsertAgent(*chiefRec); err != nil {
		t.Fatal(err)
	}
	verifier := newChiefFakeNonPiSession(repo, "sess_terminal_verifier", "native-verifier")
	verifierRec := store.AgentRecord{
		ID: "agt_terminal_verifier", Provider: "codex", Cwd: repo, WorkspaceID: "ws_terminal",
		Labels: chief.BuildOrchestrationLabels("mis_terminal", "thr_terminal", chief.RoleVerifier, true),
	}
	srv.agents[verifierRec.ID] = &managedPi{record: verifierRec, session: verifier}
	if err := srv.store.UpsertAgent(verifierRec); err != nil {
		t.Fatal(err)
	}
	_, err := srv.chief.store.CreateMission(chief.Mission{
		ID: "mis_terminal", Title: "Terminal mutation", Goal: "Keep landed work closed",
		ChiefAgentID: chiefRec.ID, BaseCwd: repo, BaseBranch: "main", Tier: chief.TierL2,
		Status: chief.MissionStatusCompleted,
		Threads: []chief.Thread{{
			ID: "thr_terminal", Title: "Landed", Goal: "Stay landed", AuthorAgentID: "agt_terminal_author",
			VerifierAgentID: verifierRec.ID, Branch: "feature/terminal", BaseRef: "main",
			OwnedPaths: []string{"terminal.txt"}, Cwd: repo, Status: chief.ThreadStatusLanded,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	srv.chief.capturePreTurnBaseline(verifierRec)
	if err := os.WriteFile(filepath.Join(repo, "terminal.txt"), []byte("late mutation\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv.chief.OnAgentTurnCompleted(t.Context(), verifierRec, "turn_terminal")
	mission, err := srv.chief.store.GetMission("mis_terminal")
	if err != nil {
		t.Fatal(err)
	}
	if mission.Threads[0].Status != chief.ThreadStatusLanded || mission.Status != chief.MissionStatusCompleted {
		t.Fatalf("terminal work reopened: mission=%s thread=%s", mission.Status, mission.Threads[0].Status)
	}
	persistedChief, err := srv.store.GetAgent(chiefRec.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !persistedChief.RequiresAttention {
		t.Fatalf("terminal verifier mutation did not raise human attention: %+v", persistedChief)
	}
}

func newL2RollbackFixture(t *testing.T) (*Server, string, string, store.AgentRecord) {
	t.Helper()
	t.Setenv("BYSPACE_NODE_ENV", "development")
	home := t.TempDir()
	srv := newTestServer(t, home)
	repo := t.TempDir()
	initTestGitRepo(t, repo)
	_, ws, err := srv.ensureWorkspaceForCwd(repo)
	if err != nil {
		t.Fatal(err)
	}
	solo := store.AgentRecord{
		ID: newAgentID(), Provider: "mock", Cwd: repo, WorkspaceID: ws.WorkspaceID,
		Title: chiefStrPtr("Solo rollback"), LastStatus: "idle",
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := srv.store.UpsertAgent(solo); err != nil {
		t.Fatal(err)
	}
	return srv, home, repo, solo
}

func l2ResourceSnapshot(t *testing.T, srv *Server) (map[string]bool, map[string]bool) {
	t.Helper()
	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := srv.store.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	agentIDs := make(map[string]bool, len(agents))
	workspaceIDs := make(map[string]bool, len(workspaces))
	for _, rec := range agents {
		agentIDs[rec.ID] = true
	}
	for _, rec := range workspaces {
		workspaceIDs[rec.WorkspaceID] = true
	}
	return agentIDs, workspaceIDs
}

func assertL2RollbackResources(t *testing.T, srv *Server, beforeAgents, beforeWorkspaces map[string]bool) {
	t.Helper()
	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	for _, rec := range agents {
		if beforeAgents[rec.ID] {
			continue
		}
		t.Errorf("unexpected agent record after rollback: id=%s role=%s labels=%v", rec.ID, rec.Labels[chief.LabelRole], rec.Labels)
		srv.mu.Lock()
		mp := srv.agents[rec.ID]
		srv.mu.Unlock()
		if mp != nil {
			t.Errorf("new worker still loaded after rollback: %s", rec.ID)
		}
	}
	workspaces, err := srv.store.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, rec := range workspaces {
		if !beforeWorkspaces[rec.WorkspaceID] && rec.ArchivedAt == nil && rec.Kind == "worktree" {
			t.Errorf("orphan active worktree workspace after rollback: %s at %s", rec.WorkspaceID, rec.Cwd)
		}
	}
}

func assertBaseDirtyContentRestored(t *testing.T, repo string) {
	t.Helper()
	readme, err := os.ReadFile(filepath.Join(repo, "README.md"))
	if err != nil || string(readme) != "dirty tracked\n" {
		t.Errorf("base tracked content not restored: %q err=%v", string(readme), err)
	}
	draft, err := os.ReadFile(filepath.Join(repo, "draft.txt"))
	if err != nil || string(draft) != "untracked carry\n" {
		t.Errorf("base untracked content not restored: %q err=%v", string(draft), err)
	}
}

func TestChiefL2SoloCreateMissionFailureRollsBackCarryAndWorkers(t *testing.T) {
	srv, home, repo, solo := newL2RollbackFixture(t)
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("dirty tracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "draft.txt"), []byte("untracked carry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeAgents, beforeWorkspaces := l2ResourceSnapshot(t, srv)
	srv.beforeWorktreeWorkspaceRegister = func(string) {
		root := filepath.Join(home, "orchestration", "missions")
		if err := os.RemoveAll(root); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(root), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(root, []byte("blocked"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	resp := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId": "req_l2_create_rollback", "soloAgentId": solo.ID, "targetTier": "L2",
		"dirtyPolicy": "carry_into_thread_1", "title": "Rollback create", "goal": "Restore base work",
	})
	if resp["error"] == nil {
		t.Fatalf("expected CreateMission failure, got %+v", resp)
	}
	assertBaseDirtyContentRestored(t, repo)
	assertL2RollbackResources(t, srv, beforeAgents, beforeWorkspaces)
	stashes, err := workspace.Git(t.Context(), repo, "stash", "list")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(stashes) != "" {
		t.Errorf("successful rollback retained a duplicate stash: %q", stashes)
	}
}

func TestChiefL2ExistingMissionUpdateFailureRollsBackOnlyNewResources(t *testing.T) {
	srv, home, repo, solo := newL2RollbackFixture(t)
	upgL1 := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId": "req_l1_before_l2_rollback", "soloAgentId": solo.ID, "targetTier": "L1", "title": "Existing mission",
	})
	if upgL1["error"] != nil {
		t.Fatalf("L1 setup failed: %v", upgL1["error"])
	}
	missionID := upgL1["mission"].(map[string]any)["id"].(string)
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("dirty tracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "draft.txt"), []byte("untracked carry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeAgents, beforeWorkspaces := l2ResourceSnapshot(t, srv)
	missionPath := filepath.Join(home, "orchestration", "missions", missionID, "mission.json")
	originalMissionJSON, err := os.ReadFile(missionPath)
	if err != nil {
		t.Fatal(err)
	}
	var originalMission chief.Mission
	if err := json.Unmarshal(originalMissionJSON, &originalMission); err != nil {
		t.Fatal(err)
	}
	srv.beforeWorktreeWorkspaceRegister = func(string) {
		if err := os.Remove(missionPath); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(missionPath, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	resp := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId": "req_l2_update_rollback", "missionId": missionID, "targetTier": "L2",
		"dirtyPolicy": "carry_into_thread_1", "title": "Rollback update", "goal": "Restore base work",
	})
	if err := os.RemoveAll(missionPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(missionPath, originalMissionJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	if resp["error"] == nil {
		t.Fatalf("expected UpdateMission failure, got %+v", resp)
	}
	assertBaseDirtyContentRestored(t, repo)
	assertL2RollbackResources(t, srv, beforeAgents, beforeWorkspaces)
	if originalMission.Tier != chief.TierL1 || len(originalMission.Threads) != 1 {
		t.Errorf("preexisting mission changed after failed update: tier=%s threads=%d", originalMission.Tier, len(originalMission.Threads))
	}
	for id := range beforeAgents {
		rec, getErr := srv.store.GetAgent(id)
		if getErr != nil || rec.ID != id {
			t.Errorf("preexisting agent %s was rolled back: rec=%+v err=%v", id, rec, getErr)
		}
	}
}

func TestChiefL2RollbackRestorationFailureRetainsStashAndWorktree(t *testing.T) {
	srv, _, repo, _ := newL2RollbackFixture(t)
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("dirty tracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "draft.txt"), []byte("untracked carry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prep, err := srv.chief.prepareL2Worktree(t.Context(), repo, "", "Retain recovery", "carry_into_thread_1")
	if err != nil {
		t.Fatalf("prepare carried worktree: %v", err)
	}
	worktreePath := prep.workspace.Cwd
	if carried, readErr := os.ReadFile(filepath.Join(worktreePath, "README.md")); readErr != nil || string(carried) != "dirty tracked\n" {
		t.Fatalf("carried worktree content missing before forced restore failure: %q err=%v", string(carried), readErr)
	}
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("conflicting base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rollbackErr := prep.abort(t.Context())
	if rollbackErr == nil {
		t.Fatal("expected conflicting base to make restoration fail")
	}
	errText := rollbackErr.Error()
	if !strings.Contains(errText, worktreePath) || !strings.Contains(errText, prep.stashSha) || !strings.Contains(errText, repo) {
		t.Errorf("rollback error does not name retained base/stash/worktree %q: %s", worktreePath, errText)
	}
	stashes, err := workspace.Git(t.Context(), repo, "stash", "list")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stashes, prep.stashSha[:12]) && !strings.Contains(stashes, "byspace-chief-upgrade-carry") {
		t.Errorf("restoration failure dropped the last stash copy: %s", stashes)
	}
	carried, readErr := os.ReadFile(filepath.Join(worktreePath, "README.md"))
	if readErr != nil || string(carried) != "dirty tracked\n" {
		t.Errorf("carried worktree content missing after restoration failure: %q err=%v", string(carried), readErr)
	}
	base, readErr := os.ReadFile(filepath.Join(repo, "README.md"))
	if readErr != nil || string(base) != "conflicting base\n" {
		t.Errorf("failed restoration overwrote conflicting base content: %q err=%v", string(base), readErr)
	}
}

func TestChiefL2ExistingMissionWithoutThreadAllocatesNoWorktree(t *testing.T) {
	srv, _, repo, solo := newL2RollbackFixture(t)
	mission, err := srv.chief.store.CreateMission(chief.Mission{
		ID: "mis_l2_no_thread", Title: "Tier only", Goal: "No worker", ChiefAgentID: solo.ID,
		BaseWorkspaceID: solo.WorkspaceID, BaseCwd: repo, BaseBranch: "main", Tier: chief.TierL0,
		Status: chief.MissionStatusActive, Threads: []chief.Thread{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "draft.txt"), []byte("untracked carry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, beforeWorkspaces := l2ResourceSnapshot(t, srv)
	resp := callChiefRPC(t, srv, "chief.mission.upgrade.request", map[string]any{
		"requestId": "req_l2_no_thread", "missionId": mission.ID, "targetTier": "L2", "dirtyPolicy": "carry_into_thread_1",
	})
	if resp["error"] != nil {
		t.Fatalf("tier-only upgrade failed: %v", resp)
	}
	workspaces, err := srv.store.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, rec := range workspaces {
		if !beforeWorkspaces[rec.WorkspaceID] && rec.Kind == "worktree" {
			t.Errorf("tier-only upgrade allocated unreferenced worktree: %s", rec.Cwd)
		}
	}
	draft, readErr := os.ReadFile(filepath.Join(repo, "draft.txt"))
	if readErr != nil || string(draft) != "untracked carry\n" {
		t.Errorf("tier-only upgrade carried away base dirt: %q err=%v", string(draft), readErr)
	}
}
