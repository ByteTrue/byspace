package providers

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

// Advertising `terminal: true` without implementing the methods leaves every such request
// unanswered: the agent waits for a terminal id that never arrives and the turn stalls.
func TestACPTerminalLifecycle(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	// A real writer for the RPC responses; a nil stdin would panic in sendJSON.
	var out strings.Builder
	sess := &ACPSession{
		stdin:        nopWriteCloser{&out},
		acpTerminals: map[string]*acpTerminal{},
		pending:      map[int64]chan map[string]any{},
	}

	// Create: a command that exits immediately with output.
	sess.acpCreateTerminal("r1", map[string]any{
		"command": "/bin/sh",
		"args":    []any{"-c", "echo hello-output"},
	})

	sess.acpTerminalsMu.Lock()
	terminal, ok := sess.acpTerminals["acp_term_r1"]
	sess.acpTerminalsMu.Unlock()
	if !ok {
		t.Fatal("the terminal was not registered")
	}
	if terminal.id != "acp_term_r1" {
		t.Fatalf("id = %q", terminal.id)
	}

	<-terminal.done
	output, truncated := terminal.snapshot()
	if !strings.Contains(output, "hello-output") {
		t.Fatalf("output = %q", output)
	}
	if truncated {
		t.Fatal("short output must not report truncation")
	}

	// Release removes it, so the buffer does not live for the whole session.
	sess.acpReleaseTerminal("r2", map[string]any{"terminalId": terminal.id})
	sess.acpTerminalsMu.Lock()
	_, stillThere := sess.acpTerminals[terminal.id]
	sess.acpTerminalsMu.Unlock()
	if stillThere {
		t.Fatal("release must drop the entry")
	}
}

// The byte limit keeps the TAIL: a build's last lines are what matters, and the beginning is what
// a long log buries.
func TestACPTerminalOutputByteLimitKeepsTail(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	terminal := &acpTerminal{byteLimit: 10}
	terminal.appendOutput("first-chunk-")
	terminal.appendOutput("last-chunk")
	output, truncated := terminal.snapshot()
	if !truncated {
		t.Fatal("exceeding the limit must report truncation")
	}
	if len(output) > 10 {
		t.Fatalf("output is %d bytes, limit was 10", len(output))
	}
	if !strings.HasSuffix(output, "last-chunk") {
		t.Fatalf("the tail was not kept: %q", output)
	}
}

// nopWriteCloser is a write-only sink for tests.
type nopWriteCloser struct{ w *strings.Builder }

func (n nopWriteCloser) Write(p []byte) (int, error) { return n.w.Write(p) }
func (n nopWriteCloser) Close() error                { return nil }

// These are our children: when the ACP process dies the requests stop coming, and a build left
// behind becomes an orphan that keeps writing to stdout and holding a port.
func TestACPTerminalsAreKilledWhenSessionEnds(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	var out strings.Builder
	sess := &ACPSession{
		stdin:        nopWriteCloser{&out},
		acpTerminals: map[string]*acpTerminal{},
	}

	sess.acpCreateTerminal("r1", map[string]any{
		"command": "/bin/sh",
		"args":    []any{"-c", "sleep 30"},
	})

	sess.acpTerminalsMu.Lock()
	terminal := sess.acpTerminals["acp_term_r1"]
	sess.acpTerminalsMu.Unlock()
	if terminal == nil {
		t.Fatal("terminal not registered")
	}

	// Simulate the session ending: the cleanup path kills the whole group. It has to be the group:
	// `sh -c "sleep 30"` is killed between forking and execing under load sometimes, and the
	// surviving `sleep` holds the stdout pipe, so the drain goroutines never see EOF and the
	// terminal is never reaped.
	_ = killProcessGroup(terminal.cmd, true)
	select {
	case <-terminal.done:
	case <-time.After(5 * time.Second):
		t.Fatal("the child was not reaped")
	}
}
