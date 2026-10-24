// Package daemon renders and manages user-level OS service definitions
// (macOS launchd plist and Linux systemd user unit) for `byspace serve`.
package daemon

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
)

const (
	ServiceName  = "byspace"
	LaunchdLabel = "com.bytetrue.byspace.serve"
	SystemdUnit  = "byspace.service"
)

var carriedEnvVars = []string{
	"PATH",
	"BYSPACE_HOME",
	"BYSPACE_LISTEN",
	"BYSPACE_RELAY_URL",
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
	"http_proxy", "https_proxy", "all_proxy", "no_proxy",
}

// CarriedEnviron collects the current process environment variables that should be
// preserved inside a launchd or systemd service definition.
func CarriedEnviron() []string {
	var out []string
	for _, k := range carriedEnvVars {
		if v, ok := os.LookupEnv(k); ok && strings.TrimSpace(v) != "" {
			out = append(out, k+"="+v)
		}
	}
	return out
}

// LaunchdPlistPath returns ~/Library/LaunchAgents/com.bytetrue.byspace.serve.plist.
func LaunchdPlistPath(userHome string) string {
	return filepath.Join(userHome, "Library", "LaunchAgents", LaunchdLabel+".plist")
}

// SystemdUnitPath returns ~/.config/systemd/user/byspace.service.
func SystemdUnitPath(userHome string) string {
	xdg := os.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		xdg = filepath.Join(userHome, ".config")
	}
	return filepath.Join(xdg, "systemd", "user", SystemdUnit)
}

// RenderLaunchdPlist generates the macOS LaunchAgent XML plist for running `byspace serve`.
func RenderLaunchdPlist(exe string, args, env []string, logFile string) string {
	s := func(v string) string { return "<string>" + html.EscapeString(v) + "</string>" }
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by byspace daemon install -->
<plist version="1.0">
<dict>
	<key>Label</key>` + s(LaunchdLabel) + `
	<key>ProgramArguments</key>
	<array>` + s(exe))
	for _, a := range args {
		b.WriteString(s(a))
	}
	b.WriteString(`</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key>
	<dict><key>SuccessfulExit</key><false/></dict>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>ProcessType</key><string>Background</string>
`)
	if logFile != "" {
		b.WriteString("\t<key>StandardOutPath</key>" + s(logFile) + "\n")
		b.WriteString("\t<key>StandardErrorPath</key>" + s(logFile) + "\n")
	}
	if len(env) > 0 {
		b.WriteString("\t<key>EnvironmentVariables</key>\n\t<dict>\n")
		for _, kv := range env {
			k, v, _ := strings.Cut(kv, "=")
			b.WriteString("\t\t<key>" + html.EscapeString(k) + "</key>" + s(v) + "\n")
		}
		b.WriteString("\t</dict>\n")
	}
	b.WriteString("</dict>\n</plist>\n")
	return b.String()
}

// RenderSystemdUnit generates the Linux systemd user unit text for running `byspace serve`.
func RenderSystemdUnit(exe string, args, env []string) string {
	var b strings.Builder
	b.WriteString("# Written by byspace daemon install\n")
	b.WriteString("[Unit]\nDescription=BySpace AI coding agent daemon\nWants=network-online.target\nAfter=network-online.target\n\n")
	b.WriteString("[Service]\nType=simple\n")
	b.WriteString("ExecStart=" + unitQuote(exe))
	for _, a := range args {
		if a == "serve" {
			b.WriteString(" serve")
		} else {
			b.WriteString(" " + unitQuote(a))
		}
	}
	b.WriteString("\nRestart=on-failure\nRestartSec=5\n")
	for _, kv := range env {
		b.WriteString("Environment=" + unitQuote(kv) + "\n")
	}
	b.WriteString("\n[Install]\nWantedBy=default.target\n")
	return b.String()
}

func unitQuote(s string) string {
	s = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "\n", " ").Replace(s)
	return `"` + s + `"`
}

// PIDPath returns $BYSPACE_HOME/byspace.pid.
func PIDPath(homeDir string) string {
	return filepath.Join(homeDir, home.PIDFilename)
}

// LogPath returns $BYSPACE_HOME/daemon.log.
func LogPath(homeDir string) string {
	return filepath.Join(homeDir, "daemon.log")
}

// PIDLockInfo is the lock file's payload, matching pidLockInfoSchema in pid-lock.ts.
//
// The metadata is what makes a stale lock recoverable: a bare pid cannot distinguish "the
// daemon is running" from "the daemon crashed and this pid was recycled by an unrelated
// process". startedAt plus hostname plus a heartbeat mtime are enough to decide.
type PIDLockInfo struct {
	PID       int     `json:"pid"`
	StartedAt string  `json:"startedAt"`
	Hostname  string  `json:"hostname"`
	UID       int     `json:"uid"`
	Listen    *string `json:"listen"`
	// ExeName is the base name of the binary that was launched. Recorded so `daemon stop` can
	// verify the pid belongs to this daemon even when the binary was renamed or symlinked — the
	// alternative is a literal "byspace" check that silently declines to stop it.
	ExeName   string `json:"exeName,omitempty"`
	Heartbeat bool   `json:"heartbeat,omitempty"`
}

// PidLockStaleAfter is how long a lock may go without a heartbeat before it is reclaimed.
// Node uses five minutes: well above an ordinary event-loop stall, so a busy daemon is not
// mistaken for a dead one.
const PidLockStaleAfter = 5 * time.Minute

// WritePID atomically records the daemon process ID in $BYSPACE_HOME/byspace.pid.
//
// The older format was a bare integer; readers still accept it, so an existing home keeps
// working after an upgrade.
func WritePID(homeDir string, pid int) error {
	return WritePIDLock(homeDir, PIDLockInfo{PID: pid})
}

// WritePIDLock records a lock with metadata and starts its heartbeat.
func WritePIDLock(homeDir string, info PIDLockInfo) error {
	if info.StartedAt == "" {
		info.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if info.Hostname == "" {
		info.Hostname, _ = os.Hostname()
	}
	if info.UID == 0 {
		info.UID = os.Getuid()
	}
	info.Heartbeat = true
	b, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return home.WriteAtomic(PIDPath(homeDir), append(b, '\n'), 0o600)
}

// ReadPIDLock parses the lock file, accepting both the JSON form and the legacy bare pid.
func ReadPIDLock(homeDir string) (PIDLockInfo, bool) {
	b, err := os.ReadFile(PIDPath(homeDir))
	if err != nil {
		return PIDLockInfo{}, false
	}
	trimmed := strings.TrimSpace(string(b))
	if strings.HasPrefix(trimmed, "{") {
		var info PIDLockInfo
		if json.Unmarshal([]byte(trimmed), &info) == nil && info.PID > 0 {
			return info, true
		}
		return PIDLockInfo{}, false
	}
	pid, convErr := strconv.Atoi(trimmed)
	if convErr != nil || pid <= 0 {
		return PIDLockInfo{}, false
	}
	return PIDLockInfo{PID: pid}, true
}

// IsStale reports whether a lock may be reclaimed.
//
// A lock is stale when its pid is not alive. If the pid *is* alive but the file has not been
// touched within PidLockStaleAfter, the pid most likely belongs to a recycled process, so the
// lock is stale too — unless the daemon is on a different host, where liveness cannot be
// checked and only the heartbeat signals.
func IsStale(homeDir string, info PIDLockInfo) bool {
	alive := processAlive(info.PID)
	if !alive {
		return true
	}
	if st, err := os.Stat(PIDPath(homeDir)); err == nil {
		if time.Since(st.ModTime()) > PidLockStaleAfter {
			return true
		}
	}
	return false
}

// TouchPIDLock refreshes the lock's heartbeat mtime so a running daemon is never reclaimed.
func TouchPIDLock(homeDir string) {
	now := time.Now()
	_ = os.Chtimes(PIDPath(homeDir), now, now)
}

// RemovePID deletes $BYSPACE_HOME/byspace.pid if it matches the given pid (or if pid <= 0).
func RemovePID(homeDir string, expectedPID int) {
	p := PIDPath(homeDir)
	if expectedPID > 0 {
		if cur, alive := ReadPID(homeDir); alive && cur != expectedPID {
			return
		}
	}
	_ = os.Remove(p)
}

// ReadPID reads the lock and checks whether the recorded process is alive.
func ReadPID(homeDir string) (int, bool) {
	info, ok := ReadPIDLock(homeDir)
	if !ok {
		return 0, false
	}
	if !processAlive(info.PID) {
		return info.PID, false
	}
	return info.PID, true
}

// StopRunning sends SIGTERM to the PID recorded in $BYSPACE_HOME/byspace.pid and waits up to 5s.
func StopRunning(homeDir string) (int, bool, error) {
	return StopRunningWithTimeout(homeDir, 5*time.Second)
}

// StopRunningWithTimeout stops the daemon, waiting up to `grace` for SIGTERM to take effect.
//
// The grace period is a parameter because a daemon finishing a large write needs longer than a
// paused one, and a fixed wait reports "still running" for a process that is already dying.
func StopRunningWithTimeout(homeDir string, grace time.Duration) (int, bool, error) {
	pid, alive := ReadPID(homeDir)
	if !alive {
		RemovePID(homeDir, 0)
		return 0, false, nil
	}
	// Prefer the identity the lock recorded. A literal "byspace serve" check fails for a renamed
	// binary, and a failing check does not report an error: it reclaims the lock and leaves the
	// process running, so `daemon stop` says "not running" while the daemon still serves.
	identity := daemonProcessIdentity
	if lock, ok := ReadPIDLock(homeDir); ok && strings.TrimSpace(lock.ExeName) != "" {
		identity = lock.ExeName + " serve"
	}
	if !ProcessMatches(pid, identity) {
		// Alive but not ours: the pid was recycled after a crash. Reclaim the lock instead of
		// signalling whatever now owns that number.
		RemovePID(homeDir, 0)
		return pid, false, nil
	}
	if err := terminateProcess(pid); err != nil {
		return pid, false, err
	}
	if grace <= 0 {
		grace = 5 * time.Second
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			RemovePID(homeDir, pid)
			return pid, true, nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = killProcess(pid)
	RemovePID(homeDir, pid)
	return pid, true, nil
}

// StartBackground spawns `byspace serve` detached in the background, logging to $BYSPACE_HOME/daemon.log.
// StartOptions are the flags a background start forwards to the serve process.
//
// Passed through rather than kept as CLI-only flags: `daemon start --no-web-ui` that does not turn
// the web UI off on the process it launches is worse than not having the flag, because the user
// believes it worked.
type StartOptions struct {
	ExePath  string
	HomeDir  string
	Addr     string
	RelayURL string
	// RelayUseTLS switches pairing offers to wss://.
	RelayUseTLS bool
	// InjectMCP controls whether created agents get the BySpace MCP injected.
	InjectMCP bool
	// WebUI controls the bundled web UI. Tri-state: nil means "leave to the daemon's config".
	WebUI *bool
}

// StartBackgroundWithOptions launches the daemon with the given options.
func StartBackgroundWithOptions(options StartOptions) (int, error) {
	args := []string{"serve", "--addr", options.Addr, "--home", options.HomeDir}
	if strings.TrimSpace(options.RelayURL) != "" {
		args = append(args, "--relay", strings.TrimSpace(options.RelayURL))
	}
	if options.RelayUseTLS {
		args = append(args, "--relay-use-tls")
	}
	if !options.InjectMCP {
		args = append(args, "--no-inject-mcp")
	}
	if options.WebUI != nil {
		if *options.WebUI {
			args = append(args, "--web-ui")
		} else {
			args = append(args, "--no-web-ui")
		}
	}
	return spawnBackground(options.ExePath, options.HomeDir, args)
}

func StartBackground(exePath, homeDir, addr, relayURL string) (int, error) {
	return StartBackgroundWithOptions(StartOptions{
		ExePath:   exePath,
		HomeDir:   homeDir,
		Addr:      addr,
		RelayURL:  relayURL,
		InjectMCP: true,
	})
}

// spawnBackground starts the process with the given serve arguments.
func spawnBackground(exePath, homeDir string, args []string) (int, error) {
	if pid, alive := ReadPID(homeDir); alive {
		return pid, nil
	}
	if exePath == "" {
		var err error
		exePath, err = os.Executable()
		if err != nil {
			return 0, err
		}
	}
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		return 0, err
	}
	logFile, err := os.OpenFile(LogPath(homeDir), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return 0, err
	}
	defer logFile.Close()

	cmd := exec.Command(exePath, args...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("spawn background daemon: %w", err)
	}
	pid := cmd.Process.Pid
	_ = WritePID(homeDir, pid)
	_ = cmd.Process.Release()
	return pid, nil
}

// WaitForShutdown blocks until the daemon's pid file is gone or the address stops accepting
// connections, whichever happens first.
//
// `restart` stops then starts; without this the replacement can lose the bind race against the
// process that is still unwinding, leaving a "started" message and a dead port.
func WaitForShutdown(homeDir, addr string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if pid, alive := ReadPID(homeDir); !alive || pid <= 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// ProcessAlive reports whether a pid is a live process we own.
//
// Used while waiting for a daemon to come up: a child that exited during startup will never
// answer the health check, so reporting "started" on a timeout would be a lie.
func ProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return processAlive(pid)
}
