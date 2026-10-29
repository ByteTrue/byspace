package ssh

import (
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/proc"
	"net"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// stderrLimit bounds the captured stderr. A failing ssh can emit a wall of diagnostics; the first
// lines carry the reason and the rest is noise in a one-line CLI error.
const stderrLimit = 8192

// Tunnel is a local listener backed by an ssh process.
type Tunnel struct {
	// Endpoint is the local address to point the daemon client at.
	Endpoint string

	listener net.Listener
	mu       sync.Mutex
	conn     net.Conn
	child    *exec.Cmd
	stderr   strings.Builder
	failure  string
	stopped  bool
}

// Open starts the local listener. The connection that triggers ssh comes from the caller dialling
// Endpoint.
//
// The first connection launches ssh rather than doing it eagerly: binding a port is instant and
// starting a process is not, so the CLI can report success only once something is actually using
// the tunnel. That ordering is what the TypeScript version does too.
func Open(target Target) (*Tunnel, error) {
	args, err := BuildArgs(target)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	tunnel := &Tunnel{listener: listener, Endpoint: listener.Addr().String()}
	go tunnel.accept(args)
	return tunnel, nil
}

// accept handles the single connection the client makes.
func (t *Tunnel) accept(args []string) {
	conn, err := t.listener.Accept()
	if err != nil {
		return
	}
	// One connection is all the daemon client needs; keeping the listener open leaves a port
	// exposed for anyone else on the machine.
	_ = t.listener.Close()

	t.mu.Lock()
	t.conn = conn
	t.mu.Unlock()

	child := proc.Command("ssh", args...)
	stdin, stdinErr := child.StdinPipe()
	stdout, stdoutErr := child.StdoutPipe()
	if stdinErr != nil || stdoutErr != nil {
		t.fail("cannot wire ssh stdio")
		return
	}
	stderr, stderrErr := child.StderrPipe()
	if stderrErr != nil {
		t.fail("cannot wire ssh stderr")
		return
	}
	if startErr := child.Start(); startErr != nil {
		t.fail(fmt.Sprintf("cannot start ssh: %v", startErr))
		return
	}

	t.mu.Lock()
	t.child = child
	t.mu.Unlock()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := stderr.Read(buf)
			if n > 0 {
				t.appendStderr(string(buf[:n]))
			}
			if readErr != nil {
				return
			}
		}
	}()

	// Bidirectional copy; either direction ending tears the tunnel down, because a half-open
	// tunnel is indistinguishable from a hung daemon on the client's side.
	var once sync.Once
	finish := func() {
		once.Do(func() {
			_ = conn.Close()
			if child.Process != nil {
				_ = child.Process.Kill()
			}
		})
	}
	go func() {
		_, _ = copyStream(stdin, conn)
		finish()
	}()
	go func() {
		_, _ = copyStream(conn, stdout)
		finish()
	}()
	go func() {
		waitErr := child.Wait()
		if waitErr != nil && !t.isStopped() {
			t.fail(t.formatFailure(waitErr))
		}
		finish()
	}()
}

// Close stops the tunnel.
func (t *Tunnel) Close() {
	t.mu.Lock()
	t.stopped = true
	conn := t.conn
	child := t.child
	t.mu.Unlock()

	if conn != nil {
		_ = conn.Close()
	}
	if child != nil && child.Process != nil {
		_ = child.Process.Kill()
	}
}

// FailureDetail reports why the tunnel failed, or "" when it has not.
//
// Carries the ssh stderr when there is any: "Permission denied (publickey)" tells the user what to
// fix, while "ssh exited with code 255" does not.
func (t *Tunnel) FailureDetail() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.failure != "" {
		return t.failure
	}
	return strings.TrimSpace(t.stderr.String())
}

func (t *Tunnel) isStopped() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stopped
}

func (t *Tunnel) fail(detail string) {
	t.mu.Lock()
	if t.failure == "" {
		t.failure = detail
	}
	t.mu.Unlock()
}

func (t *Tunnel) appendStderr(chunk string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stderr.WriteString(chunk)
	if t.stderr.Len() > stderrLimit {
		kept := t.stderr.String()
		t.stderr.Reset()
		t.stderr.WriteString(kept[len(kept)-stderrLimit:])
	}
}

// formatFailure turns an ssh exit into a sentence.
func (t *Tunnel) formatFailure(err error) string {
	t.mu.Lock()
	stderr := strings.TrimSpace(t.stderr.String())
	t.mu.Unlock()
	if stderr != "" {
		return stderr
	}
	return "ssh exited: " + err.Error()
}

// copyStream copies src to dst until one end closes.
func copyStream(dst interface{ Write([]byte) (int, error) }, src interface{ Read([]byte) (int, error) }) (int64, error) {
	buf := make([]byte, 32*1024)
	var written int64
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			writtenNow, writeErr := dst.Write(buf[:n])
			written += int64(writtenNow)
			if writeErr != nil {
				return written, writeErr
			}
		}
		if readErr != nil {
			return written, readErr
		}
	}
}

// WaitForListener polls until the local listener accepts a connection, or the deadline passes.
//
// Tests use it instead of sleeping: the listener appears within milliseconds and a fixed sleep
// makes the test either slow or flaky.
func (t *Tunnel) WaitForListener(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		probe, err := net.DialTimeout("tcp", t.Endpoint, 100*time.Millisecond)
		if err == nil {
			_ = probe.Close()
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

// ErrNoSSH reports that the ssh binary is missing.
var ErrNoSSH = errors.New("ssh is not available")
