package cli

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/server"
)

type recordedChiefRPC struct {
	Headers http.Header
	Hello   map[string]any
	Request map[string]any
}

type mockChiefResponse struct {
	PrefixMessages []map[string]any
	MessageType    string
	Payload        map[string]any
}

type mockChiefDaemon struct {
	server   *httptest.Server
	addr     string
	mu       sync.Mutex
	recorded []recordedChiefRPC
}

func startMockChiefDaemon(t *testing.T, handler func(req map[string]any) mockChiefResponse) *mockChiefDaemon {
	t.Helper()
	return startMockChiefDaemonOnListener(t, nil, handler)
}

func startMockChiefDaemonOnListener(t *testing.T, listener net.Listener, handler func(req map[string]any) mockChiefResponse) *mockChiefDaemon {
	t.Helper()
	mock := &mockChiefDaemon{}
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ws" {
			http.NotFound(w, r)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			Subprotocols: []string{"byspace.bearer." + strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")},
		})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		ctx := r.Context()
		_, helloBytes, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var hello map[string]any
		_ = json.Unmarshal(helloBytes, &hello)

		serverInfo, _ := json.Marshal(map[string]any{
			"type": "session",
			"message": map[string]any{
				"type": "status",
				"payload": map[string]any{
					"status":   "server_info",
					"serverId": "srv_mock_chief",
					"version":  "test",
				},
			},
		})
		if err := conn.Write(ctx, websocket.MessageText, serverInfo); err != nil {
			return
		}

		_, reqBytes, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var env struct {
			Type    string         `json:"type"`
			Message map[string]any `json:"message"`
		}
		if err := json.Unmarshal(reqBytes, &env); err != nil {
			return
		}

		mock.mu.Lock()
		mock.recorded = append(mock.recorded, recordedChiefRPC{
			Headers: r.Header.Clone(),
			Hello:   hello,
			Request: env.Message,
		})
		mock.mu.Unlock()

		resp := handler(env.Message)
		for _, prefix := range resp.PrefixMessages {
			frame, _ := json.Marshal(map[string]any{"type": "session", "message": prefix})
			if err := conn.Write(ctx, websocket.MessageText, frame); err != nil {
				return
			}
		}
		outFrame, _ := json.Marshal(map[string]any{
			"type": "session",
			"message": map[string]any{
				"type":    resp.MessageType,
				"payload": resp.Payload,
			},
		})
		_ = conn.Write(ctx, websocket.MessageText, outFrame)
		_ = conn.Close(websocket.StatusNormalClosure, "done")
	}))
	if listener != nil {
		_ = ts.Listener.Close()
		ts.Listener = listener
	}
	ts.Start()
	t.Cleanup(ts.Close)
	mock.server = ts
	mock.addr = strings.TrimPrefix(ts.URL, "http://")
	if listener != nil {
		mock.addr = listener.Addr().String()
	}
	return mock
}

func (m *mockChiefDaemon) lastRequest(t *testing.T) recordedChiefRPC {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.recorded) == 0 {
		t.Fatal("expected at least one recorded RPC request")
	}
	return m.recorded[len(m.recorded)-1]
}

func runChiefCLI(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Main("test", append([]string{"chief"}, args...), &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func sampleMissionMap(overrides map[string]any) map[string]any {
	m := map[string]any{
		"id":           "msn_1",
		"title":        "Ship Chief",
		"goal":         "Build Chief Phase 1",
		"chiefAgentId": "agt_chief",
		"baseCwd":      "/repo/byspace",
		"baseBranch":   "main",
		"tier":         "L2",
		"status":       "active",
		"threads":      []any{sampleThreadMap(nil)},
		"createdAt":    "2026-11-25T13:50:00Z",
		"updatedAt":    "2026-11-25T13:55:00Z",
	}
	for k, v := range overrides {
		m[k] = v
	}
	return m
}

func sampleThreadMap(overrides map[string]any) map[string]any {
	th := map[string]any{
		"id":                 "thr_1",
		"missionId":          "msn_1",
		"title":              "CLI Slice",
		"goal":               "Implement byspace chief CLI",
		"acceptanceCriteria": []any{"go test passes"},
		"ownedPaths":         []any{"internal/cli/chief.go"},
		"cwd":                "/repo/byspace",
		"isolation":          "worktree",
		"status":             "authoring",
		"authorAgentId":      "agt_author",
		"verifierAgentId":    "agt_verifier",
		"verifyRejectCount":  0,
		"rebaseAttempts":     0,
		"createdAt":          "2026-11-25T13:50:00Z",
		"updatedAt":          "2026-11-25T13:55:00Z",
	}
	for k, v := range overrides {
		th[k] = v
	}
	return th
}

func TestChiefHelpAndPreDialValidation(t *testing.T) {
	t.Setenv("BYSPACE_AGENT_ID", "")
	t.Setenv("BYSPACE_HOST", "127.0.0.1:1")

	helpCases := [][]string{
		{},
		{"--help"},
		{"mission", "--help"},
		{"thread", "--help"},
		{"mission", "list", "--help"},
		{"mission", "get", "--help"},
		{"mission", "create", "--help"},
		{"mission", "upgrade", "--help"},
		{"mission", "resolve-decision", "--help"},
		{"thread", "create", "--help"},
		{"thread", "submit", "--help"},
		{"thread", "verdict", "--help"},
	}
	for _, args := range helpCases {
		code, stdout, stderr := runChiefCLI(t, args...)
		if code != 0 || stdout == "" || stderr != "" {
			t.Fatalf("help %v: code=%d stdout=%q stderr=%q", args, code, stdout, stderr)
		}
	}

	errCases := []struct {
		name string
		args []string
		want string
	}{
		{name: "unknown group", args: []string{"bogus"}, want: "unknown chief subcommand"},
		{name: "unknown mission sub", args: []string{"mission", "bogus"}, want: "unknown chief mission subcommand"},
		{name: "unknown thread sub", args: []string{"thread", "bogus"}, want: "unknown chief thread subcommand"},
		{name: "list bad status", args: []string{"mission", "list", "--status", "nope"}, want: "invalid --status"},
		{name: "get missing id", args: []string{"mission", "get"}, want: "usage:"},
		{name: "get bad events-limit", args: []string{"mission", "get", "msn_1", "--events-limit", "501"}, want: "--events-limit"},
		{name: "get negative after-seq", args: []string{"mission", "get", "msn_1", "--after-seq", "-1"}, want: "--after-seq"},
		{name: "create missing goal", args: []string{"mission", "create"}, want: "usage:"},
		{name: "create bad tier", args: []string{"mission", "create", "--tier", "L9", "goal"}, want: "invalid --tier"},
		{name: "upgrade missing tier", args: []string{"mission", "upgrade", "--mission", "msn_1"}, want: "--tier is required"},
		{name: "upgrade bad dirty policy", args: []string{"mission", "upgrade", "--mission", "msn_1", "--tier", "L2", "--dirty-policy", "stash"}, want: "invalid --dirty-policy"},
		{name: "upgrade missing target", args: []string{"mission", "upgrade", "--tier", "L1"}, want: "one of --mission, --solo-agent, or BYSPACE_AGENT_ID"},
		{name: "resolve missing option", args: []string{"mission", "resolve-decision", "msn_1"}, want: "usage:"},
		{name: "thread create missing mission", args: []string{"thread", "create", "--title", "t", "--goal", "g"}, want: "--mission is required"},
		{name: "thread create missing title", args: []string{"thread", "create", "--mission", "msn_1", "--goal", "g"}, want: "--title is required"},
		{name: "thread create missing goal", args: []string{"thread", "create", "--mission", "msn_1", "--title", "t"}, want: "--goal is required"},
		{name: "thread create bad isolation", args: []string{"thread", "create", "--mission", "msn_1", "--title", "t", "--goal", "g", "--isolation", "docker"}, want: "invalid --isolation"},
		{name: "thread submit missing thread", args: []string{"thread", "submit", "--summary", "done"}, want: "--thread or positional <thread-id>"},
		{name: "thread submit missing summary", args: []string{"thread", "submit", "thr_1"}, want: "--summary is required"},
		{name: "thread verdict missing outcome", args: []string{"thread", "verdict", "thr_1", "--summary", "ok"}, want: "one of --pass or --reject"},
		{name: "thread verdict conflicting pass reject", args: []string{"thread", "verdict", "thr_1", "--pass", "--reject", "--summary", "ok"}, want: "cannot use --pass and --reject"},
		{name: "thread verdict conflicting outcome", args: []string{"thread", "verdict", "thr_1", "--pass", "--outcome", "reject", "--summary", "ok"}, want: "cannot combine --pass with --outcome reject"},
		{name: "thread verdict bad outcome", args: []string{"thread", "verdict", "thr_1", "--outcome", "maybe", "--summary", "ok"}, want: "invalid --outcome"},
		{name: "thread verdict missing thread", args: []string{"thread", "verdict", "--pass", "--summary", "ok"}, want: "--thread or positional <thread-id>"},
		{name: "thread verdict missing summary", args: []string{"thread", "verdict", "thr_1", "--pass"}, want: "--summary is required"},
	}

	for _, tc := range errCases {
		t.Run(tc.name, func(t *testing.T) {
			code, stdout, stderr := runChiefCLI(t, tc.args...)
			if code == 0 {
				t.Fatalf("expected non-zero exit code, got stdout=%q", stdout)
			}
			if !strings.Contains(stderr, tc.want) {
				t.Fatalf("stderr = %q, want substring %q", stderr, tc.want)
			}
		})
	}
}

func TestChiefMissionSubcommandsMockRPC(t *testing.T) {
	t.Setenv("BYSPACE_HOME", t.TempDir())
	t.Setenv("BYSPACE_HOST", "")
	t.Setenv("BYSPACE_AGENT_ID", "agt_caller_env")

	mock := startMockChiefDaemon(t, func(req map[string]any) mockChiefResponse {
		reqID, _ := req["requestId"].(string)
		switch req["type"] {
		case "chief.mission.create.request":
			return mockChiefResponse{
				MessageType: "chief.mission.create.response",
				Payload: map[string]any{
					"requestId": reqID,
					"mission":   sampleMissionMap(map[string]any{"tier": "L1", "status": "active"}),
					"error":     nil,
				},
			}
		case "chief.mission.list.request":
			if req["chiefAgentId"] == "agt_empty" {
				return mockChiefResponse{
					MessageType: "chief.mission.list.response",
					Payload:     map[string]any{"requestId": reqID, "missions": []any{}, "error": nil},
				}
			}
			return mockChiefResponse{
				PrefixMessages: []map[string]any{
					{
						"type": "chief.mission.update",
						"payload": map[string]any{
							"kind":      "remove",
							"missionId": "msn_ignored_broadcast",
						},
					},
				},
				MessageType: "chief.mission.list.response",
				Payload: map[string]any{
					"requestId": reqID,
					"missions": []any{
						sampleMissionMap(map[string]any{
							"status":          "waiting_human",
							"pendingDecision": map[string]any{"id": "dec_1", "kind": "landing_approval", "title": "Land", "summary": "Ready", "createdAt": "2026-11-25T13:55:00Z"},
							"systemAttention": map[string]any{"kind": "stall", "severity": "fatal", "summary": "Stalled", "since": "2026-11-25T13:55:00Z"},
						}),
					},
					"error": nil,
				},
			}
		case "chief.mission.get.request":
			return mockChiefResponse{
				MessageType: "chief.mission.get.response",
				Payload: map[string]any{
					"requestId": reqID,
					"mission": sampleMissionMap(map[string]any{
						"chiefAgentStatus": "idle",
						"baseWorkspaceId":  "wks_1",
						"pendingDecision": map[string]any{
							"id":      "dec_1",
							"kind":    "landing_approval",
							"title":   "Approve land",
							"summary": "All threads green",
							"options": []any{map[string]any{"id": "approve", "label": "Land now"}},
						},
						"systemAttention": map[string]any{
							"kind":     "stall",
							"severity": "warning",
							"summary":  "Slow turn",
						},
					}),
					"events": []any{
						map[string]any{"seq": 4, "ts": "2026-11-25T13:55:00Z", "kind": "verify_passed", "summary": "Tests green"},
					},
					"error": nil,
				},
			}
		case "chief.mission.upgrade.request":
			return mockChiefResponse{
				MessageType: "chief.mission.upgrade.response",
				Payload: map[string]any{
					"requestId":       reqID,
					"mission":         sampleMissionMap(map[string]any{"tier": "L2", "status": "active"}),
					"createdThreadId": "thr_upgraded_1",
					"error":           nil,
				},
			}
		case "chief.mission.resolve_decision.request":
			return mockChiefResponse{
				MessageType: "chief.mission.resolve_decision.response",
				Payload: map[string]any{
					"requestId": reqID,
					"mission":   sampleMissionMap(map[string]any{"status": "active"}),
					"error":     nil,
				},
			}
		default:
			return mockChiefResponse{
				MessageType: "rpc_error",
				Payload:     map[string]any{"error": "unexpected rpc"},
			}
		}
	})

	code, stdout, stderr := runChiefCLI(t,
		"mission", "create",
		"--addr", mock.addr,
		"--title", "Phase 1",
		"--tier", "l1",
		"--chief", "agt_chief",
		"--project", "prj_1",
		"--workspace", "wks_1",
		"--base-branch", "main",
		"Build", "Chief",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("mission create failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "created mission msn_1 (tier=L1, status=active)") {
		t.Fatalf("create stdout = %q", stdout)
	}
	rec := mock.lastRequest(t)
	if rec.Request["type"] != "chief.mission.create.request" ||
		rec.Request["goal"] != "Build Chief" ||
		rec.Request["title"] != "Phase 1" ||
		rec.Request["tier"] != "L1" ||
		rec.Request["chiefAgentId"] != "agt_chief" ||
		rec.Request["callerAgentId"] != "agt_caller_env" ||
		rec.Request["projectId"] != "prj_1" ||
		rec.Request["baseWorkspaceId"] != "wks_1" ||
		rec.Request["baseBranch"] != "main" {
		t.Fatalf("unexpected create request: %#v", rec.Request)
	}
	if _, hasCwd := rec.Request["baseCwd"]; hasCwd {
		t.Fatalf("baseCwd should be omitted when --workspace is given without --cwd: %#v", rec.Request)
	}

	code, _, stderr = runChiefCLI(t, "mission", "create", "--addr", mock.addr, "--caller", "agt_explicit", "--json", "--", "-dash-goal")
	if code != 0 || stderr != "" {
		t.Fatalf("mission create --json failed (%d): %s", code, stderr)
	}
	rec = mock.lastRequest(t)
	cwdNow, _ := os.Getwd()
	if rec.Request["baseCwd"] != cwdNow || rec.Request["callerAgentId"] != "agt_explicit" || rec.Request["goal"] != "-dash-goal" {
		t.Fatalf("unexpected standalone create request: %#v (cwd=%q)", rec.Request, cwdNow)
	}

	t.Setenv("BYSPACE_AGENT_ID", "")
	code, _, stderr = runChiefCLI(t, "mission", "create", "--addr", mock.addr, "--goal", "No caller")
	if code != 0 || stderr != "" {
		t.Fatalf("mission create without caller failed (%d): %s", code, stderr)
	}
	rec = mock.lastRequest(t)
	if _, hasCaller := rec.Request["callerAgentId"]; hasCaller {
		t.Fatalf("expected callerAgentId omitted when BYSPACE_AGENT_ID is empty: %#v", rec.Request)
	}
	t.Setenv("BYSPACE_AGENT_ID", "agt_caller_env")

	code, stdout, stderr = runChiefCLI(t,
		"mission", "list",
		"--addr", mock.addr,
		"--chief", "agt_chief",
		"--project", "prj_1",
		"--workspace", "wks_1",
		"--status", "active,waiting_human",
		"--status", "failed",
		"--all",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("mission list failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "msn_1") || !strings.Contains(stdout, "[decision]") || !strings.Contains(stdout, "[fatal]") {
		t.Fatalf("mission list table = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["includeCompleted"] != true {
		t.Fatalf("includeCompleted = %#v", rec.Request["includeCompleted"])
	}
	if !reflect.DeepEqual(rec.Request["statuses"], []any{"active", "waiting_human", "failed"}) {
		t.Fatalf("statuses = %#v", rec.Request["statuses"])
	}

	code, stdout, stderr = runChiefCLI(t, "mission", "ls", "--addr", mock.addr, "--chief", "agt_empty", "--json")
	if code != 0 || stderr != "" || strings.TrimSpace(stdout) != "[]" {
		t.Fatalf("empty mission ls --json: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	code, stdout, stderr = runChiefCLI(t, "mission", "ls", "--addr", mock.addr, "--chief", "agt_empty")
	if code != 0 || stderr != "" || !strings.Contains(stdout, "No missions found.") {
		t.Fatalf("empty mission ls: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}

	code, stdout, stderr = runChiefCLI(t,
		"mission", "get", "msn_1",
		"--addr", mock.addr,
		"--events-limit", "25",
		"--after-seq", "3",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("mission get failed (%d): %s", code, stderr)
	}
	for _, want := range []string{"Mission msn_1", "Approve land", "Slow turn", "thr_1", "#4 2026-11-25T13:55:00Z verify_passed"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("mission get stdout missing %q:\n%s", want, stdout)
		}
	}
	rec = mock.lastRequest(t)
	if rec.Request["missionId"] != "msn_1" ||
		rec.Request["includeEvents"] != true ||
		rec.Request["eventsLimit"] != float64(25) ||
		rec.Request["afterSeq"] != float64(3) {
		t.Fatalf("unexpected mission get request: %#v", rec.Request)
	}

	code, stdout, stderr = runChiefCLI(t, "mission", "inspect", "msn_1", "--addr", mock.addr, "--events", "--json")
	if code != 0 || stderr != "" {
		t.Fatalf("mission get --json failed (%d): %s", code, stderr)
	}
	var gotJSON map[string]any
	if err := json.Unmarshal([]byte(stdout), &gotJSON); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout)
	}
	if _, hasReqID := gotJSON["requestId"]; hasReqID {
		t.Fatalf("expected requestId stripped from --json output: %#v", gotJSON)
	}
	if gotJSON["mission"] == nil || gotJSON["events"] == nil {
		t.Fatalf("expected mission and events in --json output: %#v", gotJSON)
	}

	code, stdout, stderr = runChiefCLI(t,
		"mission", "upgrade",
		"--addr", mock.addr,
		"--solo-agent", "agt_solo",
		"--tier", "L2",
		"--dirty-policy", "carry_into_thread_1",
		"--title", "Thread 1",
		"--goal", "Upgrade solo work",
		"--acceptance", " A1 ",
		"--acceptance", "A2",
		"--own", " leading.txt",
		"--owned-path", " plain.txt ",
		"--author-profile", "prof_author",
		"--verifier-profile", "prof_verifier",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("mission upgrade failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "upgraded mission msn_1 to L2 (status=active, thread=thr_upgraded_1)") {
		t.Fatalf("upgrade stdout = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["soloAgentId"] != "agt_solo" ||
		rec.Request["targetTier"] != "L2" ||
		rec.Request["dirtyPolicy"] != "carry_into_thread_1" ||
		!reflect.DeepEqual(rec.Request["acceptanceCriteria"], []any{"A1", "A2"}) ||
		!reflect.DeepEqual(rec.Request["ownedPaths"], []any{" leading.txt", " plain.txt "}) {
		t.Fatalf("unexpected upgrade request: %#v", rec.Request)
	}

	code, stdout, stderr = runChiefCLI(t,
		"mission", "resolve-decision", "msn_1", "approve",
		"--addr", mock.addr,
		"--decision", "dec_1",
		"--note", "Looks good",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("resolve-decision failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "resolved decision on mission msn_1 (option=approve, status=active)") {
		t.Fatalf("resolve stdout = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["missionId"] != "msn_1" ||
		rec.Request["decisionId"] != "dec_1" ||
		rec.Request["optionId"] != "approve" ||
		rec.Request["note"] != "Looks good" {
		t.Fatalf("unexpected resolve request: %#v", rec.Request)
	}
}

func TestChiefThreadSubcommandsMockRPC(t *testing.T) {
	t.Setenv("BYSPACE_HOME", t.TempDir())
	t.Setenv("BYSPACE_HOST", "")

	mock := startMockChiefDaemon(t, func(req map[string]any) mockChiefResponse {
		reqID, _ := req["requestId"].(string)
		switch req["type"] {
		case "chief.thread.create.request":
			return mockChiefResponse{
				MessageType: "chief.thread.create.response",
				Payload: map[string]any{
					"requestId": reqID,
					"mission":   sampleMissionMap(nil),
					"thread":    sampleThreadMap(map[string]any{"status": "authoring", "isolation": "worktree"}),
					"error":     nil,
				},
			}
		case "chief.thread.submit.request":
			if req["threadId"] == "thr_bad" {
				return mockChiefResponse{
					MessageType: "chief.thread.submit.response",
					Payload: map[string]any{
						"requestId":           reqID,
						"accepted":            false,
						"thread":              sampleThreadMap(map[string]any{"id": "thr_bad", "status": "authoring"}),
						"ownershipViolations": []any{"README.md", "go.mod"},
						"error":               "changed files outside ownedPaths",
					},
				}
			}
			return mockChiefResponse{
				MessageType: "chief.thread.submit.response",
				Payload: map[string]any{
					"requestId":           reqID,
					"accepted":            true,
					"thread":              sampleThreadMap(map[string]any{"status": "verifying"}),
					"ownershipViolations": []any{},
					"error":               nil,
				},
			}
		case "chief.thread.verdict.request":
			if req["threadId"] == "thr_rpc_err" {
				return mockChiefResponse{
					MessageType: "rpc_error",
					Payload:     map[string]any{"error": "caller is not assigned verifier"},
				}
			}
			escalated := req["outcome"] == "reject"
			status := "ready_to_land"
			if escalated {
				status = "blocked"
			}
			return mockChiefResponse{
				MessageType: "chief.thread.verdict.response",
				Payload: map[string]any{
					"requestId":        reqID,
					"accepted":         true,
					"escalatedToChief": escalated,
					"thread":           sampleThreadMap(map[string]any{"status": status}),
					"error":            nil,
				},
			}
		default:
			return mockChiefResponse{
				MessageType: "rpc_error",
				Payload:     map[string]any{"error": "unexpected rpc"},
			}
		}
	})

	t.Setenv("BYSPACE_AGENT_ID", "agt_chief_1")
	code, stdout, stderr := runChiefCLI(t,
		"thread", "create",
		"--addr", mock.addr,
		"--mission", "msn_1",
		"--title", "CLI Slice",
		"--goal", "Implement byspace chief",
		"--acceptance", " go test passes ",
		"--own", " leading.txt",
		"--owned-path", " plain.txt ",
		"--isolation", "worktree",
		"--base", "main",
		"--branch", "chief/cli",
		"--author-profile", "prof_std",
		"--verifier-profile", "prof_strong",
		"--author-agent", "agt_author_1",
		"--prompt", "Start working",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("thread create failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "created thread thr_1 (mission=msn_1, status=authoring, isolation=worktree)") {
		t.Fatalf("thread create stdout = %q", stdout)
	}
	rec := mock.lastRequest(t)
	if rec.Request["missionId"] != "msn_1" ||
		rec.Request["callerAgentId"] != "agt_chief_1" ||
		rec.Request["isolation"] != "worktree" ||
		rec.Request["baseRef"] != "main" ||
		rec.Request["branch"] != "chief/cli" ||
		rec.Request["authorAgentId"] != "agt_author_1" ||
		rec.Request["initialPrompt"] != "Start working" ||
		!reflect.DeepEqual(rec.Request["acceptanceCriteria"], []any{"go test passes"}) ||
		!reflect.DeepEqual(rec.Request["ownedPaths"], []any{" leading.txt", " plain.txt "}) {
		t.Fatalf("unexpected thread create request: %#v", rec.Request)
	}

	t.Setenv("BYSPACE_AGENT_ID", "agt_author_1")
	code, stdout, stderr = runChiefCLI(t,
		"thread", "submit", "thr_1",
		"--addr", mock.addr,
		"--mission", "msn_1",
		"--summary", "Implemented CLI",
		"--tests", "go test -tags nogui ./internal/cli/...",
		"--file", "internal/cli/chief.go",
		"--changed-file", "internal/cli/chief_test.go,internal/cli/main.go",
		"--commit", "deadbeef",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("thread submit failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "submitted thread thr_1 (status=verifying)") {
		t.Fatalf("thread submit stdout = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["threadId"] != "thr_1" ||
		rec.Request["missionId"] != "msn_1" ||
		rec.Request["callerAgentId"] != "agt_author_1" ||
		rec.Request["summary"] != "Implemented CLI" ||
		rec.Request["tests"] != "go test -tags nogui ./internal/cli/..." ||
		rec.Request["commitSha"] != "deadbeef" ||
		!reflect.DeepEqual(rec.Request["changedFiles"], []any{"internal/cli/chief.go", "internal/cli/chief_test.go", "internal/cli/main.go"}) {
		t.Fatalf("unexpected thread submit request: %#v", rec.Request)
	}

	code, stdout, stderr = runChiefCLI(t,
		"thread", "submit", "thr_1",
		"--addr", mock.addr,
		"--summary", "-leading-dash-summary",
	)
	if code != 0 || stderr != "" || !strings.Contains(stdout, "submitted thread thr_1") {
		t.Fatalf("dash summary submit failed: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	rec = mock.lastRequest(t)
	if rec.Request["summary"] != "-leading-dash-summary" {
		t.Fatalf("summary = %#v", rec.Request["summary"])
	}

	code, stdout, stderr = runChiefCLI(t,
		"thread", "submit", "thr_bad",
		"--addr", mock.addr,
		"--notes", "Tried editing outside ownedPaths",
		"--json",
	)
	if code == 0 || !strings.Contains(stderr, "changed files outside ownedPaths") {
		t.Fatalf("rejected submit: code=%d stderr=%q stdout=%q", code, stderr, stdout)
	}
	var submitReject map[string]any
	if err := json.Unmarshal([]byte(stdout), &submitReject); err != nil {
		t.Fatalf("rejected submit --json invalid: %v\n%s", err, stdout)
	}
	if submitReject["accepted"] != false || !reflect.DeepEqual(submitReject["ownershipViolations"], []any{"README.md", "go.mod"}) {
		t.Fatalf("unexpected rejected submit JSON: %#v", submitReject)
	}

	t.Setenv("BYSPACE_AGENT_ID", "agt_verifier_1")
	code, stdout, stderr = runChiefCLI(t,
		"thread", "verdict", "thr_1",
		"--addr", mock.addr,
		"--pass",
		"--summary", "Verified all tests",
		"--checked", "go test -tags nogui ./internal/cli/...",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("thread verdict --pass failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "verdict pass recorded for thread thr_1 (status=ready_to_land)") {
		t.Fatalf("verdict pass stdout = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["outcome"] != "pass" ||
		rec.Request["callerAgentId"] != "agt_verifier_1" ||
		!reflect.DeepEqual(rec.Request["checkedCommands"], []any{"go test -tags nogui ./internal/cli/..."}) {
		t.Fatalf("unexpected verdict pass request: %#v", rec.Request)
	}

	code, stdout, stderr = runChiefCLI(t,
		"thread", "verdict", "thr_1",
		"--addr", mock.addr,
		"--reject",
		"--summary", "Missing edge case",
		"--issue", "missing flag check",
		"--issue", "missing unit test",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("thread verdict --reject failed (%d): %s", code, stderr)
	}
	if !strings.Contains(stdout, "escalatedToChief=true") {
		t.Fatalf("verdict reject stdout = %q", stdout)
	}
	rec = mock.lastRequest(t)
	if rec.Request["outcome"] != "reject" ||
		!reflect.DeepEqual(rec.Request["issues"], []any{"missing flag check", "missing unit test"}) {
		t.Fatalf("unexpected verdict reject request: %#v", rec.Request)
	}

	code, _, stderr = runChiefCLI(t, "thread", "verdict", "thr_rpc_err", "--addr", mock.addr, "--pass", "--summary", "ok")
	if code == 0 || !strings.Contains(stderr, "caller is not assigned verifier") {
		t.Fatalf("rpc_error verdict: code=%d stderr=%q", code, stderr)
	}
}

func TestChiefPhase2HelpAndPreDialValidation(t *testing.T) {
	t.Setenv("BYSPACE_AGENT_ID", "")
	t.Setenv("BYSPACE_HOST", "127.0.0.1:1")

	for _, args := range [][]string{
		{"thread", "merge-check", "--help"},
		{"thread", "land", "--help"},
		{"thread", "cancel", "--help"},
		{"agent", "--help"},
		{"agent", "hotswap", "--help"},
	} {
		code, stdout, stderr := runChiefCLI(t, args...)
		if code != 0 || stdout == "" || stderr != "" {
			t.Fatalf("help %v: code=%d stdout=%q stderr=%q", args, code, stdout, stderr)
		}
	}

	code, stdout, stderr := runChiefCLI(t)
	if code != 0 || stderr != "" {
		t.Fatalf("root help: code=%d stderr=%q", code, stderr)
	}
	for _, want := range []string{"thread merge-check", "thread land", "thread cancel", "agent hotswap"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("root help missing %q:\n%s", want, stdout)
		}
	}

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "unknown agent subcommand", args: []string{"agent", "bogus"}, want: "unknown chief agent subcommand"},
		{name: "merge-check missing thread", args: []string{"thread", "merge-check"}, want: "--thread or positional <thread-id> is required"},
		{name: "land missing thread", args: []string{"thread", "land"}, want: "--thread or positional <thread-id> is required"},
		{name: "land missing strategy", args: []string{"thread", "land", "thr_1", "--commit-message", "Ship it"}, want: "--strategy is required"},
		{name: "land missing commit message", args: []string{"thread", "land", "thr_1", "--strategy", "squash"}, want: "--commit-message is required"},
		{name: "land bad strategy", args: []string{"thread", "land", "thr_1", "--strategy", "fast-forward"}, want: "invalid --strategy"},
		{name: "land open PR unsupported", args: []string{"thread", "land", "thr_1", "--strategy", "open_pr"}, want: "open_pr is not supported"},
		{name: "cancel missing thread", args: []string{"thread", "cancel", "--reason", "superseded"}, want: "--thread or positional <thread-id> is required"},
		{name: "cancel missing reason", args: []string{"thread", "cancel", "thr_1"}, want: "--reason is required"},
		{name: "hotswap missing agent", args: []string{"agent", "hotswap", "--profile", "prof_1"}, want: "--agent or positional <agent-id> is required"},
		{name: "hotswap missing thread", args: []string{"agent", "hotswap", "agt_1", "--profile", "prof_1", "--reason", "quota"}, want: "--thread is required"},
		{name: "hotswap missing profile", args: []string{"agent", "hotswap", "agt_1", "--thread", "thr_1", "--reason", "quota"}, want: "--profile is required"},
		{name: "hotswap missing reason", args: []string{"agent", "hotswap", "agt_1", "--thread", "thr_1", "--profile", "prof_1"}, want: "--reason is required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, stdout, stderr := runChiefCLI(t, tc.args...)
			if code == 0 {
				t.Fatalf("expected non-zero exit code, got stdout=%q", stdout)
			}
			if !strings.Contains(stderr, tc.want) {
				t.Fatalf("stderr = %q, want substring %q", stderr, tc.want)
			}
		})
	}
}

func TestChiefPhase2SubcommandsMockRPC(t *testing.T) {
	t.Setenv("BYSPACE_HOME", t.TempDir())
	t.Setenv("BYSPACE_HOST", "")
	t.Setenv("BYSPACE_AGENT_ID", "agt_chief_env")

	mock := startMockChiefDaemon(t, func(req map[string]any) mockChiefResponse {
		reqID, _ := req["requestId"].(string)
		switch req["type"] {
		case "chief.thread.merge_check.request":
			return mockChiefResponse{
				MessageType: "chief.thread.merge_check.response",
				Payload: map[string]any{
					"requestId":  reqID,
					"accepted":   true,
					"mission":    sampleMissionMap(map[string]any{"status": "active"}),
					"mergeCheck": map[string]any{"clean": true, "targetRef": "refs/heads/main", "conflicts": []any{}},
					"error":      nil,
				},
			}
		case "chief.thread.land.request":
			if req["threadId"] == "thr_wait" {
				return mockChiefResponse{
					MessageType: "chief.thread.land.response",
					Payload: map[string]any{
						"requestId":        reqID,
						"accepted":         false,
						"approvalRequired": true,
						"mission":          sampleMissionMap(map[string]any{"status": "waiting_human"}),
						"error":            nil,
					},
				}
			}
			if req["threadId"] == "thr_land_error" {
				return mockChiefResponse{
					MessageType: "chief.thread.land.response",
					Payload: map[string]any{
						"requestId":        reqID,
						"accepted":         false,
						"approvalRequired": false,
						"mission":          sampleMissionMap(map[string]any{"status": "active"}),
						"error":            "base branch has conflicts",
					},
				}
			}
			return mockChiefResponse{
				MessageType: "chief.thread.land.response",
				Payload: map[string]any{
					"requestId":        reqID,
					"accepted":         true,
					"approvalRequired": false,
					"mission":          sampleMissionMap(map[string]any{"status": "completed"}),
					"error":            nil,
				},
			}
		case "chief.thread.cancel.request":
			return mockChiefResponse{
				MessageType: "chief.thread.cancel.response",
				Payload: map[string]any{
					"requestId": reqID,
					"accepted":  true,
					"mission":   sampleMissionMap(map[string]any{"status": "canceled"}),
					"error":     nil,
				},
			}
		case "chief.agent.hotswap.request":
			return mockChiefResponse{
				MessageType: "chief.agent.hotswap.response",
				Payload: map[string]any{
					"requestId":          reqID,
					"accepted":           true,
					"mission":            sampleMissionMap(nil),
					"previousAgentId":    "agt_old",
					"replacementAgentId": "agt_new",
					"profileId":          "prof_strong",
					"error":              nil,
				},
			}
		default:
			return mockChiefResponse{
				MessageType: "rpc_error",
				Payload:     map[string]any{"error": "unexpected rpc"},
			}
		}
	})

	assertRequest := func(want map[string]any) {
		t.Helper()
		if got := mock.lastRequest(t).Request; !reflect.DeepEqual(got, want) {
			t.Fatalf("request mismatch:\ngot  %#v\nwant %#v", got, want)
		}
	}
	decodeJSON := func(stdout string) map[string]any {
		t.Helper()
		var got map[string]any
		if err := json.Unmarshal([]byte(stdout), &got); err != nil {
			t.Fatalf("invalid JSON: %v\n%s", err, stdout)
		}
		if _, present := got["requestId"]; present {
			t.Fatalf("requestId leaked into JSON output: %#v", got)
		}
		return got
	}

	code, stdout, stderr := runChiefCLI(t,
		"thread", "merge-check", "thr_1",
		"--addr", mock.addr,
		"--mission", "msn_1",
		"--caller", "agt_chief_explicit",
		"--json",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("merge-check failed (%d): %s", code, stderr)
	}
	assertRequest(map[string]any{
		"type":          "chief.thread.merge_check.request",
		"requestId":     "cli_chief_thread_merge_check",
		"threadId":      "thr_1",
		"missionId":     "msn_1",
		"callerAgentId": "agt_chief_explicit",
	})
	if got := decodeJSON(stdout); got["accepted"] != true || got["mission"] == nil {
		t.Fatalf("merge-check JSON = %#v", got)
	}

	code, stdout, stderr = runChiefCLI(t,
		"thread", "land", "thr_wait",
		"--addr", mock.addr,
		"--mission", "msn_1",
		"--strategy", "SQUASH",
		"--commit-message", "Ship phase 2",
	)
	if code != 0 || stderr != "" || !strings.Contains(stdout, "accepted=false") || !strings.Contains(stdout, "approvalRequired=true") || !strings.Contains(stdout, "mission=msn_1") {
		t.Fatalf("approval-required land: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	assertRequest(map[string]any{
		"type":          "chief.thread.land.request",
		"requestId":     "cli_chief_thread_land",
		"threadId":      "thr_wait",
		"missionId":     "msn_1",
		"callerAgentId": "agt_chief_env",
		"strategy":      "squash",
		"commitMessage": "Ship phase 2",
	})

	code, stdout, stderr = runChiefCLI(t,
		"thread", "land", "thr_1",
		"--addr", mock.addr,
		"--strategy", "merge",
		"--commit-message", "Land without optional IDs",
		"--json",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("land failed (%d): %s", code, stderr)
	}
	assertRequest(map[string]any{
		"type":          "chief.thread.land.request",
		"requestId":     "cli_chief_thread_land",
		"threadId":      "thr_1",
		"callerAgentId": "agt_chief_env",
		"strategy":      "merge",
		"commitMessage": "Land without optional IDs",
	})
	if got := decodeJSON(stdout); got["accepted"] != true || got["approvalRequired"] != false || got["mission"] == nil {
		t.Fatalf("land JSON = %#v", got)
	}
	if _, present := decodeJSON(stdout)["error"]; present {
		t.Fatalf("null error should be removed from land JSON: %s", stdout)
	}

	code, stdout, stderr = runChiefCLI(t,
		"thread", "cancel", "thr_cancel",
		"--addr", mock.addr,
		"--mission", "msn_1",
		"--caller", "agt_chief_cancel",
		"--reason", "superseded by a new plan",
	)
	if code != 0 || stderr != "" || !strings.Contains(stdout, "canceled thread thr_cancel") || !strings.Contains(stdout, "mission=msn_1") {
		t.Fatalf("cancel: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	assertRequest(map[string]any{
		"type":          "chief.thread.cancel.request",
		"requestId":     "cli_chief_thread_cancel",
		"threadId":      "thr_cancel",
		"missionId":     "msn_1",
		"callerAgentId": "agt_chief_cancel",
		"reason":        "superseded by a new plan",
	})

	code, stdout, stderr = runChiefCLI(t,
		"agent", "hotswap", "agt_old",
		"--addr", mock.addr,
		"--thread", "thr_1",
		"--profile", "prof_strong",
		"--mission", "msn_1",
		"--reason", "quota exhausted",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("hotswap failed (%d): %s", code, stderr)
	}
	for _, want := range []string{"agt_old -> agt_new", "profile=prof_strong", "mission=msn_1"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("hotswap stdout missing %q: %q", want, stdout)
		}
	}
	assertRequest(map[string]any{
		"type":          "chief.agent.hotswap.request",
		"requestId":     "cli_chief_agent_hotswap",
		"agentId":       "agt_old",
		"threadId":      "thr_1",
		"profileId":     "prof_strong",
		"missionId":     "msn_1",
		"callerAgentId": "agt_chief_env",
		"reason":        "quota exhausted",
	})

	code, stdout, stderr = runChiefCLI(t,
		"thread", "land", "thr_land_error",
		"--addr", mock.addr,
		"--strategy", "merge",
		"--commit-message", "Attempt conflicting landing",
		"--json",
	)
	if code == 0 || !strings.Contains(stderr, "base branch has conflicts") {
		t.Fatalf("land error: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	if got := decodeJSON(stdout); got["accepted"] != false || got["approvalRequired"] != false || got["mission"] == nil || got["error"] != "base branch has conflicts" {
		t.Fatalf("land error JSON = %#v", got)
	}
}

func TestChiefTransportResolutionBYSPACEHostAndHome(t *testing.T) {
	mock := startMockChiefDaemon(t, func(req map[string]any) mockChiefResponse {
		return mockChiefResponse{
			MessageType: "chief.mission.list.response",
			Payload: map[string]any{
				"requestId": req["requestId"],
				"missions":  []any{},
				"error":     nil,
			},
		}
	})

	t.Setenv("BYSPACE_HOME", t.TempDir())
	t.Setenv("BYSPACE_HOST", mock.addr)
	code, stdout, stderr := runChiefCLI(t, "mission", "list", "--json")
	if code != 0 || stderr != "" || strings.TrimSpace(stdout) != "[]" {
		t.Fatalf("BYSPACE_HOST list failed: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}

	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	t.Setenv("BYSPACE_HOST", "")
	if err := daemon.WritePIDLock(homeDir, daemon.PIDLockInfo{PID: os.Getpid(), Listen: &mock.addr}); err != nil {
		t.Fatal(err)
	}
	token := server.EnsureCLICredential(homeDir)
	if token == "" {
		t.Fatal("expected EnsureCLICredential to create a token")
	}

	code, stdout, stderr = runChiefCLI(t, "mission", "list", "--json")
	if code != 0 || stderr != "" || strings.TrimSpace(stdout) != "[]" {
		t.Fatalf("BYSPACE_HOME list failed: code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	rec := mock.lastRequest(t)
	if gotAuth := rec.Headers.Get("Authorization"); gotAuth != "Bearer "+token {
		t.Fatalf("Authorization = %q, want %q", gotAuth, "Bearer "+token)
	}
}
