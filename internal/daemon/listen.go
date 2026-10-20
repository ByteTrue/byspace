package daemon

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// ListenTarget is where the daemon accepts connections.
//
// Ported from archive/.../server/bootstrap.ts parseListenString. Unix sockets and Windows
// named pipes matter in restricted environments: a sandbox or a container without TCP
// loopback still allows a filesystem socket, and a long-lived local socket path avoids
// port collisions between several daemons on one machine.
type ListenTarget struct {
	Kind string // "tcp" | "socket" | "pipe"
	Host string
	Port int
	Path string
}

var windowsDriveRe = regexp.MustCompile(`^[A-Za-z]:[\\/]`)

// ParseListenTarget interprets BYSPACE_LISTEN / --addr.
//
//	pipe://NAME           or \\.\pipe\NAME  → named pipe
//	unix:///path/to.sock                    → unix socket
//	/abs/path or ~/path                     → unix socket
//	6778                                    → 127.0.0.1:6778
//	host:port  or  [::1]:port               → tcp
func ParseListenTarget(listen string) (ListenTarget, error) {
	raw := strings.TrimSpace(listen)
	if raw == "" {
		return ListenTarget{}, fmt.Errorf("empty listen target")
	}

	if strings.HasPrefix(raw, `\\.\pipe\`) {
		return ListenTarget{Kind: "pipe", Path: raw}, nil
	}
	if rest, ok := strings.CutPrefix(raw, "pipe://"); ok {
		return ListenTarget{Kind: "pipe", Path: rest}, nil
	}
	if rest, ok := strings.CutPrefix(raw, "unix://"); ok {
		return ListenTarget{Kind: "socket", Path: rest}, nil
	}
	if windowsDriveRe.MatchString(raw) {
		return ListenTarget{}, fmt.Errorf("invalid listen target (a Windows path is not a socket): %s", listen)
	}
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "~") {
		return ListenTarget{Kind: "socket", Path: expandHome(raw)}, nil
	}
	if port, err := strconv.Atoi(raw); err == nil {
		if port <= 0 || port > 65535 {
			return ListenTarget{}, fmt.Errorf("invalid port in listen target: %s", listen)
		}
		return ListenTarget{Kind: "tcp", Host: "127.0.0.1", Port: port}, nil
	}
	if idx := strings.LastIndex(raw, ":"); idx >= 0 {
		host := raw[:idx]
		port, err := strconv.Atoi(raw[idx+1:])
		if err != nil || port <= 0 || port > 65535 {
			return ListenTarget{}, fmt.Errorf("invalid port in listen target: %s", listen)
		}
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
		if host == "" {
			host = "127.0.0.1"
		}
		return ListenTarget{Kind: "tcp", Host: host, Port: port}, nil
	}
	return ListenTarget{}, fmt.Errorf("invalid listen target: %s", listen)
}

// Listen opens the listener, creating the parent directory for a socket path and removing a
// stale socket file left behind by a crashed daemon.
func (t ListenTarget) Listen() (net.Listener, error) {
	switch t.Kind {
	case "tcp":
		// `localhost` resolves to ::1 first on many systems while the browser then opens the
		// socket over IPv4, or vice versa; Go's "tcp" with a literal binds one family only.
		// Binding both loopback families keeps `http://localhost:<port>` working regardless.
		if t.Host == "127.0.0.1" || t.Host == "::1" || t.Host == "localhost" {
			return listenLoopbackDual(t.Port)
		}
		return net.Listen("tcp", net.JoinHostPort(t.Host, strconv.Itoa(t.Port)))
	case "socket":
		// Unix socket paths are length-capped by the OS (104 bytes on macOS, 108 on Linux)
		// and exceeding it surfaces as a bare "bind: invalid argument", which is impossible
		// to act on. Fail with the actual limit and the offending path instead.
		if limit := unixSocketPathLimit(); len(t.Path) >= limit {
			return nil, fmt.Errorf(
				"socket path is %d bytes, the platform limit is %d: %s (use a shorter BYSPACE_LISTEN path)",
				len(t.Path), limit, t.Path,
			)
		}
		if err := os.MkdirAll(filepath.Dir(t.Path), 0o700); err != nil {
			return nil, err
		}
		// A socket file from a previous run blocks Listen with "address already in use".
		if _, err := os.Stat(t.Path); err == nil {
			_ = os.Remove(t.Path)
		}
		return net.Listen("unix", t.Path)
	case "pipe":
		// Windows named pipes are served by files on \\?\pipe\; net.Listen("unix") maps onto
		// that namespace on Windows, so the same call works on every platform.
		return net.Listen("unix", t.Path)
	default:
		return nil, fmt.Errorf("unknown listen target kind %q", t.Kind)
	}
}

// Address is the human-readable form reported in server_info and written to the pid file.
func (t ListenTarget) Address() string {
	if t.Kind == "tcp" {
		return net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
	}
	return t.Path
}

func expandHome(path string) string {
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home
	}
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, rest)
	}
	return path
}

// unixSocketPathLimit reports the maximum sun_path length for this platform.
func unixSocketPathLimit() int {
	if runtime.GOOS == "linux" {
		return 108
	}
	return 104
}

// listenLoopbackDual binds both loopback families when the OS supports it.
//
// A browser resolving "localhost" may pick IPv6 while the daemon is bound to IPv4 only, and the
// failure looks like "the host is unreachable" rather than a connect error. Binding both removes
// the guess. If the second family is unavailable (IPv6 disabled), the first still serves.
func listenLoopbackDual(port int) (net.Listener, error) {
	if ln, err := listenBothFamilies(port); err == nil {
		return ln, nil
	}
	return net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}
