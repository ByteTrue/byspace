package pi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"byspace/internal/agent"
)

func TestPiAdapterStreamsAbortsAndReportsExit(t *testing.T) {
	cwd := t.TempDir()
	sessionDir := filepath.Join(t.TempDir(), "sessions")
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: sessionDir,
		Env: map[string]string{
			"BYSPACE_PI_HELPER":             "1",
			"BYSPACE_PI_EXPECT_CWD":         cwd,
			"BYSPACE_PI_EXPECT_SESSION_DIR": sessionDir,
		},
	})
	manager := agent.NewManager(map[string]agent.Provider{"pi": factory})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	snapshot, err := manager.Create(context.Background(), agent.Config{
		Provider:         "pi",
		CWD:              cwd,
		Model:            "test-model",
		ThinkingOptionID: "high",
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.RuntimeInfo.SessionID != "pi-session" || snapshot.RuntimeInfo.Model != "test-model" {
		t.Fatalf("unexpected runtime info: %+v", snapshot.RuntimeInfo)
	}
	if snapshot.Persistence == nil || snapshot.Persistence.NativeHandle != filepath.Join(sessionDir, "pi-session.jsonl") {
		t.Fatalf("unexpected persistence handle: %+v", snapshot.Persistence)
	}

	first, err := manager.Send(context.Background(), snapshot.ID, "client-1", "stream")
	if err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleIdle && snapshot.TimelineHeadSeq == 5
	})
	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantTypes := []agent.TimelineItemType{
		agent.TimelineUserMessage,
		agent.TimelineReasoning,
		agent.TimelineToolCall,
		agent.TimelineToolCall,
		agent.TimelineAssistantMessage,
	}
	for index, want := range wantTypes {
		if timeline.Rows[index].Item.Type != want || timeline.Rows[index].TurnID != first.TurnID {
			t.Fatalf("row %d = %+v, want type %q and turn %q", index, timeline.Rows[index], want, first.TurnID)
		}
	}
	if got := timeline.Rows[4].Item.Text; got != "before\u2028after" {
		t.Fatalf("Unicode line separator split JSONL frame: %q", got)
	}
	if timeline.Rows[2].Item.Status != "running" || timeline.Rows[3].Item.Status != "completed" {
		t.Fatalf("unexpected tool lifecycle: %+v / %+v", timeline.Rows[2], timeline.Rows[3])
	}

	second, err := manager.Send(context.Background(), snapshot.ID, "client-2", "block")
	if err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleRunning
	})
	var terminalMu sync.Mutex
	var terminal []agent.ProviderEventType
	unsubscribe := manager.Subscribe(func(event agent.Event) {
		if event.Stream == nil || event.Stream.TurnID != second.TurnID {
			return
		}
		if event.Stream.Type == agent.ProviderEventTurnCompleted || event.Stream.Type == agent.ProviderEventTurnCanceled {
			terminalMu.Lock()
			terminal = append(terminal, event.Stream.Type)
			terminalMu.Unlock()
		}
	})
	if err := manager.Abort(context.Background(), snapshot.ID); err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleIdle && snapshot.ActiveTurnID == ""
	})
	waitCondition(t, func() bool {
		terminalMu.Lock()
		defer terminalMu.Unlock()
		return len(terminal) == 1
	})
	unsubscribe()
	terminalMu.Lock()
	if len(terminal) != 1 || terminal[0] != agent.ProviderEventTurnCanceled {
		t.Fatalf("abort terminal events = %v", terminal)
	}
	terminalMu.Unlock()

	if _, err := manager.Send(context.Background(), snapshot.ID, "client-3", "exit"); err == nil {
		t.Fatal("provider exit did not fail pending prompt")
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleError && strings.Contains(snapshot.LastError, "exit status 17")
	})
}

func TestCanceledPromptPoisonsSessionBeforeReuse(t *testing.T) {
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		Env: map[string]string{
			"BYSPACE_PI_HELPER":      "1",
			"BYSPACE_PI_HELPER_MODE": "delayed-prompt",
		},
	})
	manager := agent.NewManager(map[string]agent.Provider{"pi": factory})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	first, err := manager.Send(ctx, snapshot.ID, "first", "delayed")
	if !errors.Is(err, agent.ErrSessionUnusable) {
		t.Fatalf("canceled prompt error = %v", err)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleError
	})
	if _, err := manager.Send(context.Background(), snapshot.ID, "second", "must not run"); !errors.Is(err, agent.ErrProviderExited) {
		t.Fatalf("send after uncertain prompt error = %v", err)
	}
	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	userRows := 0
	sawLateEvent := false
	for _, row := range timeline.Rows {
		if row.Item.Type == agent.TimelineUserMessage {
			userRows++
		}
		if row.Item.Text == "late-old-turn" {
			sawLateEvent = true
			if row.TurnID != first.TurnID {
				t.Fatalf("late event turn = %q, want %q", row.TurnID, first.TurnID)
			}
		}
	}
	if !sawLateEvent {
		t.Fatalf("late event was not observed before session teardown: %+v", timeline.Rows)
	}
	if userRows != 1 {
		t.Fatalf("timeline contains %d user rows after poisoned session, want 1: %+v", userRows, timeline.Rows)
	}
}

func TestAbortProcessExitIsNotSuccessfulSettlement(t *testing.T) {
	factory := New(Options{
		Command:      helperCommand(),
		SessionDir:   filepath.Join(t.TempDir(), "sessions"),
		AbortTimeout: time.Second,
		Env: map[string]string{
			"BYSPACE_PI_HELPER":      "1",
			"BYSPACE_PI_HELPER_MODE": "abort-crashes",
		},
	})
	manager := agent.NewManager(map[string]agent.Provider{"pi": factory})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "message", "block"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Abort(context.Background(), snapshot.ID); !errors.Is(err, agent.ErrSessionUnusable) {
		t.Fatalf("abort after process exit error = %v", err)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleError
	})
}

func TestAbortTimeoutPoisonsSession(t *testing.T) {
	factory := New(Options{
		Command:      helperCommand(),
		SessionDir:   filepath.Join(t.TempDir(), "sessions"),
		AbortTimeout: 40 * time.Millisecond,
		Env: map[string]string{
			"BYSPACE_PI_HELPER":      "1",
			"BYSPACE_PI_HELPER_MODE": "abort-never-settles",
		},
	})
	manager := agent.NewManager(map[string]agent.Provider{"pi": factory})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "message", "block"); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := manager.Abort(context.Background(), snapshot.ID); !errors.Is(err, agent.ErrSessionUnusable) {
		t.Fatalf("unsettled abort error = %v", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("unsettled abort took %s", elapsed)
	}
	waitSnapshot(t, manager, snapshot.ID, func(snapshot agent.Snapshot) bool {
		return snapshot.Lifecycle == agent.LifecycleError
	})
}

func TestPiStartupDescendantIsContainedAndReaped(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		Env: map[string]string{
			"BYSPACE_PI_HELPER":         "1",
			"BYSPACE_PI_HELPER_MODE":    "spawn-child-at-start",
			"BYSPACE_PI_CHILD_PID_FILE": pidFile,
		},
	})
	session, err := factory.Start(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := session.Close(ctx); err != nil {
		t.Fatal(err)
	}
	waitCondition(t, func() bool { return !processAlive(pid) })
}

func TestAbnormalPiExitReapsDescendantProcess(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		Env: map[string]string{
			"BYSPACE_PI_HELPER":         "1",
			"BYSPACE_PI_CHILD_PID_FILE": pidFile,
		},
	})
	manager := agent.NewManager(map[string]agent.Provider{"pi": factory})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := manager.Send(ctx, snapshot.ID, "message", "exit-with-child"); !errors.Is(err, agent.ErrSessionUnusable) {
		t.Fatalf("abnormal exit error = %v", err)
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	waitCondition(t, func() bool { return !processAlive(pid) })
}

func TestRepeatedPiSessionCloseDoesNotLeakDescriptors(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires /proc/self/fd")
	}
	countDescriptors := func() int {
		entries, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Fatal(err)
		}
		return len(entries)
	}
	before := countDescriptors()
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		Env:        map[string]string{"BYSPACE_PI_HELPER": "1"},
	})
	for index := 0; index < 25; index++ {
		session, err := factory.Start(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err = session.Close(ctx)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
	runtime.GC()
	if after := countDescriptors(); after > before+5 {
		t.Fatalf("file descriptors grew from %d to %d", before, after)
	}
}

func TestPiSessionCloseReapsProcess(t *testing.T) {
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		Env:        map[string]string{"BYSPACE_PI_HELPER": "1"},
	})
	sessionValue, err := factory.Start(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	session := sessionValue.(*piSession)
	pid := session.process.PID()
	closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := session.Close(closeCtx); err != nil {
		t.Fatal(err)
	}
	if processAlive(pid) {
		t.Fatalf("Pi helper PID %d still exists after close", pid)
	}
}

func TestInstalledPiRPCOfflineSmoke(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping installed Pi smoke in short mode")
	}
	command, err := exec.LookPath("pi")
	if err != nil {
		t.Skip("pi is not installed")
	}
	factory := New(Options{
		Command:    []string{command},
		SessionDir: filepath.Join(t.TempDir(), "sessions"),
		ExtraArgs: []string{
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
		},
		Env: map[string]string{"PI_OFFLINE": "1"},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, err := factory.Start(ctx, agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if session.RuntimeInfo().SessionID == "" {
		t.Fatal("installed Pi returned an empty session ID")
	}
	if err := session.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestPiAdapterResumesSpecificSession(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionFile := filepath.Join(sessionDir, "pi-session.jsonl")
	if err := os.WriteFile(sessionFile, []byte("session"), 0o600); err != nil {
		t.Fatal(err)
	}
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: sessionDir,
		Env: map[string]string{
			"BYSPACE_PI_HELPER":             "1",
			"BYSPACE_PI_EXPECT_SESSION_DIR": sessionDir,
			"BYSPACE_PI_EXPECT_SESSION":     sessionFile,
		},
	})
	session, err := factory.Start(context.Background(), agent.Config{
		Provider: "pi",
		CWD:      t.TempDir(),
		Resume: &agent.PersistenceHandle{
			Provider:     "pi",
			SessionID:    "pi-session",
			NativeHandle: sessionFile,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.RuntimeInfo().NativeHandle != sessionFile {
		t.Fatalf("runtime info = %+v", session.RuntimeInfo())
	}
	if err := session.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPiAdapterRejectsResumeOutsideSessionDirectory(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "sessions")
	outside := filepath.Join(t.TempDir(), "outside.jsonl")
	if err := os.WriteFile(outside, []byte("session"), 0o600); err != nil {
		t.Fatal(err)
	}
	factory := New(Options{Command: helperCommand(), SessionDir: sessionDir})
	_, err := factory.Start(context.Background(), agent.Config{
		Provider: "pi",
		CWD:      t.TempDir(),
		Resume:   &agent.PersistenceHandle{Provider: "pi", SessionID: "pi-session", NativeHandle: outside},
	})
	if err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("resume error = %v", err)
	}
}

func TestPiAdapterRejectsMismatchedResumedIdentity(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionFile := filepath.Join(sessionDir, "pi-session.jsonl")
	if err := os.WriteFile(sessionFile, []byte("session"), 0o600); err != nil {
		t.Fatal(err)
	}
	factory := New(Options{
		Command:    helperCommand(),
		SessionDir: sessionDir,
		Env: map[string]string{
			"BYSPACE_PI_HELPER":             "1",
			"BYSPACE_PI_EXPECT_SESSION_DIR": sessionDir,
			"BYSPACE_PI_SESSION_ID":         "different-session",
		},
	})
	_, err := factory.Start(context.Background(), agent.Config{
		Provider: "pi",
		CWD:      t.TempDir(),
		Resume:   &agent.PersistenceHandle{Provider: "pi", SessionID: "pi-session", NativeHandle: sessionFile},
	})
	if err == nil || !strings.Contains(err.Error(), "different-session") {
		t.Fatalf("resume error = %v", err)
	}
}

func TestPiRPCHelper(t *testing.T) {
	if os.Getenv("BYSPACE_PI_HELPER") != "1" {
		return
	}
	if expected := os.Getenv("BYSPACE_PI_EXPECT_CWD"); expected != "" {
		actual, err := os.Getwd()
		if err != nil || actual != expected {
			os.Exit(11)
		}
	}
	if !hasArgPair(os.Args, "--mode", "rpc") || !hasArg(os.Args, "--no-approve") {
		os.Exit(12)
	}
	if expected := os.Getenv("BYSPACE_PI_EXPECT_SESSION_DIR"); expected != "" && !hasArgPair(os.Args, "--session-dir", expected) {
		os.Exit(13)
	}
	if expected := os.Getenv("BYSPACE_PI_EXPECT_SESSION"); expected != "" && !hasArgPair(os.Args, "--session", expected) {
		os.Exit(20)
	}
	if os.Getenv("BYSPACE_PI_EXPECT_CWD") != "" {
		if !hasArgPair(os.Args, "--model", "test-model") || !hasArgPair(os.Args, "--thinking", "high") {
			os.Exit(14)
		}
	}

	mode := os.Getenv("BYSPACE_PI_HELPER_MODE")
	if mode == "spawn-child-at-start" {
		startHoldingChild()
	}
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var command struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
			os.Exit(15)
		}
		switch command.Type {
		case "get_state":
			sessionID := os.Getenv("BYSPACE_PI_SESSION_ID")
			if sessionID == "" {
				sessionID = "pi-session"
			}
			sessionFile := filepath.Join(os.Getenv("BYSPACE_PI_EXPECT_SESSION_DIR"), "pi-session.jsonl")
			_ = os.WriteFile(sessionFile, []byte("session"), 0o600)
			emitJSON(writer, map[string]any{
				"id": command.ID, "type": "response", "command": "get_state", "success": true,
				"data": map[string]any{
					"sessionId":     sessionID,
					"sessionFile":   sessionFile,
					"model":         map[string]any{"id": "test-model", "provider": "test-provider"},
					"thinkingLevel": "high",
				},
			})
		case "prompt":
			if command.Message == "exit-with-child" {
				startHoldingChild()
				writer.Flush()
				os.Exit(19)
			}
			if mode == "delayed-prompt" && command.Message == "delayed" {
				emitJSON(writer, map[string]any{"type": "agent_start"})
				emitJSON(writer, map[string]any{"type": "turn_start"})
				writer.Flush()
				time.Sleep(100 * time.Millisecond)
				emitJSON(writer, map[string]any{"id": command.ID, "type": "response", "command": "prompt", "success": true})
				emitJSON(writer, map[string]any{
					"type":                  "message_update",
					"assistantMessageEvent": map[string]any{"type": "text_delta", "delta": "late-old-turn"},
				})
				emitJSON(writer, map[string]any{"type": "agent_settled"})
				writer.Flush()
				continue
			}
			if command.Message == "exit" {
				fmt.Fprintln(os.Stderr, "intentional helper exit")
				writer.Flush()
				os.Exit(17)
			}
			if command.Message == "stream" {
				fmt.Fprintln(writer, "not-json")
				fmt.Fprintln(writer, "[]")
				emitJSON(writer, map[string]any{"type": "agent_start"})
				emitJSON(writer, map[string]any{"id": command.ID, "type": "response", "command": "prompt", "success": true})
				emitJSON(writer, map[string]any{"type": "turn_start"})
				emitJSON(writer, map[string]any{
					"type":                  "message_update",
					"assistantMessageEvent": map[string]any{"type": "thinking_delta", "delta": "thinking"},
				})
				emitJSON(writer, map[string]any{
					"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "bash",
					"args": map[string]any{"command": "true"},
				})
				emitJSON(writer, map[string]any{
					"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "bash",
					"result": map[string]any{"content": []any{map[string]any{"type": "text", "text": "ok"}}}, "isError": false,
				})
				fmt.Fprintln(writer, `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"before`+"\u2028"+`after"}}`)
				emitJSON(writer, map[string]any{"type": "message_end", "message": map[string]any{"role": "assistant", "stopReason": "stop"}})
				emitJSON(writer, map[string]any{"type": "agent_end", "messages": []any{}, "willRetry": false})
				emitJSON(writer, map[string]any{"type": "agent_settled"})
				writer.Flush()
				continue
			}
			emitJSON(writer, map[string]any{"id": command.ID, "type": "response", "command": "prompt", "success": true})
			emitJSON(writer, map[string]any{"type": "agent_start"})
			emitJSON(writer, map[string]any{"type": "turn_start"})
		case "abort":
			// Acknowledgment may overtake terminal event handling. Abort must not
			// return until agent_settled has closed the old turn generation.
			emitJSON(writer, map[string]any{"id": command.ID, "type": "response", "command": "abort", "success": true})
			writer.Flush()
			if mode == "abort-never-settles" {
				continue
			}
			if mode == "abort-crashes" {
				os.Exit(20)
			}
			time.Sleep(20 * time.Millisecond)
			emitJSON(writer, map[string]any{"type": "message_end", "message": map[string]any{"role": "assistant", "stopReason": "aborted"}})
			emitJSON(writer, map[string]any{"type": "agent_end", "messages": []any{}, "willRetry": false})
			emitJSON(writer, map[string]any{"type": "agent_settled"})
		default:
			emitJSON(writer, map[string]any{"id": command.ID, "type": "response", "command": command.Type, "success": false, "error": "unsupported"})
		}
		writer.Flush()
	}
}

func startHoldingChild() {
	child := exec.Command(os.Args[0], "-test.run=TestPiHoldingChild", "--")
	child.Stdout = os.Stdout
	child.Stderr = os.Stderr
	child.Env = append(os.Environ(), "BYSPACE_PI_HOLD_CHILD=1")
	if err := child.Start(); err != nil {
		os.Exit(18)
	}
	if err := os.WriteFile(os.Getenv("BYSPACE_PI_CHILD_PID_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0o600); err != nil {
		os.Exit(18)
	}
}

func TestPiHoldingChild(t *testing.T) {
	if os.Getenv("BYSPACE_PI_HOLD_CHILD") != "1" {
		return
	}
	for {
		time.Sleep(time.Hour)
	}
}

func helperCommand() []string {
	return []string{os.Args[0], "-test.run=TestPiRPCHelper", "--"}
}

func emitJSON(writer *bufio.Writer, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	writer.Write(data)
	writer.WriteByte('\n')
}

func hasArg(args []string, name string) bool {
	for _, arg := range args {
		if arg == name {
			return true
		}
	}
	return false
}

func hasArgPair(args []string, name, value string) bool {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == name && args[index+1] == value {
			return true
		}
	}
	return false
}

func waitCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition did not become true")
}

func waitSnapshot(t *testing.T, manager *agent.Manager, agentID string, condition func(agent.Snapshot) bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Get(agentID)
		if err == nil && condition(snapshot) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	snapshot, err := manager.Get(agentID)
	t.Fatalf("condition did not become true; snapshot=%+v err=%v", snapshot, err)
}
