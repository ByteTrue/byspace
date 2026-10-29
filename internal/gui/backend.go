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

	"github.com/ByteTrue/byspace/internal/daemon"
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
func ResolveDesktopDaemonAddr() string {
	if v := strings.TrimSpace(os.Getenv("BYSPACE_LISTEN")); v != "" {
		return v
	}
	return defaultDesktopDaemonAddr
}

// ProbeDaemonHealth reports whether a BySpace daemon is already answering /health on addr.
func ProbeDaemonHealth(addr string) bool {
	target, err := daemon.ParseListenTarget(addr)
	if err != nil || target.Kind != "tcp" {
		return false
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get("http://" + target.Address() + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var payload struct {
		OK     bool   `json:"ok"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false
	}
	return payload.OK || strings.EqualFold(payload.Status, "ok")
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
