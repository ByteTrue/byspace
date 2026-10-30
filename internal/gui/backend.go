package gui

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"strconv"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/proc"
	"github.com/ByteTrue/byspace/internal/server"
)

const defaultDesktopDaemonAddr = "127.0.0.1:6777"

// NormalizeDeepLink turns a byspace:// URL or #offer=... fragment into the initial SPA path/hash.
func NormalizeDeepLink(link string) string {
	trimmed := strings.TrimSpace(link)
	if trimmed == "" {
		return "/"
	}
	if strings.HasPrefix(trimmed, "byspace://") {
		rest := strings.TrimPrefix(trimmed, "byspace://")
		rest = strings.TrimPrefix(rest, "/")
		if strings.HasPrefix(rest, "#") {
			return "/" + rest
		}
		if strings.HasPrefix(rest, "offer=") {
			return "/#" + rest
		}
		return "/" + rest
	}
	if strings.HasPrefix(trimmed, "#") {
		return "/" + trimmed
	}
	return "/"
}

// ResolveDesktopDaemonAddr returns the loopback address the desktop app attaches to or serves on.
// Respects BYSPACE_LISTEN, BYSPACE_PORT, and defaults .dev/byspace-home checkouts to port 6778 so
// dev desktop runs never collide with the production daemon on 6777.
func ResolveDesktopDaemonAddr() string {
	if v := strings.TrimSpace(os.Getenv("BYSPACE_LISTEN")); v != "" {
		return v
	}
	if p := strings.TrimSpace(os.Getenv("BYSPACE_PORT")); p != "" {
		if strings.Contains(p, ":") {
			return p
		}
		return "127.0.0.1:" + p
	}
	if h := strings.TrimSpace(os.Getenv("BYSPACE_HOME")); strings.Contains(filepath.ToSlash(h), ".dev/byspace-home") {
		return "127.0.0.1:6778"
	}
	return defaultDesktopDaemonAddr
}

// ProbeDaemonInfo queries /health on addr and returns whether a daemon is answering along with its version.
func ProbeDaemonInfo(addr string) (ok bool, version string) {
	target, err := daemon.ParseListenTarget(addr)
	if err != nil || target.Kind != "tcp" {
		return false, ""
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get("http://" + target.Address() + "/health")
	if err != nil {
		return false, ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, ""
	}
	var payload struct {
		OK      bool   `json:"ok"`
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, ""
	}
	healthy := payload.OK || strings.EqualFold(payload.Status, "ok")
	return healthy, payload.Version
}

// ProbeDaemonHealth reports whether a BySpace daemon is already answering /health on addr.
func ProbeDaemonHealth(addr string) bool {
	ok, _ := ProbeDaemonInfo(addr)
	return ok
}

// DaemonHostStatus describes who is currently serving the local daemon port (ported from
// magpie's gatewayFixJSON / ServedBy).
type DaemonHostStatus struct {
	InProcess      bool   `json:"inProcess"`
	Healthy        bool   `json:"healthy"`
	Addr           string `json:"addr"`
	RunningVersion string `json:"runningVersion,omitempty"`
	ExternalPID    int    `json:"externalPid,omitempty"`
	ExternalPath   string `json:"externalPath,omitempty"`
	Reason         string `json:"reason,omitempty"` // "" | "external-byspace" | "container" | "not-byspace" | "offline"
}

// DaemonSupervisor manages the Magpie-style primary/replica daemon lifecycle for the desktop app:
// if an external daemon is already listening on Addr, the desktop app attaches to it and polls
// every WatchInterval; if it exits (or was never running), the desktop app seamlessly starts an
// in-process server.Server on Addr.
type DaemonSupervisor struct {
	Addr          string
	HomeDir       string
	Version       string
	WatchInterval time.Duration

	mu        sync.Mutex
	srv       *server.Server
	httpSrv   *http.Server
	ln        net.Listener
	ownsPID   int
	lastBusy  time.Time
	stopWatch chan struct{}
	closed    bool
}

// Start either attaches to an existing daemon on Addr (and watches for its exit) or starts an
// in-process daemon immediately. On Android it is a no-op because the mobile app is a remote client.
func (d *DaemonSupervisor) Start() error {
	if runtime.GOOS == "android" {
		return nil
	}
	d.mu.Lock()
	if d.Addr == "" {
		d.Addr = ResolveDesktopDaemonAddr()
	}
	if d.WatchInterval <= 0 {
		d.WatchInterval = 15 * time.Second
	}
	if d.stopWatch == nil {
		d.stopWatch = make(chan struct{})
	}
	addr := d.Addr
	d.mu.Unlock()

	if !ProbeDaemonHealth(addr) {
		if err := d.startInProcess(); err != nil && !ProbeDaemonHealth(addr) {
			return err
		}
	}

	go d.watchLoop()
	return nil
}

// OwnsInProcessDaemon reports whether this desktop process is currently serving the daemon in-process.
func (d *DaemonSupervisor) OwnsInProcessDaemon() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.srv != nil
}

// Status inspects the current daemon ownership and any external process holding Addr.
func (d *DaemonSupervisor) Status() DaemonHostStatus {
	if d == nil {
		return DaemonHostStatus{}
	}
	d.mu.Lock()
	owned := d.srv != nil
	addr := d.Addr
	ver := d.Version
	d.mu.Unlock()

	if owned {
		return DaemonHostStatus{
			InProcess:      true,
			Healthy:        true,
			Addr:           addr,
			RunningVersion: ver,
		}
	}

	healthy, extVer := ProbeDaemonInfo(addr)
	st := DaemonHostStatus{
		InProcess:      false,
		Healthy:        healthy,
		Addr:           addr,
		RunningVersion: extVer,
		Reason:         "offline",
	}

	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return st
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		return st
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	pids, _ := proc.ListeningOn(ctx, port)
	for _, pid := range pids {
		if pid == os.Getpid() {
			continue
		}
		st.ExternalPID = pid
		st.ExternalPath, _ = proc.Executable(pid)
		switch {
		case proc.IsContainerForwarder(st.ExternalPath):
			st.Reason = "container"
		case proc.IsBySpace(st.ExternalPath) || healthy:
			st.Reason = "external-byspace"
		default:
			st.Reason = "not-byspace"
		}
		break
	}
	if st.ExternalPID == 0 && healthy {
		st.Reason = "external-byspace"
	}
	return st
}

// TakeOver terminates an external BySpace daemon listening on Addr and starts the daemon
// in-process inside this desktop client (ported from magpie's takeOverGateway).
func (d *DaemonSupervisor) TakeOver() DaemonHostStatus {
	if d == nil {
		return DaemonHostStatus{}
	}
	if d.OwnsInProcessDaemon() {
		return d.Status()
	}
	st := d.Status()
	if st.Reason == "not-byspace" || st.Reason == "container" {
		return st
	}
	if st.ExternalPID > 0 && (proc.IsBySpace(st.ExternalPath) || st.Healthy) {
		_ = proc.Terminate(st.ExternalPID)
		deadline := time.Now().Add(4 * time.Second)
		for time.Now().Before(deadline) {
			if !ProbeDaemonHealth(st.Addr) {
				break
			}
			time.Sleep(80 * time.Millisecond)
		}
		if ProbeDaemonHealth(st.Addr) {
			_ = proc.Kill(st.ExternalPID)
			time.Sleep(150 * time.Millisecond)
		}
	}
	_ = d.startInProcess()
	return d.Status()
}

// BusyState reports whether the in-process daemon currently has any running agent turn or
// pending permission request, and the last timestamp at which it was observed busy.
func (d *DaemonSupervisor) BusyState() (busy bool, lastBusy time.Time) {
	if d == nil {
		return false, time.Time{}
	}
	d.mu.Lock()
	srv := d.srv
	last := d.lastBusy
	d.mu.Unlock()
	if srv != nil && srv.HasActiveAgentWork() {
		now := time.Now()
		d.mu.Lock()
		d.lastBusy = now
		d.mu.Unlock()
		return true, now
	}
	return false, last
}

func (d *DaemonSupervisor) watchLoop() {
	ticker := time.NewTicker(d.WatchInterval)
	defer ticker.Stop()
	for {
		select {
		case <-d.stopWatch:
			return
		case <-ticker.C:
			d.mu.Lock()
			closed := d.closed
			owned := d.srv != nil
			addr := d.Addr
			d.mu.Unlock()
			if closed {
				return
			}
			if !owned && !ProbeDaemonHealth(addr) {
				_ = d.startInProcess()
			}
		}
	}
}

func (d *DaemonSupervisor) startInProcess() error {
	d.mu.Lock()
	if d.closed || d.srv != nil {
		d.mu.Unlock()
		return nil
	}
	addr := d.Addr
	homeDir := d.HomeDir
	version := d.Version
	d.mu.Unlock()

	target, err := daemon.ParseListenTarget(addr)
	if err != nil {
		return err
	}
	ln, err := target.Listen()
	if err != nil {
		return err
	}
	boundAddr := target.Address()

	srv, err := server.New(server.Options{
		HomeDir:    homeDir,
		Version:    version,
		ListenAddr: boundAddr,
	})
	if err != nil {
		_ = ln.Close()
		return err
	}

	myPID := os.Getpid()
	exeName := ""
	if exe, exeErr := os.Executable(); exeErr == nil {
		exeName = filepath.Base(exe)
	}
	_ = daemon.WritePIDLock(srv.HomeDir(), daemon.PIDLockInfo{
		PID:     myPID,
		Listen:  &boundAddr,
		ExeName: exeName,
	})

	httpSrv := &http.Server{Handler: srv}

	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		_ = ln.Close()
		_ = srv.Close()
		daemon.RemovePID(srv.HomeDir(), myPID)
		return fmt.Errorf("supervisor closed")
	}
	d.Addr = boundAddr
	d.HomeDir = srv.HomeDir()
	d.srv = srv
	d.httpSrv = httpSrv
	d.ln = ln
	d.ownsPID = myPID
	d.mu.Unlock()

	stopWatch := d.stopWatch
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopWatch:
				return
			case <-ticker.C:
				d.mu.Lock()
				stillOwned := !d.closed && d.srv == srv
				d.mu.Unlock()
				if !stillOwned {
					return
				}
				daemon.TouchPIDLock(srv.HomeDir())
			}
		}
	}()

	go func() {
		_ = httpSrv.Serve(ln)
	}()
	return nil
}

// Close stops the watcher and shuts down the in-process daemon if this supervisor started one.
// An external daemon that was already running before the desktop app opened is left untouched.
func (d *DaemonSupervisor) Close() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	if d.stopWatch != nil {
		close(d.stopWatch)
	}
	httpSrv := d.httpSrv
	srv := d.srv
	homeDir := d.HomeDir
	ownsPID := d.ownsPID
	d.httpSrv = nil
	d.srv = nil
	d.ln = nil
	d.mu.Unlock()

	if httpSrv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	}
	if srv != nil {
		_ = srv.Close()
	}
	if ownsPID > 0 && homeDir != "" {
		daemon.RemovePID(homeDir, ownsPID)
	}
	return nil
}
