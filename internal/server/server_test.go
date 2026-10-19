package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/relay"
)

func writeFakePiScript(t *testing.T, dir string) string {
	t.Helper()
	scriptPath := filepath.Join(dir, "fake-pi.sh")
	script := `#!/bin/sh
while read line; do
  req_id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  [ -z "$req_id" ] && req_id="req_1"
  case "$line" in
    *'"type":"get_state"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"sess_fake_1\",\"sessionFile\":\"$0.jsonl\",\"thinkingLevel\":\"medium\",\"isStreaming\":false,\"isCompacting\":false,\"messageCount\":0,\"pendingMessageCount\":0}}"
      ;;
    *'"type":"get_available_models"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_available_models\",\"success\":true,\"data\":{\"models\":[{\"provider\":\"anthropic\",\"id\":\"claude-sonnet-4-5\",\"name\":\"Claude Sonnet 4.5\",\"reasoning\":true}]}}"
      ;;
    *'"type":"get_commands"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_commands\",\"success\":true,\"data\":{\"commands\":[{\"name\":\"compact\",\"source\":\"prompt\"}]}}"
      ;;
    *'"type":"set_model"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"set_model\",\"success\":true,\"data\":{\"provider\":\"anthropic\",\"id\":\"claude-sonnet-4-5\"}}"
      ;;
    *'"type":"set_thinking_level"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"set_thinking_level\",\"success\":true,\"data\":{}}"
      ;;
    *'"type":"prompt"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"prompt\",\"success\":true,\"data\":{\"agentInvoked\":true}}"
      echo '{"type":"agent_start"}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"Thinking in Pi..."}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Pi reply from Go daemon!"}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Pi reply from Go daemon!"}]}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
  esac
done
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return scriptPath
}

func readUntilSessionType(t *testing.T, ctx context.Context, ws *websocket.Conn, wantType string, wantStatus string) map[string]any {
	t.Helper()
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			t.Fatalf("read waiting for %s(%s): %v", wantType, wantStatus, err)
		}
		var env struct {
			Type    string `json:"type"`
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if err := json.Unmarshal(data, &env); err != nil || env.Type != "session" {
			continue
		}
		if env.Message.Type != wantType {
			continue
		}
		if wantStatus != "" {
			st, _ := env.Message.Payload["status"].(string)
			if st != wantStatus {
				continue
			}
		}
		return env.Message.Payload
	}
}

func TestServerDirectWebSocketAndPiAgentLifecycle(t *testing.T) {
	tmp := t.TempDir()
	fakePi := writeFakePiScript(t, tmp)
	workDir := filepath.Join(tmp, "project-a")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{
		HomeDir:   filepath.Join(tmp, "home"),
		Version:   "0.20.2-test",
		PiCommand: fakePi,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()

	// 1. Send hello -> receive server_info
	hello := `{"type":"hello","clientId":"cli_test","protocolVersion":1}`
	if err := ws.Write(ctx, websocket.MessageText, []byte(hello)); err != nil {
		t.Fatal(err)
	}
	info := readUntilSessionType(t, ctx, ws, "status", "server_info")
	if info["serverId"] != srv.ServerID() {
		t.Fatalf("unexpected serverId: %+v", info)
	}

	// 2. Create Pi agent with initialPrompt
	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":          "create_agent_request",
			"requestId":     "req_create_1",
			"initialPrompt": "Hello Pi",
			"config": map[string]any{
				"provider": "pi",
				"cwd":      workDir,
			},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}
	created := readUntilSessionType(t, ctx, ws, "status", "agent_created")
	agentID, _ := created["agentId"].(string)
	if !strings.HasPrefix(agentID, "agt_") {
		t.Fatalf("expected agt_ id, got %q", agentID)
	}

	// 3. Wait for Pi turn finish
	waitReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "wait_for_finish_request",
			"requestId": "req_wait_1",
			"agentId":   agentID,
			"timeoutMs": 3000,
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, waitReq); err != nil {
		t.Fatal(err)
	}
	waitResp := readUntilSessionType(t, ctx, ws, "wait_for_finish_response", "")
	if waitResp["status"] != "completed" {
		t.Fatalf("expected completed wait_for_finish_response, got %+v", waitResp)
	}
	finalMap, _ := waitResp["final"].(map[string]any)
	if finalMap["assistantText"] != "Pi reply from Go daemon!" {
		t.Fatalf("unexpected final assistantText: %+v", finalMap)
	}

	// 4. Fetch timeline
	tlReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "fetch_agent_timeline_request",
			"requestId": "req_tl_1",
			"agentId":   agentID,
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, tlReq); err != nil {
		t.Fatal(err)
	}
	tlResp := readUntilSessionType(t, ctx, ws, "fetch_agent_timeline_response", "")
	entries, _ := tlResp["entries"].([]any)
	if len(entries) != 3 {
		t.Fatalf("expected 3 timeline entries (user, reasoning, assistant), got %d: %+v", len(entries), entries)
	}
}

func TestServerOverRelayE2EEHandshake(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{
		HomeDir: filepath.Join(tmp, "home"),
		Version: "0.20.2-relay-e2e",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	relaySrv := relay.NewServer(relay.Options{})
	relayTS := httptest.NewServer(relaySrv)
	defer relayTS.Close()

	relayWSURL := "ws" + strings.TrimPrefix(relayTS.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go func() {
		_ = srv.ConnectRelay(ctx, relayWSURL)
	}()
	time.Sleep(40 * time.Millisecond)

	// Connect as remote client through Relay
	cliWS, _, err := websocket.Dial(ctx, relayWSURL+"?serverId="+srv.ServerID()+"&role=client&v=2&connectionId=conn_e2e", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cliWS.CloseNow()

	clientKP, _ := e2ee.GenerateKeyPair()
	daemonPub, _ := e2ee.ImportKey(srv.PublicKeyB64())
	sharedKey, _ := e2ee.DeriveSharedKey(clientKP.SecretKey, daemonPub)

	// Send e2ee_hello
	e2eeHello, _ := json.Marshal(e2ee.HelloMessage{
		Type:         "e2ee_hello",
		Key:          e2ee.ExportKey(clientKP.PublicKey),
		Capabilities: &e2ee.Capabilities{BinaryCiphertext: true},
	})
	if err := cliWS.Write(ctx, websocket.MessageText, e2eeHello); err != nil {
		t.Fatal(err)
	}

	// Expect e2ee_ready
	_, readyRaw, err := cliWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var readyMsg e2ee.ReadyMessage
	if err := json.Unmarshal(readyRaw, &readyMsg); err != nil || readyMsg.Type != "e2ee_ready" {
		t.Fatalf("expected e2ee_ready, got %s", string(readyRaw))
	}

	// Send encrypted BySpace hello
	plainHello := []byte(`{"type":"hello","clientId":"remote_mobile","protocolVersion":1}`)
	cipherHello, _ := e2ee.Encrypt(sharedKey, plainHello)
	b64Hello := base64.StdEncoding.EncodeToString(cipherHello)
	if err := cliWS.Write(ctx, websocket.MessageText, []byte(b64Hello)); err != nil {
		t.Fatal(err)
	}

	// Receive encrypted server_info
	_, encInfoRaw, err := cliWS.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cipherInfo, err := base64.StdEncoding.DecodeString(string(encInfoRaw))
	if err != nil {
		t.Fatal(err)
	}
	plainInfo, err := e2ee.Decrypt(sharedKey, cipherInfo)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(plainInfo), `"status":"server_info"`) || !strings.Contains(string(plainInfo), srv.ServerID()) {
		t.Fatalf("unexpected decrypted server_info: %s", string(plainInfo))
	}
}

func TestServerFileExplorerPiSessionImportAndTerminalRPC(t *testing.T) {
	tmp := t.TempDir()
	fakePi := writeFakePiScript(t, tmp)
	workDir := filepath.Join(tmp, "repo")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "hello.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	piSessDir := filepath.Join(tmp, "pi-sessions")
	if err := os.MkdirAll(piSessDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sessFile := filepath.Join(piSessDir, "hist.jsonl")
	jsonlContent := strings.Join([]string{
		`{"type":"session","id":"sess_import_1","cwd":"` + workDir + `","timestamp":"2026-04-20T02:00:00.000Z"}`,
		`{"type":"session_info","name":"Imported Pi Chat"}`,
		`{"type":"message","timestamp":"2026-04-20T02:01:00.000Z","message":{"role":"user","content":"Previous prompt"}}`,
		`{"type":"message","timestamp":"2026-04-20T02:01:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Previous answer"}]}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(sessFile, []byte(jsonlContent), 0o600); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{
		HomeDir:      filepath.Join(tmp, "home"),
		Version:      "0.20.2-test",
		PiCommand:    fakePi,
		PiSessionDir: piSessDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()

	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_2","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	// 1. File explorer read file
	feReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "file_explorer_request",
			"requestId": "req_fe_1",
			"cwd":       workDir,
			"path":      "hello.go",
			"mode":      "file",
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, feReq)
	feResp := readUntilSessionType(t, ctx, ws, "file_explorer_response", "")
	fileMap, _ := feResp["file"].(map[string]any)
	if fileMap["content"] != "package main\n" {
		t.Fatalf("unexpected file explorer content: %+v", feResp)
	}

	// 2. Discover recent Pi sessions
	recReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "fetch_recent_provider_sessions_request",
			"requestId": "req_rec_1",
			"cwd":       workDir,
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, recReq)
	recResp := readUntilSessionType(t, ctx, ws, "fetch_recent_provider_sessions_response", "")
	recEntries, _ := recResp["entries"].([]any)
	if len(recEntries) != 1 {
		t.Fatalf("expected 1 recent Pi session, got %+v", recResp)
	}

	// 3. Import Pi session and verify restored timeline
	impReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":             "import_agent_request",
			"requestId":        "req_imp_1",
			"provider":         "pi",
			"providerHandleId": sessFile,
			"cwd":              workDir,
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, impReq)
	impCreated := readUntilSessionType(t, ctx, ws, "status", "agent_created")
	impAgentID, _ := impCreated["agentId"].(string)

	tlReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "fetch_agent_timeline_request",
			"requestId": "req_tl_imp",
			"agentId":   impAgentID,
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, tlReq)
	tlResp := readUntilSessionType(t, ctx, ws, "fetch_agent_timeline_response", "")
	tlEntries, _ := tlResp["entries"].([]any)
	if len(tlEntries) != 2 {
		t.Fatalf("expected 2 restored timeline entries, got %d: %+v", len(tlEntries), tlEntries)
	}

	// 4. Probe Pi models via list_provider_models_request
	modReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "list_provider_models_request",
			"requestId": "req_mod_1",
			"provider":  "pi",
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, modReq)
	modResp := readUntilSessionType(t, ctx, ws, "list_provider_models_response", "")
	modelsList, _ := modResp["models"].([]any)
	if len(modelsList) != 1 {
		t.Fatalf("expected 1 probed Pi model, got %+v", modResp)
	}

	// 5. Schedule create with runOnCreate -> triggers Pi agent run and records output
	schedReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":        "schedule/create",
			"requestId":   "req_sched_1",
			"name":        "Heartbeat",
			"prompt":      "Check status",
			"runOnCreate": true,
			"cadence": map[string]any{
				"type":    "every",
				"everyMs": 60000,
			},
			"target": map[string]any{
				"type": "new-agent",
				"config": map[string]any{
					"provider": "pi",
					"cwd":      workDir,
				},
			},
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, schedReq)
	schedResp := readUntilSessionType(t, ctx, ws, "schedule/create/response", "")
	schedObj, _ := schedResp["schedule"].(map[string]any)
	schedID, _ := schedObj["id"].(string)
	if schedID == "" {
		t.Fatalf("expected schedule id in response: %+v", schedResp)
	}

	logsReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":       "schedule/logs",
			"requestId":  "req_sched_logs",
			"scheduleId": schedID,
		},
	})
	_ = ws.Write(ctx, websocket.MessageText, logsReq)
	logsResp := readUntilSessionType(t, ctx, ws, "schedule/logs/response", "")
	runsList, _ := logsResp["runs"].([]any)
	if len(runsList) != 1 {
		t.Fatalf("expected 1 schedule run log, got %+v", logsResp)
	}
}
