package server

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/ByteTrue/byspace/internal/daemon"
)

// takeDaemonNetworkPatch removes the network block from a config patch and reports the LAN toggle.
//
// `network` is a view of the listen target. The only writable field is `allowLanAccess`, which
// translates into the persisted `daemon.listen`; a `tcpPort` echoed back by a client is derived
// state and is discarded instead of merged into the file.
func takeDaemonNetworkPatch(config map[string]any) (allowLanAccess *bool, ok bool) {
	if config == nil {
		return nil, false
	}
	raw, present := config["network"]
	if !present {
		return nil, false
	}
	delete(config, "network")
	network, _ := raw.(map[string]any)
	value, hasValue := network["allowLanAccess"]
	if !hasValue {
		return nil, false
	}
	allow, isBool := value.(bool)
	if !isBool {
		return nil, false
	}
	return &allow, true
}

// daemonListenForLAN translates the toggle into the address to persist under `daemon.listen`.
//
// The port stays the one this daemon bound; only the host changes. A socket/pipe has no LAN to
// expose, and BYSPACE_LISTEN owns the address outright when it is set, so both are refused
// instead of writing a setting the next start would ignore.
func (s *Server) daemonListenForLAN(allow bool) (string, error) {
	if strings.TrimSpace(os.Getenv("BYSPACE_LISTEN")) != "" {
		return "", fmt.Errorf("BYSPACE_LISTEN owns the listen address, so change that variable to change LAN access")
	}
	target, err := daemon.ParseListenTarget(strings.TrimSpace(s.listenAddr))
	if err != nil || target.Kind != "tcp" {
		return "", fmt.Errorf("LAN access needs a TCP listener, and this daemon does not use one")
	}
	host := "127.0.0.1"
	if allow {
		host = "0.0.0.0"
	}
	return net.JoinHostPort(host, strconv.Itoa(target.Port)), nil
}

// lanOpen reports whether a listen target is reachable beyond loopback.
func lanOpen(listenAddr string) bool {
	target, err := daemon.ParseListenTarget(strings.TrimSpace(listenAddr))
	if err != nil || target.Kind != "tcp" {
		return false
	}
	return !IsLoopbackHost(target.Host)
}

// listenIntent is where the daemon will listen after a restart.
//
// A saved `daemon.listen` is the address the settings page chose and the next start will bind;
// `BYSPACE_LISTEN` owns the address outright and outranks it. The daemon cannot tell an explicit
// --addr from its default, so a flag-started daemon keeps its flag as a documented limitation.
func (s *Server) listenIntent(persisted string) string {
	if strings.TrimSpace(os.Getenv("BYSPACE_LISTEN")) != "" {
		return s.listenAddr
	}
	if persisted != "" {
		return persisted
	}
	return s.listenAddr
}
