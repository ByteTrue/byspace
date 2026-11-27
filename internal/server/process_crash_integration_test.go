package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

const (
	serverCodexHelperEnv         = "BYSPACE_SERVER_CODEX_HELPER"
	serverCodexFailRestartEnv    = "BYSPACE_SERVER_CODEX_FAIL_RESTART"
	serverCodexCaptureEnv        = "BYSPACE_SERVER_CODEX_CAPTURE"
	serverCodexCrashProviderName = "crash-codex"
)

func TestServerCodexCrashHelper(t *testing.T) {
	if os.Getenv(serverCodexHelperEnv) != "1" {
		return
	}
	if marker := os.Getenv(serverCodexFailRestartEnv); marker != "" {
		if _, err := os.Stat(marker); err == nil {
			os.Exit(31)
		}
		if err := os.WriteFile(marker, []byte("restart must fail\n"), 0o600); err != nil {
			os.Exit(32)
		}
	}

	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		if capture := os.Getenv(serverCodexCaptureEnv); capture != "" {
			if f, err := os.OpenFile(capture, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
				_, _ = f.Write(append(line, '\n'))
				_ = f.Close()
			}
		}
		var req map[string]any
		if json.Unmarshal(line, &req) != nil {
			continue
		}
		method, _ := req["method"].(string)
		if method == "turn/start" && strings.Contains(string(line), "crash-now") {
			os.Exit(23)
		}
		id, hasID := req["id"]
		if !hasID {
			continue
		}
		result := map[string]any{}
		switch method {
		case "thread/start", "thread/resume":
			result = map[string]any{"thread": map[string]any{"id": "thr_server_helper"}}
		case "turn/start":
			result = map[string]any{"turn": map[string]any{"id": "turn_server_helper"}}
		case "collaborationMode/list":
			result = map[string]any{"data": []any{
				map[string]any{"name": "Default", "mode": "code"},
				map[string]any{"name": "Plan", "mode": "plan", "developer_instructions": "read only plan"},
			}}
		}
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result}); err != nil {
			os.Exit(33)
		}
	}
	os.Exit(0)
}

func configureServerCrashCodex(t *testing.T, srv *Server) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv.store.SaveDaemonConfig(map[string]any{"providers": map[string]any{
		serverCodexCrashProviderName: map[string]any{
			"extends": "codex",
			"command": []string{exe, "-test.run=^TestServerCodexCrashHelper$", "--"},
		},
	}})
}

func serverCrashAgentRecord(providerID, agentID, cwd string, extraEnv map[string]string) store.AgentRecord {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	env := map[string]string{serverCodexHelperEnv: "1"}
	for key, value := range extraEnv {
		env[key] = value
	}
	return store.AgentRecord{
		ID: agentID, Provider: providerID, Cwd: cwd,
		CreatedAt: now, UpdatedAt: now, LastStatus: "idle",
		Labels: map[string]string{}, Config: &store.AgentConfig{Env: env},
	}
}

func closeReplacementOnCleanup(t *testing.T, srv *Server, agentID string) {
	t.Helper()
	t.Cleanup(func() {
		srv.mu.Lock()
		mp := srv.agents[agentID]
		srv.mu.Unlock()
		if mp != nil && mp.session != nil {
			_ = mp.session.Close()
		}
	})
}

func TestServerDerivedCodexVerifierLaunchPosture(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	configureServerCrashCodex(t, srv)
	capture := filepath.Join(t.TempDir(), "requests.jsonl")
	rec := serverCrashAgentRecord(serverCodexCrashProviderName, "agt_derived_codex_verifier", t.TempDir(), map[string]string{serverCodexCaptureEnv: capture})
	rec.Labels = chief.BuildOrchestrationLabels("msn_derived_launch", "thr_derived_launch", chief.RoleVerifier, true)
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	mp, err := srv.startOrGetPiAgent(rec)
	if err != nil {
		t.Fatal(err)
	}
	defer mp.session.Close()
	if err := mp.session.Prompt(t.Context(), "inspect only", nil); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	var threadConfig, turnConfig, sandboxPolicy, collaboration map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		var req map[string]any
		if json.Unmarshal([]byte(line), &req) != nil {
			continue
		}
		params, _ := req["params"].(map[string]any)
		switch req["method"] {
		case "thread/start":
			threadConfig, _ = params["config"].(map[string]any)
		case "turn/start":
			turnConfig, _ = params["config"].(map[string]any)
			sandboxPolicy, _ = params["sandboxPolicy"].(map[string]any)
			collaboration, _ = params["collaborationMode"].(map[string]any)
		}
	}
	if threadConfig["sandbox_mode"] != "read-only" || threadConfig["approval_policy"] != "never" ||
		turnConfig["sandbox_mode"] != "read-only" || turnConfig["approval_policy"] != "never" {
		t.Fatalf("derived Codex verifier launch did not enforce read-only + never: thread=%v turn=%v", threadConfig, turnConfig)
	}
	if sandboxPolicy["type"] != "readOnly" || collaboration["mode"] != "plan" {
		t.Fatalf("derived Codex verifier turn posture = sandbox %v collaboration %v", sandboxPolicy, collaboration)
	}
	if mp.record.Provider != serverCodexCrashProviderName {
		t.Fatalf("derived provider identity changed to %q", mp.record.Provider)
	}
}

func TestServerOrchestratedProcessCrashUsesSingleRecoveryPath(t *testing.T) {
	for _, tc := range []struct {
		name        string
		failRestart bool
	}{
		{name: "cold_resume"},
		{name: "recovery_exhaustion", failRestart: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BYSPACE_NODE_ENV", "development")
			repo := t.TempDir()
			initTestGitRepo(t, repo)
			srv := newTestServer(t, t.TempDir())
			configureServerCrashCodex(t, srv)
			created := callChiefRPC(t, srv, "chief.mission.create.request", map[string]any{
				"requestId": "req_crash_mission", "goal": "real process crash recovery", "tier": "L1", "baseCwd": repo,
			})
			mission := created["mission"].(map[string]any)
			missionID := mission["id"].(string)
			chiefID := mission["chiefAgentId"].(string)
			thread := callChiefRPC(t, srv, "chief.thread.create.request", map[string]any{
				"requestId": "req_crash_thread", "missionId": missionID, "title": "Crash worker", "goal": "recover",
			})["thread"].(map[string]any)
			authorID := thread["authorAgentId"].(string)
			author, err := srv.store.GetAgent(authorID)
			if err != nil || author == nil {
				t.Fatalf("load author: %v", err)
			}
			author.Provider = serverCodexCrashProviderName
			if author.Config == nil {
				author.Config = &store.AgentConfig{}
			}
			author.Config.Env = map[string]string{serverCodexHelperEnv: "1"}
			if tc.failRestart {
				author.Config.Env[serverCodexFailRestartEnv] = filepath.Join(t.TempDir(), "restart.marker")
			}
			if err := srv.store.UpsertAgent(*author); err != nil {
				t.Fatal(err)
			}
			srv.mu.Lock()
			existing := srv.agents[authorID]
			delete(srv.agents, authorID)
			srv.mu.Unlock()
			if existing != nil && existing.session != nil {
				_ = existing.session.Close()
			}
			closeReplacementOnCleanup(t, srv, authorID)

			mp, err := srv.startOrGetPiAgent(*author)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			if err := mp.session.Prompt(ctx, "crash-now", nil); err == nil {
				t.Fatal("crash prompt unexpectedly succeeded")
			}

			if !tc.failRestart {
				waitForCondition(t, 10*time.Second, func() bool {
					srv.mu.Lock()
					defer srv.mu.Unlock()
					replacement := srv.agents[authorID]
					return replacement != nil && replacement != mp && replacement.session != nil && replacement.session.Status() != "closed"
				}, "real cold-resume replacement")
				waitForCondition(t, 5*time.Second, func() bool {
					m, _ := srv.chief.store.GetMission(missionID)
					return m != nil && len(m.Threads) > 0 && m.Threads[0].SystemAttention != nil &&
						m.Threads[0].SystemAttention.AutoActionTaken != nil && *m.Threads[0].SystemAttention.AutoActionTaken == "cold_resume"
				}, "cold-resume recovery action")
				time.Sleep(200 * time.Millisecond)
				chiefRec, _ := srv.store.GetAgent(chiefID)
				if chiefRec == nil || chiefRec.RequiresAttention {
					t.Fatalf("competing crash path escalated successful recovery: %+v", chiefRec)
				}
			} else {
				waitForCondition(t, 10*time.Second, func() bool {
					chiefRec, _ := srv.store.GetAgent(chiefID)
					return chiefRec != nil && chiefRec.RequiresAttention
				}, "recovery exhaustion attention")
			}

			events, err := srv.chief.store.ReadEvents(missionID, 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			crashes := 0
			for _, event := range events {
				if event.Kind == chief.EventProcessCrashed {
					crashes++
				}
			}
			wantCrashes := 0
			if tc.failRestart {
				wantCrashes = 1
			}
			if crashes != wantCrashes {
				t.Fatalf("process_crashed events = %d, want %d: %+v", crashes, wantCrashes, events)
			}
		})
	}
}

func TestServerWaitForFinishAfterRealProcessCrash(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	configureServerCrashCodex(t, srv)
	rec := serverCrashAgentRecord(serverCodexCrashProviderName, "agt_late_crash_waiter", t.TempDir(), nil)
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	mp, err := srv.startOrGetPiAgent(rec)
	if err != nil {
		t.Fatal(err)
	}
	closeReplacementOnCleanup(t, srv, rec.ID)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := mp.session.Prompt(ctx, "crash-now", nil); err == nil {
		t.Fatal("crash prompt unexpectedly succeeded")
	}
	waitForCondition(t, 5*time.Second, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return srv.agents[rec.ID] == nil
	}, "crashed session removal")

	stored, err := srv.store.GetAgent(rec.ID)
	if err != nil || stored == nil {
		t.Fatalf("load crashed record: %v", err)
	}
	if stored.LastStatus != "error" || stored.LastError == nil || !strings.Contains(*stored.LastError, "codex process exited") {
		t.Errorf("crash was not persisted for late waiters: status=%q error=%v", stored.LastStatus, stored.LastError)
	}
	response := callChiefRPCUnbound(t, srv, "wait_for_finish_request", map[string]any{"requestId": "wait_after_real_crash", "agentId": rec.ID})
	if response["status"] != "error" || !strings.Contains(fmt.Sprint(response["error"]), "codex process exited") {
		t.Errorf("late wait response = %+v, want retained crash error", response)
	}
	srv.mu.Lock()
	reloaded := srv.agents[rec.ID] != nil
	srv.mu.Unlock()
	if reloaded {
		t.Error("late wait cold-loaded a replacement session instead of reporting the crash")
	}
}
