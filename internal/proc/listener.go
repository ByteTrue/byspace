// Package proc inspects processes listening on local TCP ports so the desktop
// client can diagnose port conflicts or gracefully hand over from an older
// BySpace daemon (ported from magpie's internal/proc).
package proc

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
)

var ErrDenied = errors.New("not allowed to terminate process")

// ListeningOn returns the PIDs listening on the given local TCP port.
func ListeningOn(ctx context.Context, port int) ([]int, error) {
	return listeningOn(ctx, port)
}

// Executable returns the full path of the executable for pid.
func Executable(pid int) (string, error) {
	p, err := executable(pid)
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(p, " (deleted)"), nil
}

// Terminate asks pid to exit cleanly (SIGTERM on Unix, TerminateProcess on Windows).
func Terminate(pid int) error { return terminate(pid) }

// Kill forcefully ends pid (SIGKILL on Unix, TerminateProcess on Windows).
func Kill(pid int) error { return kill(pid) }

// IsBySpace reports whether the executable at path is a BySpace binary (including
// platform suffixes like byspace-darwin-arm64 or Windows update .old/.old-2 files).
func IsBySpace(path string) bool {
	if path == "" {
		return false
	}
	n := strings.ToLower(filepath.Base(filepath.Clean(strings.ReplaceAll(path, `\`, "/"))))
	if i := strings.LastIndex(n, ".old"); i > 0 && isOldCount(n[i+len(".old"):]) {
		n = n[:i]
	}
	n = strings.TrimSuffix(n, ".old")
	n = strings.TrimSuffix(n, ".new")
	n = strings.TrimSuffix(n, ".exe")
	return n == "byspace" || strings.HasPrefix(n, "byspace-") || strings.HasPrefix(n, "byspace_")
}

func isOldCount(s string) bool {
	s = strings.TrimPrefix(s, "-")
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// IsContainerForwarder reports whether path belongs to a container/VM port forwarder
// (OrbStack, Docker Desktop, vpnkit, Podman gvproxy, Lima/Colima, WSL relay).
func IsContainerForwarder(path string) bool {
	if path == "" {
		return false
	}
	lower := strings.ToLower(strings.ReplaceAll(path, `\`, "/"))
	base := filepath.Base(lower)
	base = strings.TrimSuffix(base, ".exe")
	if strings.Contains(lower, "orbstack") || strings.Contains(lower, "docker.app") {
		return true
	}
	switch base {
	case "com.docker.backend", "vpnkit", "docker-proxy", "gvproxy", "limactl", "hostagent", "wslrelay":
		return true
	}
	return false
}
