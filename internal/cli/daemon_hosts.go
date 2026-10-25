package cli

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/home"
)

// DefaultTCPListen is the address a daemon listens on when nothing else is configured.
const DefaultTCPListen = "127.0.0.1:6777"

// daemonHostCandidates lists the addresses to try, in order.
//
// Ported from resolveDefaultDaemonHosts. A daemon may be listening on a unix socket (a restricted
// environment) or on TCP, and the CLI cannot know which without asking. Trying one address meant a
// command failed against a daemon that was plainly running, with no hint about why.
//
// The order is: an explicit --addr or BYSPACE_HOST, then whatever the running daemon recorded, then
// the default TCP address. Deduplicated because the recorded address is often the default one.
func daemonHostCandidates(explicit string) []string {
	trimmedExplicit := strings.TrimSpace(explicit)
	candidates := make([]string, 0, 3)

	// An explicit address is the only candidate: the user said where to look, and silently falling through to
	// another daemon would talk the wrong one — which is exactly what happened while this compared the value
	// against the default instead of asking whether it was set: passing `--addr 127.0.0.1:6778` in this repo
	// matched the dev default, was treated as absent, and the CLI went on to the production daemon on 6777.
	if trimmedExplicit != "" {
		return []string{trimmedExplicit}
	}
	if host := strings.TrimSpace(os.Getenv("BYSPACE_HOST")); host != "" {
		return []string{host}
	}

	// What the running daemon recorded about itself.
	if homeDir, err := home.Resolve(""); err == nil {
		if lock, ok := daemon.ReadPIDLock(homeDir); ok && lock.Listen != nil && strings.TrimSpace(*lock.Listen) != "" {
			candidates = append(candidates, strings.TrimSpace(*lock.Listen))
		}
	}
	candidates = append(candidates, DefaultTCPListen)

	// Deduplicate, keeping the first occurrence.
	seen := make(map[string]bool, len(candidates))
	out := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if seen[candidate] {
			continue
		}
		seen[candidate] = true
		out = append(out, candidate)
	}
	return out
}

// serverInfoByConn caches the server_info each connection received during its hello.
//
// The dial has to read that message to know the connection is alive, and throwing it away meant
// `agent open` had no way to answer without inventing a request the protocol does not have.
var serverInfoByConn sync.Map

// rememberServerInfo records the hello answer for a connection.
func rememberServerInfo(ws *websocket.Conn, info map[string]any) {
	serverInfoByConn.Store(ws, info)
}

// serverInfoFor reads the cached hello answer.
func serverInfoFor(ws *websocket.Conn) map[string]any {
	if cached, ok := serverInfoByConn.Load(ws); ok {
		if info, ok := cached.(map[string]any); ok {
			return info
		}
	}
	return nil
}

// dialDaemonAnyHost connects to the first candidate address that answers.
//
// The error reports every address tried: "connection refused" against one address says nothing
// when three were attempted, and the user needs to know which daemon was not there.
func dialDaemonAnyHost(ctx context.Context, explicit string) (*websocket.Conn, error) {
	candidates := daemonHostCandidates(explicit)
	failures := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ws, err := dialDaemonWS(ctx, candidate)
		if err == nil {
			return ws, nil
		}
		failures = append(failures, candidate+": "+err.Error())
	}
	if len(failures) == 0 {
		return nil, errors.New("no daemon address was available")
	}
	return nil, fmt.Errorf("no daemon reachable at %s", strings.Join(failures, "; "))
}
