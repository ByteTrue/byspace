package chief

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type fakeMessenger struct {
	mu       sync.Mutex
	states   map[string]AgentRuntimeState
	loaded   []string
	sent     []sentPrompt
	failLoad map[string]error
	failSend map[string]error
	onSend   func(agentID, prompt string)
}

type sentPrompt struct {
	AgentID string
	Prompt  string
}

func newFakeMessenger() *fakeMessenger {
	return &fakeMessenger{
		states:   make(map[string]AgentRuntimeState),
		failLoad: make(map[string]error),
		failSend: make(map[string]error),
	}
}

func (f *fakeMessenger) GetAgentState(agentID string) AgentRuntimeState {
	f.mu.Lock()
	defer f.mu.Unlock()
	if st, ok := f.states[agentID]; ok {
		return st
	}
	return AgentRuntimeState{AgentID: agentID, Status: "closed", Loaded: false}
}

func (f *fakeMessenger) EnsureLoaded(_ context.Context, agentID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.failLoad[agentID]; err != nil {
		return err
	}
	f.loaded = append(f.loaded, agentID)
	st := f.states[agentID]
	st.AgentID = agentID
	st.Loaded = true
	if st.Status == "" || st.Status == "closed" {
		st.Status = "idle"
	}
	f.states[agentID] = st
	return nil
}

func (f *fakeMessenger) SendPrompt(_ context.Context, agentID, wrappedPrompt string) error {
	f.mu.Lock()
	if err := f.failSend[agentID]; err != nil {
		f.mu.Unlock()
		return err
	}
	f.sent = append(f.sent, sentPrompt{AgentID: agentID, Prompt: wrappedPrompt})
	cb := f.onSend
	f.mu.Unlock()
	if cb != nil {
		cb(agentID, wrappedPrompt)
	}
	return nil
}

func (f *fakeMessenger) sentFor(agentID string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range f.sent {
		if s.AgentID == agentID {
			out = append(out, s.Prompt)
		}
	}
	return out
}

func TestStoreAtomicityClampAndCrashRecovery(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)

	if _, err := st.GetMission("../escape"); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("expected ErrInvalidID for traversal path, got %v", err)
	}

	created, err := st.CreateMission(Mission{
		ID:              "msn_alpha",
		Title:           "Mission Alpha",
		Goal:            "Implement chief core",
		ChiefAgentID:    "ag_chief",
		ProjectID:       "prj_123",
		BaseWorkspaceID: "wks_123",
		BaseCwd:         homeDir,
		Tier:            TierL1,
		Threads: []Thread{
			{
				ID:            "thr_1",
				MissionID:     "msn_alpha",
				Title:         "Core",
				Goal:          "Build core",
				Cwd:           homeDir,
				Isolation:     IsolationNone,
				Status:        ThreadStatusAuthoring,
				AuthorAgentID: "ag_author",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}
	if created.Landing == nil || !created.Landing.RequireHumanApproval || created.Landing.Mode != "merge_local" || created.Landing.Strategy != "squash" {
		t.Fatalf("unexpected default landing policy: %+v", created.Landing)
	}

	missionFile := filepath.Join(homeDir, "orchestration", "missions", "msn_alpha", "mission.json")
	if _, statErr := os.Stat(missionFile); statErr != nil {
		t.Fatalf("expected mission.json at %s: %v", missionFile, statErr)
	}

	longSummary := strings.Repeat("界", 700)
	target := "ag_verifier"
	ev1, err := st.AppendEvent("msn_alpha", Event{
		Kind:          EventAuthorSubmitted,
		TargetAgentID: &target,
		Summary:       longSummary,
	})
	if err != nil {
		t.Fatalf("AppendEvent: %v", err)
	}
	if ev1.Seq != 1 {
		t.Fatalf("expected seq 1, got %d", ev1.Seq)
	}
	if gotRunes := utf8.RuneCountInString(ev1.Summary); gotRunes > MaxEventSummaryChars {
		t.Fatalf("summary exceeded %d runes: %d", MaxEventSummaryChars, gotRunes)
	}

	ev2 := Event{
		Seq:           2,
		Ts:            time.Now().UTC().Format(time.RFC3339Nano),
		MissionID:     "msn_alpha",
		Kind:          EventVerifyRejected,
		TargetAgentID: optStringPtr("ag_author"),
		Summary:       "Fix nil pointer",
	}
	line2, _ := json.Marshal(ev2)
	eventsPath := filepath.Join(homeDir, "orchestration", "missions", "msn_alpha", "events.jsonl")
	f, err := os.OpenFile(eventsPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open events.jsonl: %v", err)
	}
	_, _ = f.Write(append(line2, '\n'))
	_, _ = f.WriteString(`{"seq":3,"missionId":"msn_alpha","kind":"partial_torn_crash`)
	_ = f.Close()

	recovered, err := st.GetMission("msn_alpha")
	if err != nil {
		t.Fatalf("GetMission crash recovery: %v", err)
	}
	if recovered.HeadSeq != 2 {
		t.Fatalf("expected reconciled HeadSeq 2, got %d", recovered.HeadSeq)
	}
	bells, err := st.RecoverPendingBells()
	if err != nil {
		t.Fatalf("RecoverPendingBells: %v", err)
	}
	if len(bells) != 2 {
		t.Fatalf("expected 2 recovered pending bells, got %+v", bells)
	}

	found, err := st.FindMissionByThread("thr_1")
	if err != nil || found.ID != "msn_alpha" {
		t.Fatalf("FindMissionByThread failed: found=%v err=%v", found, err)
	}
}

func TestSnapshotAndChatterShieldHelpers(t *testing.T) {
	m := Mission{
		ID:           "msn_snap",
		ChiefAgentID: "ag_chief",
		BaseCwd:      "/tmp/repo",
		Tier:         TierL1,
		Status:       MissionStatusActive,
		SharedLocks:  map[string]string{"go.mod": "thr_1"},
		Threads: []Thread{
			{
				ID:                "thr_1",
				MissionID:         "msn_snap",
				Title:             "T1",
				Goal:              "G1",
				Cwd:               "/tmp/repo",
				Isolation:         IsolationNone,
				Status:            ThreadStatusAuthoring,
				AuthorAgentID:     "ag_a",
				VerifierAgentID:   "ag_v",
				AuthorTier:        TierStandard,
				VerifierTier:      TierStrong,
				VerifyRejectCount: 1,
			},
		},
	}

	snap := BuildMissionSnapshot(m, map[string]AgentRuntimeState{
		"ag_chief": {AgentID: "ag_chief", Status: "idle", Loaded: true},
		"ag_a":     {AgentID: "ag_a", Status: "running", Loaded: true},
	})
	if snap.ChiefAgentStatus == nil || *snap.ChiefAgentStatus != "idle" {
		t.Fatalf("expected chief status idle, got %v", snap.ChiefAgentStatus)
	}
	if snap.Threads[0].AuthorAgentStatus == nil || *snap.Threads[0].AuthorAgentStatus != "running" {
		t.Fatalf("expected author status running, got %v", snap.Threads[0].AuthorAgentStatus)
	}
	if snap.Threads[0].VerifierAgentStatus == nil || *snap.Threads[0].VerifierAgentStatus != "closed" {
		t.Fatalf("expected missing live verifier to overlay as closed, got %v", snap.Threads[0].VerifierAgentStatus)
	}

	workerLabels := BuildOrchestrationLabels("msn_snap", "thr_1", RoleAuthor, true)
	if !IsChatterShielded(workerLabels) {
		t.Fatal("expected worker labels to be chatter shielded")
	}
	if !ShouldSuppressWorkerAttention(workerLabels, "finished") {
		t.Fatal("expected chatter shield to suppress worker finished attention")
	}
	if !ShouldSuppressWorkerAttention(workerLabels, "error") {
		t.Fatal("expected chatter shield to suppress routine worker error attention")
	}
	if ShouldSuppressWorkerAttention(workerLabels, "permission") {
		t.Fatal("permission attention should not be silently suppressed by chatter shield")
	}

	chiefLabels := BuildOrchestrationLabels("msn_snap", "", RoleChief, true)
	if ShouldSuppressWorkerAttention(chiefLabels, "finished") {
		t.Fatal("Chief attention must never be suppressed")
	}
}

func TestClassifyProviderErrorAcrossProviders(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		errText  string
		want     ErrorClass
	}{
		{"opencode free usage quota", "opencode", "OpenCode Zen Free: Free usage limit reached (429: you can retry your request)", ErrorQuotaExhausted},
		{"claude 429 quota", "claude", "API Error: 429 quota", ErrorQuotaExhausted},
		{"codex insufficient quota", "codex", "You exceeded your current quota, please check your plan and billing details. insufficient_quota", ErrorQuotaExhausted},
		{"claude rate limit", "claude", `API Error: 429 {"type":"rate_limit_error"}`, ErrorRateLimited},
		{"acp too many requests", "acp", "HTTP 429 Too Many Requests; retry-after 30", ErrorRateLimited},
		{"claude auth", "claude", "401 authentication_error: invalid x-api-key", ErrorAuthError},
		{"codex login required", "codex", "Not logged in. Please run codex login.", ErrorAuthError},
		{"opencode provider auth", "opencode", "ProviderAuthError: API key expired", ErrorAuthError},
		{"pi context overflow", "pi", "prompt is too long: 210500 tokens > 200000 maximum context length", ErrorContextOverflow},
		{"codex context exceeded", "codex", "context_length_exceeded: reduce the length of the messages", ErrorContextOverflow},
		{"claude process crash", "claude", "claude process exited", ErrorProcessCrash},
		{"codex process crash", "codex", "codex process exited with exit status 137", ErrorProcessCrash},
		{"acp process crash", "acp", "acp process exited: unexpected EOF", ErrorProcessCrash},
		{"anthropic 529 overloaded", "claude", "API Error: 529 overloaded_error", ErrorTransient},
		{"network reset", "pi", "read tcp 127.0.0.1: ECONNRESET", ErrorTransient},
		{"missing binary", "acp", "spawn custom-agent failed: executable file not found in $PATH", ErrorFatal},
		{"claude max turns", "claude", "error_max_turns", ErrorFatal},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyProviderError(tc.provider, tc.errText)
			if got.Class != tc.want {
				t.Fatalf("ClassifyProviderError(%q, %q) = %s, want %s", tc.provider, tc.errText, got.Class, tc.want)
			}
		})
	}
}

func TestRoutingTierEnforcementAndFallbacks(t *testing.T) {
	daemonCfg := map[string]any{
		"agentProfiles": []any{
			map[string]any{"id": "p_fast", "name": "Fast", "provider": "pi", "tier": "fast"},
			map[string]any{"id": "p_std", "name": "Standard", "provider": "codex"},
			map[string]any{"id": "p_strong_1", "name": "Strong1", "provider": "claude", "tier": "strong"},
			map[string]any{"id": "p_strong_2", "name": "Strong2", "provider": "codex", "tier": "strong"},
		},
		"chief": map[string]any{
			"defaultTier": "L1",
			"roles": map[string]any{
				"author": map[string]any{
					"primaryProfileId":   "p_std",
					"fallbackProfileIds": []any{"p_fast"},
				},
				"verifier": map[string]any{
					"primaryProfileId":   "p_strong_1",
					"fallbackProfileIds": []any{"p_std", "p_fast"},
				},
			},
			"stall": map[string]any{
				"softWarningSec":  600,
				"hardRecoverySec": 1200,
			},
			"landing": map[string]any{
				"requireHumanApproval": true,
				"mode":                 "merge_local",
				"strategy":             "squash",
			},
		},
	}

	cfg, profiles, err := ParseRoutingConfig(daemonCfg)
	if err != nil {
		t.Fatalf("ParseRoutingConfig: %v", err)
	}
	if cfg.Stall.SoftWarningSec != 600 || cfg.Stall.HardRecoverySec != 1200 {
		t.Fatalf("unexpected stall config: %+v", cfg.Stall)
	}

	author, verifier, err := ResolveRolePairForThread(cfg, profiles, "", "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveRolePairForThread: %v", err)
	}
	if author.ID != "p_std" || author.Tier != TierStandard {
		t.Fatalf("expected p_std standard, got %+v", author)
	}
	if verifier.ID != "p_strong_1" || verifier.Tier != TierStrong {
		t.Fatalf("expected p_strong_1 strong, got %+v", verifier)
	}

	_, _, blockedErr := ResolveRolePairForThread(cfg, profiles, "p_strong_1", "p_std", nil, nil)
	if !errors.Is(blockedErr, ErrVerifierTierBlocked) {
		t.Fatalf("expected ErrVerifierTierBlocked, got %v", blockedErr)
	}

	_, fbErr := ResolveFallbackForRole(RoleVerifier, TierStrong, cfg, profiles, map[string]bool{"p_strong_1": true}, nil)
	if !errors.Is(fbErr, ErrVerifierTierBlocked) {
		t.Fatalf("expected ErrVerifierTierBlocked refusing silent downgrade, got %v", fbErr)
	}

	fb, fbOK := ResolveFallbackForRole(RoleVerifier, TierStandard, cfg, profiles, map[string]bool{"p_strong_1": true}, nil)
	if fbOK != nil || fb.ID != "p_std" {
		t.Fatalf("expected p_std fallback, got %+v err=%v", fb, fbOK)
	}
}

func TestRouterResumeOnBellCursorQueueAndBootReplay(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	router := NewRouter(st, RouterHooks{Messenger: msg})
	defer router.Close()

	_, err := st.CreateMission(Mission{
		ID:           "msn_bell",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		Tier:         TierL1,
		Status:       MissionStatusActive,
		Threads: []Thread{
			{
				ID:              "thr_1",
				MissionID:       "msn_bell",
				Title:           "Bell",
				Goal:            "Test bells",
				Cwd:             homeDir,
				Isolation:       IsolationNone,
				Status:          ThreadStatusAuthoring,
				AuthorAgentID:   "ag_author",
				VerifierAgentID: "ag_verifier",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	ctx := context.Background()

	msg.states["ag_verifier"] = AgentRuntimeState{AgentID: "ag_verifier", Status: "running", Loaded: true}
	_, err = st.AppendEvent("msn_bell", Event{
		ThreadID:      optStringPtr("thr_1"),
		Kind:          EventAuthorSubmitted,
		TargetAgentID: optStringPtr("ag_verifier"),
		Summary:       "First diff ready",
	})
	if err != nil {
		t.Fatalf("AppendEvent 1: %v", err)
	}
	if err := router.RingBell(ctx, "msn_bell", "ag_verifier", "submit"); err != nil {
		t.Fatalf("RingBell while running: %v", err)
	}
	if got := msg.sentFor("ag_verifier"); len(got) != 0 {
		t.Fatalf("expected 0 prompts while verifier running, got %d", len(got))
	}
	mMid, _ := st.GetMission("msn_bell")
	if mMid.Cursors["ag_verifier"] != 0 {
		t.Fatalf("cursor must remain 0 while deferred, got %d", mMid.Cursors["ag_verifier"])
	}

	_, err = st.AppendEvent("msn_bell", Event{
		ThreadID:      optStringPtr("thr_1"),
		Kind:          EventAuthorSubmitted,
		TargetAgentID: optStringPtr("ag_verifier"),
		Summary:       "Updated commit sha",
	})
	if err != nil {
		t.Fatalf("AppendEvent 2: %v", err)
	}

	msg.states["ag_verifier"] = AgentRuntimeState{AgentID: "ag_verifier", Status: "idle", Loaded: true}
	if err := router.OnAgentTurnCompleted(ctx, "ag_verifier", TurnCompletionContext{}); err != nil {
		t.Fatalf("OnAgentTurnCompleted: %v", err)
	}
	sent := msg.sentFor("ag_verifier")
	if len(sent) != 1 {
		t.Fatalf("expected 1 coalesced delta prompt on turn complete, got %d", len(sent))
	}
	if !sdk.IsSystemInjectedEnvelope(sent[0]) {
		t.Fatalf("bell prompt must be wrapped in <byspace-system>: %q", sent[0])
	}
	if !strings.Contains(sent[0], "#1") || !strings.Contains(sent[0], "#2") {
		t.Fatalf("expected delta #1 and #2 in envelope, got %q", sent[0])
	}
	mAfter, _ := st.GetMission("msn_bell")
	if mAfter.Cursors["ag_verifier"] != 2 || len(mAfter.PendingBells) != 0 {
		t.Fatalf("expected cursor=2 and empty pending bells, got cursor=%d bells=%+v", mAfter.Cursors["ag_verifier"], mAfter.PendingBells)
	}

	msg.states["ag_chief"] = AgentRuntimeState{AgentID: "ag_chief", Status: "closed", Loaded: false}
	msg.failSend["ag_chief"] = errors.New("temporary write error")
	_, err = st.AppendEvent("msn_bell", Event{
		ThreadID:      optStringPtr("thr_1"),
		Kind:          EventEscalatedToChief,
		TargetAgentID: optStringPtr("ag_chief"),
		Summary:       "Need chief attention",
	})
	if err != nil {
		t.Fatalf("AppendEvent 3: %v", err)
	}
	if err := router.RingBell(ctx, "msn_bell", "ag_chief", "escalation"); err == nil {
		t.Fatal("expected RingBell to surface SendPrompt error")
	}
	mErr, _ := st.GetMission("msn_bell")
	if mErr.Cursors["ag_chief"] != 0 {
		t.Fatalf("cursor must not advance on failed SendPrompt, got %d", mErr.Cursors["ag_chief"])
	}
	if mErr.PendingBells["ag_chief"] == nil || mErr.PendingBells["ag_chief"].Attempts != 1 {
		t.Fatalf("expected pending bell attempt=1, got %+v", mErr.PendingBells["ag_chief"])
	}

	delete(msg.failSend, "ag_chief")
	msg.states["ag_chief"] = AgentRuntimeState{AgentID: "ag_chief", Status: "closed", Loaded: false}
	rebootRouter := NewRouter(NewStore(homeDir), RouterHooks{Messenger: msg})
	defer rebootRouter.Close()
	if err := rebootRouter.ReplayPendingBells(ctx); err != nil {
		t.Fatalf("ReplayPendingBells: %v", err)
	}
	chiefPrompts := msg.sentFor("ag_chief")
	if len(chiefPrompts) != 1 || !strings.Contains(chiefPrompts[0], "#3") {
		t.Fatalf("expected boot replay to deliver #3 to chief, got %+v", chiefPrompts)
	}
	mFinal, _ := st.GetMission("msn_bell")
	if mFinal.Cursors["ag_chief"] != 3 || len(mFinal.PendingBells) != 0 {
		t.Fatalf("expected cursor=3 and cleared pending bell after boot replay, got cursor=%d bells=%+v", mFinal.Cursors["ag_chief"], mFinal.PendingBells)
	}
}

func TestRouterPeerLoopReject1VsReject2AndOwnershipAndMutationAudit(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	msg.states["ag_author"] = AgentRuntimeState{AgentID: "ag_author", Status: "idle", Loaded: true}
	msg.states["ag_verifier"] = AgentRuntimeState{AgentID: "ag_verifier", Status: "idle", Loaded: true}
	msg.states["ag_chief"] = AgentRuntimeState{AgentID: "ag_chief", Status: "idle", Loaded: true}

	var humanNotifs []SystemAttention
	router := NewRouter(st, RouterHooks{
		Messenger: msg,
		NotifyHuman: func(_ context.Context, _, _ string, att SystemAttention) {
			humanNotifs = append(humanNotifs, att)
		},
	})
	defer router.Close()

	_, err := st.CreateMission(Mission{
		ID:           "msn_peer",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		Tier:         TierL1,
		Status:       MissionStatusActive,
		SharedLocks:  map[string]string{"go.mod": "thr_1"},
		Threads: []Thread{
			{
				ID:              "thr_1",
				MissionID:       "msn_peer",
				Title:           "Auth",
				Goal:            "Implement auth",
				OwnedPaths:      []string{"internal/auth/"},
				Cwd:             homeDir,
				Isolation:       IsolationNone,
				Status:          ThreadStatusAuthoring,
				AuthorAgentID:   "ag_author",
				VerifierAgentID: "ag_verifier",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	ctx := context.Background()

	_, err = router.SubmitThread(ctx, SubmitThreadInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_author",
		Summary:      "touched outside",
		ChangedFiles: []string{"internal/server/server.go"},
	})
	if !errors.Is(err, ErrOwnedPathViolation) {
		t.Fatalf("expected ErrOwnedPathViolation, got %v", err)
	}

	_, err = router.SubmitThread(ctx, SubmitThreadInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_other",
		Summary:      "spoof",
		ChangedFiles: []string{"internal/auth/auth.go"},
	})
	if !errors.Is(err, ErrActorMismatch) {
		t.Fatalf("expected ErrActorMismatch, got %v", err)
	}

	m, err := router.SubmitThread(ctx, SubmitThreadInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_author",
		Summary:      "ready",
		ChangedFiles: []string{"internal/auth/auth.go", "go.mod"},
	})
	if err != nil {
		t.Fatalf("SubmitThread valid: %v", err)
	}
	if m.Threads[0].Status != ThreadStatusVerifying {
		t.Fatalf("expected verifying status, got %s", m.Threads[0].Status)
	}
	if len(msg.sentFor("ag_verifier")) != 1 || len(msg.sentFor("ag_chief")) != 0 {
		t.Fatalf("expected verifier=1 chief=0 prompts, got verifier=%d chief=%d", len(msg.sentFor("ag_verifier")), len(msg.sentFor("ag_chief")))
	}

	m, err = router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_verifier",
		Outcome:      "reject",
		Summary:      "Missing edge test",
		Issues:       []string{"add empty input test"},
	})
	if err != nil {
		t.Fatalf("RecordVerdict reject #1: %v", err)
	}
	if m.Threads[0].VerifyRejectCount != 1 || m.Threads[0].Status != ThreadStatusAuthoring {
		t.Fatalf("expected rejectCount=1 status=authoring, got count=%d status=%s", m.Threads[0].VerifyRejectCount, m.Threads[0].Status)
	}
	if len(msg.sentFor("ag_author")) != 1 || len(msg.sentFor("ag_chief")) != 0 {
		t.Fatalf("reject #1 must route to author only: author=%d chief=%d", len(msg.sentFor("ag_author")), len(msg.sentFor("ag_chief")))
	}

	_, err = router.SubmitThread(ctx, SubmitThreadInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_author",
		Summary:      "resubmitted",
		ChangedFiles: []string{"internal/auth/auth_test.go"},
	})
	if err != nil {
		t.Fatalf("resubmit: %v", err)
	}
	m, err = router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_peer",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_verifier",
		Outcome:      "reject",
		Summary:      "Still failing",
	})
	if err != nil {
		t.Fatalf("RecordVerdict reject #2: %v", err)
	}
	if m.Threads[0].VerifyRejectCount != 2 || m.Threads[0].Status != ThreadStatusBlocked {
		t.Fatalf("expected rejectCount=2 status=blocked, got count=%d status=%s", m.Threads[0].VerifyRejectCount, m.Threads[0].Status)
	}
	if len(msg.sentFor("ag_chief")) != 1 {
		t.Fatalf("reject >=2 must escalate to Chief, got %d chief prompts", len(msg.sentFor("ag_chief")))
	}

	m, err = router.AuditVerifierMutation(ctx, VerdictInput{
		MissionID:       "msn_peer",
		ThreadID:        "thr_1",
		ActorAgentID:    "ag_verifier",
		Outcome:         "pass",
		Summary:         "looks good",
		VerifierMutated: true,
		MutationDetails: "M internal/auth/auth.go",
	})
	if err != nil {
		t.Fatalf("AuditVerifierMutation tainted: %v", err)
	}
	if m.Threads[0].LastVerdict == nil || !m.Threads[0].LastVerdict.Tainted || m.Threads[0].Status != ThreadStatusBlocked {
		t.Fatalf("expected tainted verdict and blocked thread, got %+v", m.Threads[0])
	}
	if len(humanNotifs) != 1 {
		t.Fatalf("expected 1 human escalation for verifier mutation violation, got %d", len(humanNotifs))
	}
}

func TestRouterUnreportedTurnSafetyNetAndIncidentDedup(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	msg.states["ag_author"] = AgentRuntimeState{AgentID: "ag_author", Status: "idle", Loaded: true}

	var notifications []SystemAttention
	router := NewRouter(st, RouterHooks{
		Messenger: msg,
		NotifyHuman: func(_ context.Context, _, _ string, att SystemAttention) {
			notifications = append(notifications, att)
		},
	})
	defer router.Close()

	_, err := st.CreateMission(Mission{
		ID:           "msn_safe",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		Tier:         TierL1,
		Status:       MissionStatusActive,
		Threads: []Thread{
			{
				ID:            "thr_1",
				MissionID:     "msn_safe",
				Title:         "Safety",
				Goal:          "Safety net",
				Cwd:           homeDir,
				Isolation:     IsolationNone,
				Status:        ThreadStatusAuthoring,
				AuthorAgentID: "ag_author",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	ctx := context.Background()

	if err := router.OnAgentTurnCompleted(ctx, "ag_author", TurnCompletionContext{
		HasUnreportedChanges: true,
		ChangedFiles:         []string{"main.go"},
	}); err != nil {
		t.Fatalf("turn 1 complete: %v", err)
	}
	if err := router.OnAgentTurnCompleted(ctx, "ag_author", TurnCompletionContext{
		HasUnreportedChanges: true,
		ChangedFiles:         []string{"main.go"},
	}); err != nil {
		t.Fatalf("turn 2 complete: %v", err)
	}
	if got := msg.sentFor("ag_author"); len(got) != 1 {
		t.Fatalf("expected max 1 unreported-turn reminder, got %d", len(got))
	}

	if IsHumanActionableIncident(IncidentQuotaExhausted, false) {
		t.Fatal("quota_exhausted without fallback exhaustion should not notify human yet")
	}
	if !IsHumanActionableIncident(IncidentQuotaExhausted, true) {
		t.Fatal("quota_exhausted after fallback exhaustion must be human-actionable")
	}
	if !IsHumanActionableIncident(IncidentAuthError, false) {
		t.Fatal("auth_error must always be human-actionable")
	}

	att := SystemAttention{Kind: AttentionKindAuthError, Severity: SeverityFatal, Summary: "401 unauthorized"}
	sent1, err := router.RaiseIncident(ctx, "msn_safe", "thr_1", att, true)
	if err != nil || !sent1 {
		t.Fatalf("first RaiseIncident should notify: sent=%v err=%v", sent1, err)
	}
	sent2, err := router.RaiseIncident(ctx, "msn_safe", "thr_1", att, true)
	if err != nil || sent2 {
		t.Fatalf("duplicate RaiseIncident must be deduplicated: sent=%v err=%v", sent2, err)
	}
	if len(notifications) != 1 {
		t.Fatalf("expected 1 human notification, got %d", len(notifications))
	}

	if err := router.ResolveIncident("msn_safe", "thr_1", AttentionKindAuthError); err != nil {
		t.Fatalf("ResolveIncident: %v", err)
	}
	sent3, err := router.RaiseIncident(ctx, "msn_safe", "thr_1", att, true)
	if err != nil || !sent3 || len(notifications) != 2 {
		t.Fatalf("expected post-resolve RaiseIncident to notify again: sent=%v len=%d err=%v", sent3, len(notifications), err)
	}
}

func TestWatchdogDeadSessionAndZeroProgressThresholds(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)

	baseTime := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	now := baseTime
	st.now = func() time.Time { return now }

	_, err := st.CreateMission(Mission{
		ID:           "msn_wd",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		Tier:         TierL1,
		Status:       MissionStatusActive,
		Threads: []Thread{
			{
				ID:             "thr_1",
				MissionID:      "msn_wd",
				Title:          "Watch",
				Goal:           "Watchdog",
				Cwd:            homeDir,
				Isolation:      IsolationNone,
				Status:         ThreadStatusAuthoring,
				AuthorAgentID:  "ag_author",
				LastProgressAt: baseTime.Format(time.RFC3339Nano),
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	var mu sync.Mutex
	probe := AgentWatchSnapshot{Loaded: true, SessionStatus: "running"}
	var deadCount, softCount, hardCount int

	router := NewRouter(st, RouterHooks{Now: func() time.Time { return now }})
	defer router.Close()

	wd := NewWatchdog(WatchdogHooks{
		Store:  st,
		Router: router,
		Now:    func() time.Time { return now },
		ProbeAgent: func(agentID string) AgentWatchSnapshot {
			mu.Lock()
			defer mu.Unlock()
			return probe
		},
		OnDeadSession: func(context.Context, Mission, Thread, string, string, AgentWatchSnapshot) {
			deadCount++
		},
		OnSoftStall: func(context.Context, Mission, Thread, string, string, time.Duration) {
			softCount++
		},
		OnHardStall: func(context.Context, Mission, Thread, string, string, time.Duration) {
			hardCount++
		},
	})

	ctx := context.Background()

	now = baseTime.Add(599 * time.Second)
	wd.CheckOnce(ctx)
	if softCount != 0 || hardCount != 0 {
		t.Fatalf("expected no stall at 599s, got soft=%d hard=%d", softCount, hardCount)
	}

	now = baseTime.Add(600 * time.Second)
	wd.CheckOnce(ctx)
	wd.CheckOnce(ctx)
	if softCount != 1 || hardCount != 0 {
		t.Fatalf("expected soft=1 hard=0 at 600s, got soft=%d hard=%d", softCount, hardCount)
	}

	mu.Lock()
	probe.HasPendingPermission = true
	mu.Unlock()
	now = baseTime.Add(1200 * time.Second)
	wd.CheckOnce(ctx)
	if hardCount != 0 {
		t.Fatalf("expected pending permission to pause stall detection, got hard=%d", hardCount)
	}

	mu.Lock()
	probe.HasPendingPermission = false
	mu.Unlock()
	wd.CheckOnce(ctx)
	wd.CheckOnce(ctx)
	if hardCount != 1 {
		t.Fatalf("expected hard=1 at 1200s, got hard=%d", hardCount)
	}

	mu.Lock()
	probe.SessionStatus = "closed"
	probe.LastError = "process exited unexpectedly"
	mu.Unlock()
	wd.CheckOnce(ctx)
	if deadCount != 1 {
		t.Fatalf("expected immediate deadCount=1 on status==closed, got %d", deadCount)
	}

	wdStartStop := NewWatchdog(WatchdogHooks{
		Store:      st,
		Interval:   5 * time.Millisecond,
		ProbeAgent: func(string) AgentWatchSnapshot { return AgentWatchSnapshot{Loaded: true, SessionStatus: "idle"} },
	})
	wdStartStop.Start()
	wdStartStop.Stop()
	wdStartStop.Stop()
}

func TestRouterL2DryRunMergeCoalesceAndRebaseFlow(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	msg.states["ag_chief"] = AgentRuntimeState{AgentID: "ag_chief", Status: "idle", Loaded: true}
	msg.states["ag_author_1"] = AgentRuntimeState{AgentID: "ag_author_1", Status: "idle", Loaded: true}
	msg.states["ag_author_2"] = AgentRuntimeState{AgentID: "ag_author_2", Status: "idle", Loaded: true}
	msg.states["ag_ver_1"] = AgentRuntimeState{AgentID: "ag_ver_1", Status: "idle", Loaded: true}
	msg.states["ag_ver_2"] = AgentRuntimeState{AgentID: "ag_ver_2", Status: "idle", Loaded: true}
	msg.states["ag_int_2"] = AgentRuntimeState{AgentID: "ag_int_2", Status: "idle", Loaded: true}

	cleanMap := map[string]bool{"thr_1": true, "thr_2": true}
	var mu sync.Mutex
	var scheduled []func()

	router := NewRouter(st, RouterHooks{
		Messenger:          msg,
		WakeCoalesceWindow: 2 * time.Second,
		ScheduleCoalesceTimer: func(_ time.Duration, fn func()) func() {
			mu.Lock()
			scheduled = append(scheduled, fn)
			mu.Unlock()
			return func() {}
		},
		DryRunMerge: func(_ context.Context, m Mission, th Thread) (MergeDryRunResult, error) {
			mu.Lock()
			clean := cleanMap[th.ID]
			mu.Unlock()
			res := MergeDryRunResult{
				Clean:     clean,
				TargetRef: "main",
				SourceRef: th.Branch,
				CheckedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}
			if !clean {
				res.ConflictingFiles = []string{"shared.go"}
			}
			return res, nil
		},
	})
	defer router.Close()

	_, err := st.CreateMission(Mission{
		ID:           "msn_l2",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		BaseBranch:   "main",
		Tier:         TierL2,
		Status:       MissionStatusActive,
		Threads: []Thread{
			{
				ID:              "thr_1",
				MissionID:       "msn_l2",
				Title:           "T1",
				Goal:            "G1",
				Cwd:             homeDir,
				Branch:          "feat/1",
				BaseRef:         "main",
				Isolation:       IsolationWorktree,
				Status:          ThreadStatusVerifying,
				AuthorAgentID:   "ag_author_1",
				VerifierAgentID: "ag_ver_1",
			},
			{
				ID:                "thr_2",
				MissionID:         "msn_l2",
				Title:             "T2",
				Goal:              "G2",
				Cwd:               homeDir,
				Branch:            "feat/2",
				BaseRef:           "main",
				Isolation:         IsolationWorktree,
				Status:            ThreadStatusVerifying,
				OwnedPaths:        []string{"src/"},
				AuthorAgentID:     "ag_author_2",
				VerifierAgentID:   "ag_ver_2",
				IntegratorAgentID: "ag_int_2",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	ctx := context.Background()

	if _, err := router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_l2",
		ThreadID:     "thr_1",
		ActorAgentID: "ag_ver_1",
		Outcome:      "pass",
		Summary:      "clean 1",
	}); err != nil {
		t.Fatalf("verdict thr_1: %v", err)
	}
	if _, err := router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_l2",
		ThreadID:     "thr_2",
		ActorAgentID: "ag_ver_2",
		Outcome:      "pass",
		Summary:      "clean 2",
	}); err != nil {
		t.Fatalf("verdict thr_2: %v", err)
	}

	mu.Lock()
	timerCount := len(scheduled)
	var fire func()
	if timerCount > 0 {
		fire = scheduled[0]
	}
	mu.Unlock()
	if timerCount != 1 {
		t.Fatalf("expected exactly 1 coalesced wake timer scheduled, got %d", timerCount)
	}
	if gotBefore := len(msg.sentFor("ag_chief")); gotBefore != 0 {
		t.Fatalf("expected 0 Chief wakes before coalesce timer fires, got %d", gotBefore)
	}
	fire()

	chiefMsgs := msg.sentFor("ag_chief")
	if len(chiefMsgs) != 1 || !strings.Contains(chiefMsgs[0], "thr_1") || !strings.Contains(chiefMsgs[0], "thr_2") {
		t.Fatalf("expected 1 coalesced Chief wake containing thr_1 and thr_2, got %+v", chiefMsgs)
	}

	if _, err := st.UpdateMission("msn_l2", func(m *Mission) error {
		th := findThread(m, "thr_2")
		th.Status = ThreadStatusAuthoring
		th.LastVerdict = nil
		th.MergeCheck = nil
		return nil
	}); err != nil {
		t.Fatalf("prepare fresh thr_2 revision: %v", err)
	}
	if _, err := router.SubmitThread(ctx, SubmitThreadInput{
		MissionID: "msn_l2", ThreadID: "thr_2", ActorAgentID: "ag_author_2",
		Summary: "new revision", ChangedFiles: []string{"src/two.go"},
	}); err != nil {
		t.Fatalf("submit conflict #1: %v", err)
	}
	mu.Lock()
	cleanMap["thr_2"] = false
	mu.Unlock()
	m, err := router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_l2",
		ThreadID:     "thr_2",
		ActorAgentID: "ag_ver_2",
		Outcome:      "pass",
		Summary:      "verified code, check merge",
	})
	if err != nil {
		t.Fatalf("verdict conflict #1: %v", err)
	}
	if m.Threads[1].Status != ThreadStatusNeedsRebase || m.Threads[1].RebaseAttempts != 1 {
		t.Fatalf("expected needs_rebase with RebaseAttempts=1, got %+v", m.Threads[1])
	}
	if len(msg.sentFor("ag_author_2")) != 1 || len(msg.sentFor("ag_int_2")) != 0 {
		t.Fatalf("conflict #1 should route to author_2 only: author=%d int=%d", len(msg.sentFor("ag_author_2")), len(msg.sentFor("ag_int_2")))
	}

	if _, err = router.SubmitThread(ctx, SubmitThreadInput{
		MissionID: "msn_l2", ThreadID: "thr_2", ActorAgentID: "ag_author_2",
		Summary: "rebased", ChangedFiles: []string{"src/two.go"},
	}); err != nil {
		t.Fatalf("resubmit conflict #2: %v", err)
	}
	m, err = router.RecordVerdict(ctx, VerdictInput{
		MissionID:    "msn_l2",
		ThreadID:     "thr_2",
		ActorAgentID: "ag_ver_2",
		Outcome:      "pass",
		Summary:      "reverified after rebase, check merge",
	})
	if err != nil {
		t.Fatalf("verdict conflict #2: %v", err)
	}
	if len(msg.sentFor("ag_int_2")) != 1 {
		t.Fatalf("conflict #2 should route to integrator ag_int_2, got %d", len(msg.sentFor("ag_int_2")))
	}
}

func TestRouterConcurrentRingBellSerialized(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	msg.states["ag_chief"] = AgentRuntimeState{AgentID: "ag_chief", Status: "idle", Loaded: true}
	router := NewRouter(st, RouterHooks{Messenger: msg})
	defer router.Close()

	_, err := st.CreateMission(Mission{
		ID:           "msn_conc",
		ChiefAgentID: "ag_chief",
		BaseCwd:      homeDir,
		Tier:         TierL1,
		Status:       MissionStatusActive,
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	ctx := context.Background()
	for i := 0; i < 10; i++ {
		_, err := st.AppendEvent("msn_conc", Event{
			Kind:          EventThreadCreated,
			TargetAgentID: optStringPtr("ag_chief"),
			Summary:       "event",
		})
		if err != nil {
			t.Fatalf("AppendEvent %d: %v", i, err)
		}
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = router.RingBell(ctx, "msn_conc", "ag_chief", "concurrent")
		}()
	}
	wg.Wait()

	m, err := st.GetMission("msn_conc")
	if err != nil {
		t.Fatalf("GetMission: %v", err)
	}
	if m.Cursors["ag_chief"] != 10 {
		t.Fatalf("expected cursor 10, got %d", m.Cursors["ag_chief"])
	}
	seenSeqs := make(map[string]int)
	for _, prompt := range msg.sentFor("ag_chief") {
		for _, line := range strings.Split(prompt, "\n") {
			if strings.HasPrefix(line, "- #") {
				seqTag := strings.SplitN(line, " ", 3)[1]
				seenSeqs[seqTag]++
				if seenSeqs[seqTag] > 1 {
					t.Fatalf("duplicate delivery of %s across concurrent RingBell calls", seqTag)
				}
			}
		}
	}
	if len(seenSeqs) != 10 {
		t.Fatalf("expected all 10 unique event seqs delivered, got %d", len(seenSeqs))
	}
}
