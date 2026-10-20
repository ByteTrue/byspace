package server

import (
	"fmt"
	"net"
	"sync"
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
