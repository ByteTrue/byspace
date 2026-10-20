// Package daemon renders and manages user-level OS service definitions
// (macOS launchd plist and Linux systemd user unit) for `byspace serve`.
package daemon

import (
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
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

// WritePID atomically records the daemon process ID in $BYSPACE_HOME/byspace.pid.
func WritePID(homeDir string, pid int) error {
	return home.WriteAtomic(PIDPath(homeDir), []byte(strconv.Itoa(pid)+"\n"), 0o600)
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

// ReadPID reads $BYSPACE_HOME/byspace.pid and checks whether the process is alive.
func ReadPID(homeDir string) (int, bool) {
	b, err := os.ReadFile(PIDPath(homeDir))
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	if err := syscall.Kill(pid, 0); err != nil {
		return pid, false
	}
	return pid, true
}

// StopRunning sends SIGTERM to the PID recorded in $BYSPACE_HOME/byspace.pid and waits up to 5s.
func StopRunning(homeDir string) (int, bool, error) {
	pid, alive := ReadPID(homeDir)
	if !alive {
		RemovePID(homeDir, 0)
		return 0, false, nil
	}
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		return pid, false, err
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err != nil {
			RemovePID(homeDir, pid)
			return pid, true, nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
	RemovePID(homeDir, pid)
	return pid, true, nil
}

// StartBackground spawns `byspace serve` detached in the background, logging to $BYSPACE_HOME/daemon.log.
func StartBackground(exePath, homeDir, addr, relayURL string) (int, error) {
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

	args := []string{"serve", "--addr", addr, "--home", homeDir}
	if strings.TrimSpace(relayURL) != "" {
		args = append(args, "--relay", strings.TrimSpace(relayURL))
	}
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
