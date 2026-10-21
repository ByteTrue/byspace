package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// OpenCode startup and shutdown budgets, ported from server-manager.ts.
const (
	// OpenCodeServerStartupTimeout bounds how long `opencode serve` may take to answer.
	OpenCodeServerStartupTimeout = 30 * time.Second
	// openCodeGracefulShutdown is how long the server gets to exit on SIGTERM before SIGKILL.
	openCodeGracefulShutdown = 5 * time.Second
	// openCodeForceShutdown is how long to wait after SIGKILL.
	openCodeForceShutdown = 1 * time.Second
)

// openCodeHomeDirName is the subdirectory of the BySpace home that holds OpenCode's own state.
//
// Isolated on purpose: OpenCode writes sessions and credentials under its home, and sharing the user's
// real one would let a BySpace run rewrite configuration the user set up by hand.
const openCodeHomeDirName = "opencode-home"

// OpenCodeServer is one running `opencode serve` process.
type OpenCodeServer struct {
	URL  string
	Port int
	cmd  *exec.Cmd
	// generation increments on every restart; a client holding an old URL must not keep using it.
	generation int
	// retired marks a server that has been replaced and must not be handed out again.
	retired bool
}

// OpenCodePool starts and reuses `opencode serve` processes.
//
// Ported from server-manager.ts. Go had no pool at all: StartOpenCodeSession either connected to an
// OPENCODE_SERVER_URL the user had exported or fell back to ACP, so an OpenCode agent on a machine with no
// manually started server simply did not work — while the UI showed it as running.
type OpenCodePool struct {
	mu sync.Mutex
	// current is the shared server, reused by every agent that has no special environment.
	current *OpenCodeServer
	// starting deduplicates concurrent starts: two agents created at once must not spawn two servers.
	starting chan struct{}
	// started is the result of the in-flight start, read after starting closes.
	started *OpenCodeServer
	// lastErr is the failure the in-flight start ended with.
	lastErr error
	// generation counts restarts.
	generation int

	// command is the opencode binary; args are prepended to `serve`.
	command string
	args    []string
	// homeDir is where the server runs and keeps its state.
	homeDir string
	// env is extra environment for the server process.
	env map[string]string
	// allocPort picks a free port. Overridable for tests.
	allocPort func() (int, error)
	// startProcess launches the server. Overridable for tests.
	startProcess func(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error)
	// probe reports whether a server answers. Overridable for tests, which cannot start a real
	// opencode binary.
	probe func(server *OpenCodeServer) bool
	// startupTimeout bounds the wait for a server to answer. Overridable for tests.
	startupTimeout time.Duration
}

// NewOpenCodePool builds a pool.
func NewOpenCodePool(homeDir, command string, args []string) *OpenCodePool {
	pool := &OpenCodePool{
		command: command,
		args:    args,
		homeDir: filepath.Join(homeDir, openCodeHomeDirName),
	}
	if strings.TrimSpace(pool.command) == "" {
		pool.command = "opencode"
	}
	pool.allocPort = freePort
	pool.startProcess = defaultStartProcess
	pool.probe = probeOpenCodeServer
	pool.startupTimeout = OpenCodeServerStartupTimeout
	return pool
}

// SetEnv replaces the extra environment for the server process.
func (p *OpenCodePool) SetEnv(env map[string]string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.env = env
}

// Acquire returns a live server, starting one if needed.
//
// Every agent shares one server: an OpenCode server hosts many sessions, and one process per agent would
// multiply the ports and the memory for no benefit.
func (p *OpenCodePool) Acquire(ctx context.Context) (*OpenCodeServer, error) {
	p.mu.Lock()
	if p.current != nil && !p.current.retired && p.serverAlive(p.current) {
		server := p.current
		p.mu.Unlock()
		return server, nil
	}
	if p.starting != nil {
		// Someone is already starting one; wait for it rather than spawning a second.
		wait := p.starting
		p.mu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		p.mu.Lock()
		server, err := p.started, p.lastErr
		p.mu.Unlock()
		if err != nil {
			return nil, err
		}
		if server == nil {
			return nil, errors.New("opencode server did not start")
		}
		return server, nil
	}

	p.starting = make(chan struct{})
	wait := p.starting
	p.mu.Unlock()

	server, err := p.startServer(ctx)

	p.mu.Lock()
	p.started, p.lastErr = server, err
	if err == nil && server != nil {
		p.generation++
		server.generation = p.generation
		p.current = server
	}
	p.starting = nil
	p.mu.Unlock()
	close(wait)

	return server, err
}

// AcquireExisting adopts a server the user already runs.
//
// Used when OPENCODE_SERVER_URL is set: the user started their own and expects BySpace to use it rather
// than spawn a second one.
func (p *OpenCodePool) AcquireExisting(rawURL string) *OpenCodeServer {
	trimmed := strings.TrimRight(strings.TrimSpace(rawURL), "/")
	if trimmed == "" {
		return nil
	}
	server := &OpenCodeServer{URL: trimmed}
	if !p.serverAlive(server) {
		return nil
	}
	return server
}

// Shutdown stops the shared server.
func (p *OpenCodePool) Shutdown() {
	p.mu.Lock()
	server := p.current
	p.current = nil
	if server != nil {
		server.retired = true
	}
	p.mu.Unlock()
	if server != nil {
		p.stopServer(server)
	}
}

// startServer launches `opencode serve --port <free>` and waits for it to answer.
func (p *OpenCodePool) startServer(ctx context.Context) (*OpenCodeServer, error) {
	port, err := p.allocPort()
	if err != nil {
		return nil, err
	}
	// The server keeps its own state under the BySpace home: a shared one would rewrite config the user
	// set up by hand.
	if mkErr := os.MkdirAll(p.homeDir, 0o700); mkErr != nil {
		return nil, mkErr
	}

	args := make([]string, 0, len(p.args)+3)
	args = append(args, p.args...)
	args = append(args, "serve", "--port", fmt.Sprint(port))

	env := make([]string, 0, len(p.env)+4)
	env = append(env, os.Environ()...)
	for key, value := range p.env {
		env = append(env, key+"="+value)
	}

	startCtx, cancel := context.WithTimeout(ctx, p.startupTimeout)
	defer cancel()

	cmd, err := p.startProcess(startCtx, p.command, args, p.homeDir, env)
	if err != nil {
		return nil, fmt.Errorf("opencode serve: %w", err)
	}

	server := &OpenCodeServer{
		URL:  fmt.Sprintf("http://127.0.0.1:%d", port),
		Port: port,
		cmd:  cmd,
	}

	// Wait for it to answer rather than assuming it is up: a server that failed to bind returns
	// immediately, and handing out its URL produces "connection refused" from a code path that looks
	// like the session is fine.
	if err := p.waitReady(startCtx, server); err != nil {
		p.stopServer(server)
		return nil, err
	}
	return server, nil
}

// waitReady polls the server until it answers or the budget expires.
func (p *OpenCodePool) waitReady(ctx context.Context, server *OpenCodeServer) error {
	deadline := time.Now().Add(p.startupTimeout)
	for {
		if p.serverAlive(server) {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("opencode serve did not answer on %s within %s", server.URL, p.startupTimeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

// serverAlive reports whether the server answers.
func (p *OpenCodePool) serverAlive(server *OpenCodeServer) bool {
	if server == nil || server.URL == "" {
		return false
	}
	return p.probe(server)
}

// probeOpenCodeServer checks a server's HTTP endpoint.
//
// Any HTTP answer means the process is up: a 4xx from a stricter route is still a live server, and
// treating it as dead would restart a working one on every acquire.
func probeOpenCodeServer(server *OpenCodeServer) bool {
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}}
	response, err := client.Get(server.URL + "/session")
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return true
}

// stopServer terminates the server, escalating to SIGKILL.
func (p *OpenCodePool) stopServer(server *OpenCodeServer) {
	if server == nil || server.cmd == nil || server.cmd.Process == nil {
		return
	}
	// A process that never started has pid 0; signalling the group would hit our own.
	if server.cmd.Process.Pid <= 0 {
		return
	}
	// The whole process group: opencode spawns language servers and MCP children, and killing only the
	// parent leaves them holding ports.
	_ = killProcessGroup(server.cmd, false)
	done := make(chan struct{})
	go func() {
		_, _ = server.cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
		return
	case <-time.After(openCodeGracefulShutdown):
	}
	_ = killProcessGroup(server.cmd, true)
	select {
	case <-done:
	case <-time.After(openCodeForceShutdown):
	}
}

// freePort asks the OS for an unused port.
func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("could not determine a free port")
	}
	return address.Port, nil
}

// sharedOpenCodePool returns the process-wide pool, creating it on first use.
//
// One pool per daemon: every agent shares the one server, and shutting it down with the daemon is what
// stops it. A per-agent pool would spawn a server per agent and leak all but the last.
var (
	sharedPoolMu sync.Mutex
	sharedPool   *OpenCodePool
)

// sharedOpenCodePool returns the daemon's pool, building it for the given home and command.
func sharedOpenCodePool(homeDir, command string, args []string) *OpenCodePool {
	sharedPoolMu.Lock()
	defer sharedPoolMu.Unlock()
	if sharedPool != nil {
		return sharedPool
	}
	sharedPool = NewOpenCodePool(homeDir, command, args)
	return sharedPool
}

// ShutdownOpenCodePool stops the shared server, if one was started.
func ShutdownOpenCodePool() {
	sharedPoolMu.Lock()
	pool := sharedPool
	sharedPool = nil
	sharedPoolMu.Unlock()
	if pool != nil {
		pool.Shutdown()
	}
}
