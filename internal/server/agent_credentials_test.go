package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/coder/websocket"
)

func TestAgentCredentialPersistsAcrossRestartWithoutLeaking(t *testing.T) {
	home := t.TempDir()
	srv, err := New(Options{HomeDir: home})
	if err != nil {
		t.Fatal(err)
	}
	rec := store.AgentRecord{ID: "agt_stable", Cwd: t.TempDir(), Provider: "mock", Config: &store.AgentConfig{
		Env: map[string]string{"BYSPACE_AGENT_CREDENTIAL": "attacker-controlled"},
	}}
	token, err := srv.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || token == "attacker-controlled" {
		t.Fatal("generated credential is empty or inherited from agent configuration")
	}
	env, err := srv.agentEnvForLaunch(rec)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "BYSPACE_AGENT_ID="+rec.ID) || !strings.Contains(joined, "BYSPACE_AGENT_CREDENTIAL="+token) || strings.Contains(joined, "attacker-controlled") {
		t.Fatal("agent credential environment is not authoritative")
	}
	public, err := json.Marshal(map[string]any{"record": rec, "snapshot": srv.buildAgentSnapshotPayload(rec)})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(public), token) {
		t.Fatal("agent credential leaked into public record or snapshot")
	}
	entries, err := os.ReadDir(filepath.Join(home, "agent-credentials"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("private credential files = %v, err=%v", entries, err)
	}
	if runtime.GOOS != "windows" {
		dirInfo, err := os.Stat(filepath.Join(home, "agent-credentials"))
		if err != nil {
			t.Fatal(err)
		}
		if got := dirInfo.Mode().Perm(); got != 0o700 {
			t.Fatalf("credential directory mode = %o, want 700", got)
		}
		info, err := entries[0].Info()
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("credential file mode = %o, want 600", got)
		}
	}
	if err := srv.Close(); err != nil {
		t.Fatal(err)
	}

	restarted, err := New(Options{HomeDir: home})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if err := restarted.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	stable, err := restarted.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stable != token {
		t.Fatal("agent credential changed across daemon restart")
	}
	other, err := restarted.ensureAgentCredential("agt_other")
	if err != nil {
		t.Fatal(err)
	}
	if other == token {
		t.Fatal("distinct agents received the same credential")
	}
}

func TestAgentCredentialRequiresExistingAgentIdentity(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	token, err := srv.ensureAgentCredential("agt_lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := srv.agentIDForCredential(token); ok {
		t.Fatal("credential authenticated before its agent identity existed")
	}
	rec := store.AgentRecord{ID: "agt_lifecycle", Cwd: t.TempDir(), Provider: "mock"}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	if id, ok := srv.agentIDForCredential(token); !ok || id != rec.ID {
		t.Fatalf("live agent credential did not authenticate: id=%q ok=%v", id, ok)
	}
	if err := srv.store.DeleteAgent(rec.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := srv.agentIDForCredential(token); ok {
		t.Fatal("deleted agent identity could still authenticate")
	}
}

func TestAgentCredentialPersistenceFailureFailsProviderLaunchClosed(t *testing.T) {
	home := t.TempDir()
	srv, err := New(Options{HomeDir: home})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	if err := os.WriteFile(filepath.Join(home, "agent-credentials"), []byte("blocks directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := store.AgentRecord{ID: "agt_no_launch", Cwd: t.TempDir(), Provider: "mock"}
	mp, err := srv.startOrGetPiAgent(rec)
	if err == nil || !strings.Contains(err.Error(), "credential") {
		t.Fatalf("provider launch did not fail on credential persistence: session=%v err=%v", mp, err)
	}
	srv.mu.Lock()
	_, launched := srv.agents[rec.ID]
	srv.mu.Unlock()
	if launched {
		t.Fatal("managed provider session exists despite credential issuance failure")
	}
}

func TestAgentCredentialDirectWSAuthBindingAndCleanup(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	setDaemonPassword(t, srv, "operator-password")
	rec := store.AgentRecord{ID: "agt_direct", Cwd: t.TempDir(), Provider: "mock"}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	token, err := srv.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(srv)
	defer httpServer.Close()
	operatorReq, err := http.NewRequest(http.MethodGet, httpServer.URL+"/api/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	operatorReq.Header.Set("Authorization", "Bearer "+token)
	operatorResp, err := http.DefaultClient.Do(operatorReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = operatorResp.Body.Close()
	if operatorResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("agent credential reached operator API: status=%d", operatorResp.StatusCode)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"agent-auth-test","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	_, payload, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), "server_info") || strings.Contains(string(payload), token) {
		t.Fatal("unexpected or credential-leaking handshake response")
	}
	srv.mu.Lock()
	bound := 0
	for _, agentID := range srv.sinkAgentIDs {
		if agentID == rec.ID {
			bound++
		}
	}
	srv.mu.Unlock()
	if bound != 1 {
		t.Fatalf("direct socket agent bindings = %d, want 1", bound)
	}
	if err := ws.Write(ctx, websocket.MessageText, []byte(agentCredentialRPCFrame("agent_pairing", "daemon.get_pairing_offer.request"))); err != nil {
		t.Fatal(err)
	}
	_, pairing, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pairing), "Permission denied for daemon.get_pairing_offer.request") {
		t.Fatalf("agent credential invoked access.manage pairing offer over direct WS: %s", pairing)
	}
	if err := ws.Write(ctx, websocket.MessageText, []byte(agentCredentialRPCFrame("agent_missions", "chief.mission.list.request"))); err != nil {
		t.Fatal(err)
	}
	_, missions, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(missions), "chief.mission.list.response") || strings.Contains(string(missions), "Permission denied") {
		t.Fatalf("agent credential lost necessary Chief read permission: %s", missions)
	}
	_ = ws.Close(websocket.StatusNormalClosure, "done")
	waitForCondition(t, 3*time.Second, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.sinkAgentIDs) == 0
	}, "direct agent binding cleanup")
}

func agentCredentialRPCFrame(requestID, method string) string {
	raw, _ := json.Marshal(map[string]any{
		"type":    "session",
		"message": map[string]any{"type": method, "requestId": requestID},
	})
	return string(raw)
}

func TestAgentRelayCredentialBindsAndCleansUp(t *testing.T) {
	home := t.TempDir()
	srv, err := New(Options{HomeDir: home})
	if err != nil {
		t.Fatal(err)
	}
	rec := store.AgentRecord{ID: "agt_relay", Cwd: t.TempDir(), Provider: "mock"}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	token, err := srv.ensureAgentCredential(rec.ID)
	if err != nil {
		t.Fatal(err)
	}
	conn, shared, cleanup := relaySession(t, srv)
	writeEncrypted(t, conn, shared, passwordFrame(token))
	reply := readEncrypted(t, conn, shared)
	if !strings.Contains(reply, `"ok":true`) || strings.Contains(reply, token) {
		t.Fatal("relay agent credential rejected or leaked")
	}
	srv.mu.Lock()
	bound := 0
	operator := false
	for sink, agentID := range srv.sinkAgentIDs {
		if agentID == rec.ID {
			bound++
			operator = operator || srv.relayPasswordAuthed[sink]
		}
	}
	srv.mu.Unlock()
	if bound != 1 {
		t.Fatalf("relay sink agent bindings = %d, want 1", bound)
	}
	if operator {
		t.Fatal("agent credential became an operator relay session")
	}
	writeEncrypted(t, conn, shared, agentCredentialRPCFrame("agent_relay_pairing", "daemon.get_pairing_offer.request"))
	pairing := readEncrypted(t, conn, shared)
	if !strings.Contains(pairing, "Permission denied for daemon.get_pairing_offer.request") {
		t.Fatalf("agent credential invoked access.manage pairing offer over relay: %s", pairing)
	}
	writeEncrypted(t, conn, shared, agentCredentialRPCFrame("agent_relay_missions", "chief.mission.list.request"))
	missions := readEncrypted(t, conn, shared)
	if !strings.Contains(missions, "chief.mission.list.response") || strings.Contains(missions, "Permission denied") {
		t.Fatalf("relay agent credential lost necessary Chief read permission: %s", missions)
	}
	cleanup()
	waitForCondition(t, 3*time.Second, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.sinkAgentIDs) == 0
	}, "relay agent binding cleanup")
}
