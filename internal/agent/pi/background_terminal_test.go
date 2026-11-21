package pi

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/jsonl"
)

// Set the Pi CLI and extension paths to exercise the real subprocess and bridge.
func TestBackgroundTerminalRPC(t *testing.T) {
	cli := os.Getenv("BYSPACE_TEST_PI_CLI")
	ext := os.Getenv("BYSPACE_TEST_BACKGROUND_TERMINAL")
	if cli == "" || ext == "" {
		t.Skip("set BYSPACE_TEST_PI_CLI and BYSPACE_TEST_BACKGROUND_TERMINAL")
	}
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	t.Setenv("BYSPACE_PI_EXTENSION_PATH", "")
	bridge, cleanup, err := WriteIntegrationExtension(ExtensionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	fixture := filepath.Join(dir, "fixture.ts")
	source := `
import { manager } from EXTENSION;
export default function (pi) {
  let ids = [];
  pi.registerCommand("start_fixture", {
    description: "Start test tasks",
    handler: async (_, ctx) => {
      const ops = { exec: (_, __, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) };
      const session = ctx.sessionManager.getSessionId();
      ids = [manager.start("first", ctx.cwd, session, { operations: ops }).id,
             manager.start("second", ctx.cwd, session, { operations: ops }).id,
             manager.start("foreign", ctx.cwd, "foreign-session", { operations: ops }).id];
      await manager.clearSession("foreign-session");
    },
  });
}
`
	extPath, _ := json.Marshal(filepath.ToSlash(ext))
	if err := os.WriteFile(fixture, []byte(strings.Replace(source, "EXTENSION", string(extPath), 1)), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	start := func(paths ...string) *Session {
		s, err := StartSession(LaunchOptions{Command: "node", Args: []string{cli, "--no-extensions"}, Cwd: dir, NoSession: true, ExtensionPaths: paths})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { s.Close() })
		return s
	}
	without := start(bridge)
	if roster, err := without.ManageBackgroundTerminal(ctx, ""); err != nil || roster != nil {
		t.Fatalf("unavailable: %+v, %v", roster, err)
	}
	without.Close()
	s := start(bridge, ext, fixture)
	if roster, err := s.ManageBackgroundTerminal(ctx, ""); err != nil || roster == nil || len(roster) != 0 {
		t.Fatalf("empty: %+v, %v", roster, err)
	}
	if _, err := s.proc.Request(ctx, map[string]any{"type": "prompt", "message": "/start_fixture"}); err != nil {
		t.Fatal(err)
	}
	roster, err := s.ManageBackgroundTerminal(ctx, "")
	if err != nil || len(roster) != 2 {
		t.Fatalf("launch: %+v, %v", roster, err)
	}
	if _, err = s.ManageBackgroundTerminal(ctx, "bg_0000000000000000"); err == nil {
		t.Fatal("unknown task was accepted")
	}
	updated, err := s.ManageBackgroundTerminal(ctx, roster[0].ID)
	if err != nil || len(updated) != 2 {
		t.Fatalf("stop: %+v, %v", updated, err)
	}
	for _, task := range updated {
		if (task.ID == roster[0].ID && task.Status != "killed") || (task.ID == roster[1].ID && task.Status != "running") {
			t.Fatalf("unexpected stop result: %+v", updated)
		}
	}
	t.Logf("initial=%+v after stop=%+v", roster, updated)
}

// An extension that updates independently can invent a new status; the daemon must keep the row
// visible and stoppable instead of failing the client's whole-frame enum validation.
func TestBackgroundTerminalStatusNormalization(t *testing.T) {
	s := &Session{commandWaiters: make(map[string]chan commandResult)}
	// A parking helper process answers the prompt RPC; the roster itself arrives through the
	// command-result waiter below.
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s.proc, err = jsonl.Start(jsonl.LaunchConfig{Command: binary, Args: []string{"-test.run=^TestSubagentReplayHelperProcess$", "--"}, Env: append(os.Environ(), "BYSPACE_SUBAGENT_REPLAY_HELPER=1")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.proc.Close() })
	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			s.mu.Lock()
			var ch chan commandResult
			for _, waiter := range s.commandWaiters {
				ch = waiter
			}
			s.mu.Unlock()
			if ch != nil {
				ch <- commandResult{ok: true, result: json.RawMessage(`[{"id":"t1","command":"sleep 9","status":"hibernating"},{"id":"t2","command":"npm run dev","status":"running"}]`)}
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	tasks, err := s.ManageBackgroundTerminal(context.Background(), "")
	if err != nil || len(tasks) != 2 || tasks[0].Status != "running" || tasks[1].Status != "running" {
		t.Fatalf("normalization: %+v, %v", tasks, err)
	}
}
