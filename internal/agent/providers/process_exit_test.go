package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

const processExitHelperEnv = "BYSPACE_PROCESS_EXIT_HELPER"

func TestProcessExitSubprocessHelper(t *testing.T) {
	mode := os.Getenv(processExitHelperEnv)
	if mode == "" {
		return
	}
	if slices.Contains(os.Args, "--version") {
		if mode == "codex" {
			fmt.Println("codex-cli 0.128.0")
		} else {
			fmt.Println("1.2.3")
		}
		os.Exit(0)
	}
	switch mode {
	case "codex":
		os.Exit(runProcessExitCodexHelper())
	case "opencode":
		os.Exit(runProcessExitOpenCodeHelper())
	default:
		os.Exit(2)
	}
}

func runProcessExitCodexHelper() int {
	capturePath := os.Getenv("BYSPACE_CODEX_CAPTURE_PATH")
	var captureMu sync.Mutex
	recordRequest := func(req map[string]any) {
		if capturePath == "" {
			return
		}
		line, err := json.Marshal(req)
		if err != nil {
			return
		}
		captureMu.Lock()
		defer captureMu.Unlock()
		f, err := os.OpenFile(capturePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return
		}
		_, _ = f.Write(append(line, '\n'))
		_ = f.Close()
	}

	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for {
		var req map[string]any
		if err := decoder.Decode(&req); err != nil {
			if err == io.EOF {
				return 0
			}
			return 2
		}
		recordRequest(req)
		id := req["id"]
		method, _ := req["method"].(string)
		var result map[string]any
		switch method {
		case "initialize":
			result = map[string]any{"userAgent": "codex-helper"}
		case "thread/start":
			result = map[string]any{"thread": map[string]any{"id": "thread-helper-1"}}
		case "collaborationMode/list":
			result = map[string]any{"data": []any{
				map[string]any{"name": "Default", "mode": "code"},
				map[string]any{"name": "Plan", "mode": "plan", "developer_instructions": "read only plan"},
			}}
		case "turn/start":
			result = map[string]any{"turn": map[string]any{"id": "turn-helper-1"}}
			if os.Getenv("BYSPACE_CODEX_CRASH_ON_TURN") == "1" {
				_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
				return 1
			}
		default:
			result = map[string]any{}
		}
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result}); err != nil {
			return 2
		}
	}
}

func runProcessExitOpenCodeHelper() int {
	port := ""
	for i := 0; i < len(os.Args)-1; i++ {
		if os.Args[i] == "--port" {
			port = os.Args[i+1]
			break
		}
	}
	if port == "" {
		return 2
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return 2
	}
	mux := http.NewServeMux()
	sessionSeq := 0
	var seqMu sync.Mutex
	mux.HandleFunc("/session", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte("[]"))
			return
		}
		if r.Method == http.MethodPost {
			seqMu.Lock()
			sessionSeq++
			id := fmt.Sprintf("oc-sess-%d", sessionSeq)
			seqMu.Unlock()
			_, _ = fmt.Fprintf(w, `{"id":%q}`, id)
			return
		}
		http.NotFound(w, r)
	})
	mux.HandleFunc("/session/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/prompt_async") {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		_, _ = w.Write([]byte(`[]`))
	})
	mux.HandleFunc("/global/event", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	})
	mux.HandleFunc("/command", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	srv := &http.Server{Handler: mux}
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return 1
	}
	return 0
}

func waitForProcessExitEvent(t *testing.T, ch <-chan map[string]any, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-ch:
			if ev["type"] == "process_exit" {
				return ev
			}
		case <-deadline:
			t.Fatal("timed out waiting for process_exit event")
			return nil
		}
	}
}

func assertNoProcessExitEvent(t *testing.T, ch <-chan map[string]any, wait time.Duration) {
	t.Helper()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case ev := <-ch:
			if ev["type"] == "process_exit" {
				t.Fatalf("unexpected process_exit event after intentional close: %#v", ev)
			}
		case <-timer.C:
			return
		}
	}
}

func TestCodexProcessExitAndCloseSuppression(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	helperArgs := []string{"-test.run=^TestProcessExitSubprocessHelper$", "--"}

	t.Run("unexpected_death_emits_process_exit_after_unlock", func(t *testing.T) {
		env := append(os.Environ(), processExitHelperEnv+"=codex")
		sess, err := startCodexSessionWithArgs(LaunchConfig{Cwd: t.TempDir(), Env: env}, exe, helperArgs)
		if err != nil {
			t.Fatal(err)
		}
		defer sess.Close()

		events := make(chan map[string]any, 8)
		statusInCallback := make(chan string, 1)
		sess.OnEvent(func(ev map[string]any) {
			if ev["type"] == "process_exit" {
				statusInCallback <- sess.Status()
				_ = sess.Close()
			}
			events <- ev
		})

		if err := sess.cmd.Process.Kill(); err != nil {
			t.Fatal(err)
		}

		ev := waitForProcessExitEvent(t, events, 3*time.Second)
		errText, _ := ev["error"].(string)
		if !strings.Contains(errText, "codex process exited") {
			t.Fatalf("process_exit error = %q", errText)
		}
		if got := <-statusInCallback; got != "closed" {
			t.Fatalf("status inside callback = %q, want closed", got)
		}
		if sess.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", sess.Status())
		}
		if !strings.Contains(sess.LastError(), "codex process exited") {
			t.Fatalf("LastError() = %q", sess.LastError())
		}
		if err := sess.WaitForFinish(context.Background()); err == nil || !strings.Contains(err.Error(), "codex process exited") {
			t.Fatalf("late waiter did not receive retained crash: %v", err)
		}
	})

	t.Run("unexpected_death_mid_turn_releases_waiter", func(t *testing.T) {
		env := append(os.Environ(),
			processExitHelperEnv+"=codex",
			"BYSPACE_CODEX_CRASH_ON_TURN=1",
		)
		sess, err := startCodexSessionWithArgs(LaunchConfig{Cwd: t.TempDir(), Env: env}, exe, helperArgs)
		if err != nil {
			t.Fatal(err)
		}
		defer sess.Close()

		events := make(chan map[string]any, 8)
		sess.OnEvent(func(ev map[string]any) { events <- ev })

		if err := sess.Prompt(context.Background(), "hello", nil); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if waitErr := sess.WaitForFinish(ctx); waitErr == nil {
			t.Fatal("WaitForFinish returned nil after unexpected process death")
		}
		waitForProcessExitEvent(t, events, 3*time.Second)
		if sess.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", sess.Status())
		}
		if turnID, _ := sess.ActiveTurn(); turnID != "" {
			t.Fatalf("ActiveTurn() = %q, want empty", turnID)
		}
	})

	t.Run("intentional_close_suppresses_process_exit", func(t *testing.T) {
		env := append(os.Environ(), processExitHelperEnv+"=codex")
		sess, err := startCodexSessionWithArgs(LaunchConfig{Cwd: t.TempDir(), Env: env}, exe, helperArgs)
		if err != nil {
			t.Fatal(err)
		}
		events := make(chan map[string]any, 8)
		sess.OnEvent(func(ev map[string]any) { events <- ev })

		if err := sess.Close(); err != nil {
			t.Fatal(err)
		}
		assertNoProcessExitEvent(t, events, 250*time.Millisecond)
		if sess.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", sess.Status())
		}
		if err := sess.WaitForFinish(context.Background()); err != nil {
			t.Fatalf("intentional close late wait: %v", err)
		}
	})
}

func TestCodexSessionHonorsReadOnlyVerifierTurnParams(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	capturePath := filepath.Join(t.TempDir(), "codex-requests.jsonl")
	env := append(os.Environ(),
		processExitHelperEnv+"=codex",
		"BYSPACE_CODEX_CAPTURE_PATH="+capturePath,
	)
	sess, err := startCodexSessionWithArgs(LaunchConfig{
		Cwd:           t.TempDir(),
		Model:         "gpt-5.4",
		ModeID:        "full-access",
		Env:           env,
		FeatureValues: map[string]any{"plan_mode": true},
		ProviderOptions: map[string]any{
			"sandbox_mode":    "read-only",
			"approval_policy": "never",
		},
	}, exe, []string{"-test.run=^TestProcessExitSubprocessHelper$", "--"})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	if err := sess.Prompt(context.Background(), "audit repo", nil); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatal(err)
	}
	var threadStartParams, turnStartParams map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line == "" {
			continue
		}
		var req map[string]any
		if json.Unmarshal([]byte(line), &req) != nil {
			continue
		}
		params, _ := req["params"].(map[string]any)
		switch req["method"] {
		case "thread/start":
			threadStartParams = params
		case "turn/start":
			turnStartParams = params
		}
	}
	if threadStartParams == nil || turnStartParams == nil {
		t.Fatalf("missing thread/start (%v) or turn/start (%v)", threadStartParams, turnStartParams)
	}
	threadCfg, _ := threadStartParams["config"].(map[string]any)
	if threadCfg["sandbox_mode"] != "read-only" || threadCfg["approval_policy"] != "never" {
		t.Fatalf("thread/start config = %#v, want read-only + never", threadCfg)
	}
	sandboxPolicy, _ := turnStartParams["sandboxPolicy"].(map[string]any)
	if sandboxPolicy["type"] != "readOnly" {
		t.Fatalf("turn/start sandboxPolicy = %#v, want readOnly", sandboxPolicy)
	}
	if _, hasApprovalPolicy := turnStartParams["approvalPolicy"]; hasApprovalPolicy {
		t.Fatalf("turn/start approvalPolicy = %v, want omitted when pinned in providerOptions", turnStartParams["approvalPolicy"])
	}
	turnCfg, _ := turnStartParams["config"].(map[string]any)
	if turnCfg["sandbox_mode"] != "read-only" || turnCfg["approval_policy"] != "never" {
		t.Fatalf("turn/start config = %#v, want read-only + never", turnCfg)
	}
	collab, _ := turnStartParams["collaborationMode"].(map[string]any)
	if collab["mode"] != "plan" {
		t.Fatalf("turn/start collaborationMode = %#v, want plan", collab)
	}
}

func TestACPProcessExitAndCloseSuppression(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	t.Run("unexpected_death_emits_process_exit_after_unlock", func(t *testing.T) {
		env := append(os.Environ(), "BYSPACE_PROVIDER_HELPER=acp-conformance")
		sess, err := StartACPSession(LaunchConfig{Cwd: t.TempDir(), Env: env}, ProviderSpec{ID: "acp-test", Binary: exe}, exe)
		if err != nil {
			t.Fatal(err)
		}
		defer sess.Close()

		events := make(chan map[string]any, 8)
		statusInCallback := make(chan string, 1)
		sess.OnEvent(func(ev map[string]any) {
			if ev["type"] == "process_exit" {
				statusInCallback <- sess.Status()
				_ = sess.Close()
			}
			events <- ev
		})

		if err := sess.cmd.Process.Kill(); err != nil {
			t.Fatal(err)
		}

		ev := waitForProcessExitEvent(t, events, 3*time.Second)
		errText, _ := ev["error"].(string)
		if !strings.Contains(errText, "acp process exited") {
			t.Fatalf("process_exit error = %q", errText)
		}
		if got := <-statusInCallback; got != "closed" {
			t.Fatalf("status inside callback = %q, want closed", got)
		}
		if sess.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", sess.Status())
		}
		if !strings.Contains(sess.LastError(), "acp process exited") {
			t.Fatalf("LastError() = %q", sess.LastError())
		}
	})

	t.Run("unexpected_eof_mid_turn_preserves_closed_status", func(t *testing.T) {
		r, w := io.Pipe()
		inR, inW := io.Pipe()
		defer inR.Close()
		defer inW.Close()

		s := &ACPSession{
			provider:           "acp-test",
			sessionID:          "sess-1",
			stdin:              inW,
			pending:            make(map[int64]chan map[string]any),
			status:             "idle",
			activeTextIdx:      -1,
			activeThinkIdx:     -1,
			activeUserTextIdx:  -1,
			toolIndexByID:      make(map[string]int),
			pendingPermissions: make(map[string]map[string]any),
			permissionRPCIDs:   make(map[string]any),
			eventSubscribers:   make(map[int]func(map[string]any)),
		}
		s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)

		readDone := make(chan struct{})
		go func() {
			defer close(readDone)
			s.readLoop(r)
		}()

		events := make(chan map[string]any, 16)
		s.OnEvent(func(ev map[string]any) { events <- ev })

		go func() { _, _ = io.Copy(io.Discard, inR) }()

		if err := s.Prompt(context.Background(), "hi", nil); err != nil {
			t.Fatal(err)
		}
		waitDone := make(chan error, 1)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			waitDone <- s.WaitForFinish(ctx)
		}()

		deadline := time.Now().Add(2 * time.Second)
		for {
			s.mu.Lock()
			hasPending := len(s.pending) > 0
			s.mu.Unlock()
			if hasPending {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("pending session/prompt RPC did not register")
			}
			time.Sleep(5 * time.Millisecond)
		}
		_ = w.Close()

		<-readDone
		waitForProcessExitEvent(t, events, 3*time.Second)
		select {
		case waitErr := <-waitDone:
			if waitErr == nil {
				t.Fatal("WaitForFinish returned nil after unexpected ACP EOF")
			}
		case <-time.After(3 * time.Second):
			t.Fatal("WaitForFinish remained blocked")
		}
		time.Sleep(30 * time.Millisecond)
		if s.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", s.Status())
		}
	})

	t.Run("intentional_close_suppresses_process_exit", func(t *testing.T) {
		env := append(os.Environ(), "BYSPACE_PROVIDER_HELPER=acp-conformance")
		sess, err := StartACPSession(LaunchConfig{Cwd: t.TempDir(), Env: env}, ProviderSpec{ID: "acp-test", Binary: exe}, exe)
		if err != nil {
			t.Fatal(err)
		}
		events := make(chan map[string]any, 8)
		sess.OnEvent(func(ev map[string]any) { events <- ev })

		if err := sess.Close(); err != nil {
			t.Fatal(err)
		}
		select {
		case <-sess.waitDone:
		case <-time.After(3 * time.Second):
			t.Fatal("ACP process did not exit on Close")
		}
		assertNoProcessExitEvent(t, events, 150*time.Millisecond)
		if sess.Status() != "closed" {
			t.Fatalf("Status() = %q, want closed", sess.Status())
		}
	})
}

func TestOpenCodeProcessExitAndShutdownSuppression(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	helperArgs := []string{"-test.run=^TestProcessExitSubprocessHelper$", "--"}

	t.Run("unexpected_server_death_notifies_attached_sessions", func(t *testing.T) {
		pool := NewOpenCodePool(t.TempDir(), exe, helperArgs)
		pool.SetEnv(map[string]string{processExitHelperEnv: "opencode"})
		t.Cleanup(pool.Shutdown)

		server, err := pool.Acquire(context.Background())
		if err != nil {
			t.Fatal(err)
		}

		sess1, err := newHTTPOpenCodeSessionForVersion(LaunchConfig{Cwd: t.TempDir()}, server.URL, server.Version, server.Password)
		if err != nil {
			t.Fatal(err)
		}
		sess1.attachServer(server)
		defer sess1.Close()

		sess2, err := newHTTPOpenCodeSessionForVersion(LaunchConfig{Cwd: t.TempDir()}, server.URL, server.Version, server.Password)
		if err != nil {
			t.Fatal(err)
		}
		sess2.attachServer(server)
		defer sess2.Close()

		events1 := make(chan map[string]any, 8)
		status1InCallback := make(chan string, 1)
		sess1.OnEvent(func(ev map[string]any) {
			if ev["type"] == "process_exit" {
				status1InCallback <- sess1.Status()
				_ = sess1.Close()
			}
			events1 <- ev
		})

		events2 := make(chan map[string]any, 8)
		sess2.OnEvent(func(ev map[string]any) { events2 <- ev })

		if err := sess2.Prompt(context.Background(), "hello", nil); err != nil {
			t.Fatal(err)
		}
		waitDone := make(chan error, 1)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			waitDone <- sess2.WaitForFinish(ctx)
		}()
		deadline := time.Now().Add(2 * time.Second)
		for {
			sess2.mu.Lock()
			registered := len(sess2.finishWaiters) == 1
			sess2.mu.Unlock()
			if registered {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("WaitForFinish waiter did not register")
			}
			time.Sleep(5 * time.Millisecond)
		}

		if err := server.cmd.Process.Kill(); err != nil {
			t.Fatal(err)
		}

		ev1 := waitForProcessExitEvent(t, events1, 3*time.Second)
		ev2 := waitForProcessExitEvent(t, events2, 3*time.Second)
		for _, ev := range []map[string]any{ev1, ev2} {
			msg, _ := ev["error"].(string)
			if !strings.Contains(msg, "opencode server exited") {
				t.Fatalf("process_exit error = %q", msg)
			}
		}
		if got := <-status1InCallback; got != "closed" {
			t.Fatalf("status inside callback = %q, want closed", got)
		}
		if sess1.Status() != "closed" || sess2.Status() != "closed" {
			t.Fatalf("statuses = (%q, %q), want both closed", sess1.Status(), sess2.Status())
		}
		if !strings.Contains(sess1.LastError(), "opencode server exited") || !strings.Contains(sess2.LastError(), "opencode server exited") {
			t.Fatalf("LastError = (%q, %q)", sess1.LastError(), sess2.LastError())
		}
		select {
		case waitErr := <-waitDone:
			if waitErr == nil {
				t.Fatal("WaitForFinish returned nil on unexpected server death")
			}
		case <-time.After(3 * time.Second):
			t.Fatal("WaitForFinish remained blocked")
		}
		if err := sess2.WaitForFinish(context.Background()); err == nil || !strings.Contains(err.Error(), "opencode server exited") {
			t.Fatalf("late waiter did not receive retained server exit: %v", err)
		}

		nextServer, err := pool.Acquire(context.Background())
		if err != nil {
			t.Fatalf("Acquire after crash failed: %v", err)
		}
		if nextServer == server || nextServer.generation <= server.generation {
			t.Fatalf("pool returned dead server %+v instead of replacement %+v", server, nextServer)
		}
	})

	t.Run("intentional_pool_shutdown_suppresses_process_exit", func(t *testing.T) {
		pool := NewOpenCodePool(t.TempDir(), exe, helperArgs)
		pool.SetEnv(map[string]string{processExitHelperEnv: "opencode"})
		t.Cleanup(pool.Shutdown)

		server, err := pool.Acquire(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		sess, err := newHTTPOpenCodeSessionForVersion(LaunchConfig{Cwd: t.TempDir()}, server.URL, server.Version, server.Password)
		if err != nil {
			t.Fatal(err)
		}
		sess.attachServer(server)
		defer sess.Close()

		events := make(chan map[string]any, 8)
		sess.OnEvent(func(ev map[string]any) { events <- ev })

		pool.Shutdown()
		assertNoProcessExitEvent(t, events, 250*time.Millisecond)
	})

	t.Run("intentional_session_close_detaches_and_suppresses_process_exit", func(t *testing.T) {
		defer ShutdownOpenCodePool()
		homeDir := t.TempDir()
		env := append(os.Environ(), processExitHelperEnv+"=opencode")

		managed1, err := startOpenCodeSessionWithArgs(LaunchConfig{
			Cwd:     t.TempDir(),
			HomeDir: homeDir,
			Env:     env,
		}, exe, helperArgs)
		if err != nil {
			t.Fatal(err)
		}
		sess1 := managed1.(*OpenCodeSession)

		managed2, err := startOpenCodeSessionWithArgs(LaunchConfig{
			Cwd:     t.TempDir(),
			HomeDir: homeDir,
			Env:     env,
		}, exe, helperArgs)
		if err != nil {
			t.Fatal(err)
		}
		sess2 := managed2.(*OpenCodeSession)
		defer sess2.Close()

		events1 := make(chan map[string]any, 8)
		sess1.OnEvent(func(ev map[string]any) { events1 <- ev })
		events2 := make(chan map[string]any, 8)
		sess2.OnEvent(func(ev map[string]any) { events2 <- ev })

		if err := sess1.Close(); err != nil {
			t.Fatal(err)
		}
		if sess1.Status() != "closed" {
			t.Fatalf("sess1.Status() = %q, want closed", sess1.Status())
		}
		if err := sess1.WaitForFinish(context.Background()); err != nil {
			t.Fatalf("intentional session close late wait: %v", err)
		}

		pool := sharedOpenCodePool(homeDir, exe, helperArgs, openCodePoolEnv(env))
		pool.mu.Lock()
		srv := pool.current
		pool.mu.Unlock()
		if srv == nil || srv.cmd == nil || srv.cmd.Process == nil {
			t.Fatalf("expected live shared OpenCodeServer, got %+v", srv)
		}
		if err := srv.cmd.Process.Kill(); err != nil {
			t.Fatal(err)
		}

		waitForProcessExitEvent(t, events2, 3*time.Second)
		if sess2.Status() != "closed" {
			t.Fatalf("sess2.Status() = %q, want closed", sess2.Status())
		}
		assertNoProcessExitEvent(t, events1, 200*time.Millisecond)
	})
}
