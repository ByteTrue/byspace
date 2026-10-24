package server

import (
	"bytes"
	"context"
	"fmt"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/workspace"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// servicePortAllocator hands out stable local ports for `type: "service"` scripts.
//
// Ported in spirit from workspace-service-port-registry.ts. A dev server needs one stable port
// per (workspace, script) so its URL keeps working across restarts, and it needs to be told which
// port to bind via the environment rather than guessing.
//
// The port is allocated by asking the OS for a free one and remembering the assignment, so two
// workspaces never collide and a restart reuses the same number.
type servicePortAllocator struct {
	mu       sync.Mutex
	assigned map[string]int
}

func newServicePortAllocator() *servicePortAllocator {
	return &servicePortAllocator{assigned: make(map[string]int)}
}

func (a *servicePortAllocator) key(workspaceID, scriptName string) string {
	return workspaceID + "\x00" + scriptName
}

// Allocate returns the port for a (workspace, script) pair, allocating on first use.
// A positive `requested` is honoured when it is free.
func (a *servicePortAllocator) Allocate(workspaceID, scriptName string, requested int) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	key := a.key(workspaceID, scriptName)
	if port, ok := a.assigned[key]; ok {
		return port, nil
	}

	if requested > 0 {
		// Reject a port this allocator already handed out: the other script may not have bound
		// it yet, so a bindability check alone would happily hand out a duplicate.
		for otherKey, port := range a.assigned {
			if port == requested && otherKey != key {
				return 0, fmt.Errorf("port %d requested by script %q is already assigned to another script", requested, scriptName)
			}
		}
		if isPortFree(requested) {
			a.assigned[key] = requested
			return requested, nil
		}
		return 0, fmt.Errorf("port %d requested by script %q is already in use", requested, scriptName)
	}

	port, err := pickFreePort()
	if err != nil {
		return 0, err
	}
	a.assigned[key] = port
	return port, nil
}

// Release frees the assignment so the next start can take a different port.
func (a *servicePortAllocator) Release(workspaceID, scriptName string) {
	a.mu.Lock()
	delete(a.assigned, a.key(workspaceID, scriptName))
	a.mu.Unlock()
}

// Lookup reports the current assignment without allocating.
func (a *servicePortAllocator) Lookup(workspaceID, scriptName string) (int, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	port, ok := a.assigned[a.key(workspaceID, scriptName)]
	return port, ok
}

func pickFreePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	if addr, ok := ln.Addr().(*net.TCPAddr); ok {
		return addr.Port, nil
	}
	return 0, fmt.Errorf("could not determine an allocated port")
}

func isPortFree(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

// Port range allocation, ported from workspace-service-port-allocator.ts.
//
// Three strategies exist because different projects have different constraints: some need a
// fixed window (a firewall rule, a container port map), some need a project-specific script to
// decide (a port an external service already advertises), and everything else just wants any
// free port.

// PortRange is an inclusive window to allocate inside.
type PortRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// ParsePortRange reads "3000-3010" into a range.
func ParsePortRange(spec string) (PortRange, error) {
	trimmed := strings.TrimSpace(spec)
	if trimmed == "" {
		return PortRange{}, fmt.Errorf("port range is empty")
	}
	startText, endText, found := strings.Cut(trimmed, "-")
	if !found {
		// A single port is a range of one.
		port, err := strconv.Atoi(trimmed)
		if err != nil || port < 1 || port > 65535 {
			return PortRange{}, fmt.Errorf("invalid port %q", spec)
		}
		return PortRange{Start: port, End: port}, nil
	}
	start, err1 := strconv.Atoi(strings.TrimSpace(startText))
	end, err2 := strconv.Atoi(strings.TrimSpace(endText))
	if err1 != nil || err2 != nil || start < 1 || end > 65535 || start > end {
		return PortRange{}, fmt.Errorf("invalid port range %q", spec)
	}
	return PortRange{Start: start, End: end}, nil
}

// AllocateFromRange returns the first port in the window that is free and unassigned.
func (a *servicePortAllocator) AllocateFromRange(r PortRange, reserved map[int]bool) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	inUse := make(map[int]bool, len(a.assigned)+len(reserved))
	for _, port := range a.assigned {
		inUse[port] = true
	}
	for port := range reserved {
		inUse[port] = true
	}

	for port := r.Start; port <= r.End; port++ {
		if inUse[port] {
			continue
		}
		if !isPortFree(port) {
			continue
		}
		return port, nil
	}
	return 0, fmt.Errorf("no free port in range %d-%d", r.Start, r.End)
}

// AllocatePortFromScript runs the project's port script and validates its answer.
//
// The script receives (scriptName, workspaceId, branchName, cwd) and prints one port on stdout.
// Its output is untrusted: an arbitrary number would be used as a bind port, so it is range
// checked before acceptance.
func AllocatePortFromScript(ctx context.Context, command, cwd, scriptName, workspaceID, branchName string) (int, error) {
	if strings.TrimSpace(command) == "" {
		return 0, fmt.Errorf("port script command is empty")
	}

	sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// The script gets its four arguments positionally, and again in the environment. Both are part of
	// the contract: docs/worktrees.html tells authors the BYSPACE_* variables are set, while a script
	// that reads "$1" (or a language runtime's argv) must keep working too.
	//
	// The positional form is expressed inside the shell command rather than as extra exec arguments.
	// `bash -c "<cmd>" a b` binds `a` to $0 of the *shell*, and a script the command line invokes
	// does not inherit them — `node port.js` would start with an empty argv either way.
	invocation := workspace.PortScriptInvocation(command, []string{scriptName, workspaceID, branchName, cwd})
	cmd := exec.CommandContext(sctx, invocation.Shell, invocation.Args...)
	cmd.Dir = cwd
	cmd.Env = home.ExternalProcessEnv(os.Environ())
	cmd.Env = append(cmd.Env,
		"BYSPACE_SCRIPTNAME="+scriptName,
		"BYSPACE_WORKSPACE_ID="+workspaceID,
		"BYSPACE_BRANCH_NAME="+branchName,
		"BYSPACE_WORKTREE_PATH="+cwd,
	)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("port script failed: %w", err)
	}

	// Bound the output: a script that prints a log banner must not be parsed as a port.
	out := strings.TrimSpace(stdout.String())
	if len(out) > 1024 {
		out = out[:1024]
	}
	port, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, fmt.Errorf("port script printed %q, which is not a port", strings.TrimSpace(out))
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("port script returned out-of-range port %d", port)
	}
	return port, nil
}
