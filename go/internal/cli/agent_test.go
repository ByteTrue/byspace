package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"byspace/internal/agent"
	"byspace/internal/daemon"
)

func TestAgentCLIListsAndFollowsDaemonTimeline(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	session := &cliTestSession{events: make(chan agent.ProviderEvent, 1024)}
	manager := agent.NewManager(map[string]agent.Provider{"pi": cliTestProvider{session: session}})
	daemonCtx, stopDaemon := context.WithCancel(context.Background())
	daemonDone := make(chan error, 1)
	go func() {
		daemonDone <- daemon.Run(daemonCtx, daemon.Options{
			Home: home, Listen: "0.0.0.0:0", WorkspaceRoot: workspace, AgentManager: manager,
		})
	}()
	waitForCLITestDaemon(t, home)
	defer func() {
		stopDaemon()
		if err := <-daemonDone; err != nil {
			t.Errorf("daemon shutdown: %v", err)
		}
	}()

	snapshot, err := manager.Create(context.Background(), agent.Config{
		Provider: "pi", CWD: workspace, Title: "CLI observer",
	})
	if err != nil {
		t.Fatal(err)
	}

	var listOutput, listError bytes.Buffer
	if code := Run([]string{"agent", "list", "--home", home, "--json"}, &listOutput, &listError); code != 0 {
		t.Fatalf("agent list exit = %d, stderr = %s", code, listError.String())
	}
	if !strings.Contains(listOutput.String(), snapshot.ID) || !strings.Contains(listOutput.String(), "CLI observer") {
		t.Fatalf("agent list output = %s", listOutput.String())
	}

	followCtx, stopFollow := context.WithCancel(context.Background())
	var followOutput lockedBuffer
	var followError lockedBuffer
	followDone := make(chan int, 1)
	go func() {
		followDone <- runAgentTimelineContext(
			followCtx,
			[]string{snapshot.ID, "--home", home, "--follow", "--json"},
			&followOutput,
			&followError,
		)
	}()

	if _, err := manager.Send(context.Background(), snapshot.ID, "cli-first", "first"); err != nil {
		t.Fatal(err)
	}
	waitForBuffer(t, &followOutput, "echo:first")
	if _, err := manager.Send(context.Background(), snapshot.ID, "cli-second", "second"); err != nil {
		t.Fatal(err)
	}
	waitForBuffer(t, &followOutput, "echo:second")
	if _, err := manager.Send(context.Background(), snapshot.ID, "cli-burst", "burst"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		timeline, timelineErr := manager.Timeline(snapshot.ID)
		if timelineErr != nil {
			t.Fatal(timelineErr)
		}
		if len(timeline.Rows) >= 305 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("manager Timeline has %d rows, want 305", len(timeline.Rows))
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case code := <-followDone:
		t.Fatalf("agent timeline exited early with %d: %s", code, followError.String())
	default:
	}
	waitForBuffer(t, &followOutput, "echo:burst-299")
	stopFollow()
	if code := <-followDone; code != 0 {
		t.Fatalf("agent timeline exit = %d, stderr = %s", code, followError.String())
	}
	output := followOutput.String()
	if len(output) <= 2<<20 {
		t.Fatalf("Timeline output is %d bytes, want more than 2 MiB", len(output))
	}
	var previous uint64
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		var entry timelineEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("decode Timeline output %q: %v", line, err)
		}
		if previous != 0 && entry.SeqStart != previous+1 {
			t.Fatalf("Timeline output gap: %d followed %d", previous, entry.SeqStart)
		}
		previous = entry.SeqStart
	}
}

func TestAgentCLIRejectsEmptyAndRepeatedRemoteHostFlags(t *testing.T) {
	for _, test := range []struct {
		name string
		args []string
		run  func([]string, io.Writer, io.Writer) int
	}{
		{name: "list empty", args: []string{"--host="}, run: runAgentList},
		{name: "list repeated", args: []string{"--host", "srv_abcdefghijkl", "--host", "srv_mnopqrstuvwx"}, run: runAgentList},
	} {
		t.Run(test.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := test.run(test.args, &stdout, &stderr); code != 2 {
				t.Fatalf("exit = %d, stderr = %q", code, stderr.String())
			}
		})
	}

	for _, args := range [][]string{
		{"agent-1", "--host="},
		{"agent-1", "--host", "srv_abcdefghijkl", "--host", "srv_mnopqrstuvwx"},
	} {
		var stdout, stderr bytes.Buffer
		if code := runAgentTimelineContext(t.Context(), args, &stdout, &stderr); code != 2 {
			t.Fatalf("timeline args %v exit = %d, stderr = %q", args, code, stderr.String())
		}
	}
}

func TestAgentCLIRejectsUnknownRemoteHost(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := runAgentList(
		[]string{"--host", "srv_abcdefghijkl", "--home", t.TempDir()},
		&stdout,
		&stderr,
	); code != 1 {
		t.Fatalf("unknown host exit = %d, stderr = %q", code, stderr.String())
	}
}

func waitForCLITestDaemon(t *testing.T, home string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		status, err := daemon.Inspect(ctx, home)
		cancel()
		if err == nil && status.LocalDaemon == "running" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("daemon did not become ready")
}

func waitForBuffer(t *testing.T, buffer *lockedBuffer, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(buffer.String(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("output did not contain %q: %s", want, buffer.String())
}

type lockedBuffer struct {
	mu sync.Mutex
	bytes.Buffer
}

func (buffer *lockedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.Buffer.Write(data)
}

func (buffer *lockedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.Buffer.String()
}

type cliTestProvider struct {
	session *cliTestSession
}

func (provider cliTestProvider) Start(context.Context, agent.Config) (agent.Session, error) {
	return provider.session, nil
}

type cliTestSession struct {
	events chan agent.ProviderEvent
	once   sync.Once
}

func (session *cliTestSession) RuntimeInfo() agent.RuntimeInfo {
	return agent.RuntimeInfo{Provider: "pi", SessionID: "cli-test"}
}

func (session *cliTestSession) Capabilities() agent.Capabilities {
	return agent.Capabilities{SupportsStreaming: true}
}

func (session *cliTestSession) Events() <-chan agent.ProviderEvent { return session.events }

func (session *cliTestSession) Prompt(_ context.Context, turnID, text string) error {
	count := 1
	if text == "burst" {
		count = 300
	}
	for index := range count {
		echo := "echo:" + text
		if count > 1 {
			size := 4096
			if index == 0 {
				size = 1<<20 + 1
			}
			echo = fmt.Sprintf("echo:%s-%d:%s", text, index, strings.Repeat("x", size))
		}
		session.events <- agent.ProviderEvent{
			Type: agent.ProviderEventTimeline, TurnID: turnID,
			Item: agent.TimelineItem{Type: agent.TimelineAssistantMessage, Text: echo},
		}
	}
	session.events <- agent.ProviderEvent{Type: agent.ProviderEventTurnCompleted, TurnID: turnID}
	return nil
}

func (session *cliTestSession) Abort(context.Context) error { return nil }

func (session *cliTestSession) Close(context.Context) error {
	session.once.Do(func() { close(session.events) })
	return nil
}
