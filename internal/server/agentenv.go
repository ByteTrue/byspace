package server

import (
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/store"
)

// agentEnv is the environment an agent's own subprocesses inherit.
//
// An agent reaches the daemon through `byspace`, and it has no other way to learn which daemon
// that is: the CLI's default is the packaged 6777, which is the wrong one for a repo home on
// 6778. The id is how the CLI records the caller, so an agent that delegates lands under the
// agent that started it instead of at the top of the tree.
//
// The user's per-agent environment goes on top of the daemon's, and the BySpace identity below is
// applied last: an agent that could rewrite BYSPACE_AGENT_ID could act as another agent.
//
// No credential is passed here. The CLI reads the home's own `cli-credential` file, the same
// principal the user's shell uses; an agent needs no second auth scheme for this.
func (s *Server) agentEnv(rec store.AgentRecord) []string {
	env := os.Environ()
	set := func(key, value string) { env = setEnv(env, key, value) }

	if rec.Config != nil {
		for key, value := range rec.Config.Env {
			if strings.TrimSpace(key) != "" {
				set(key, value)
			}
		}
	}

	if s.homeDir != "" {
		set("BYSPACE_HOME", s.homeDir)
	}
	if addr := dialableAddr(s.listenAddr); addr != "" {
		set("BYSPACE_HOST", addr)
	}
	if rec.ID != "" {
		set("BYSPACE_AGENT_ID", rec.ID)
	}
	// `byspace` has to resolve in the agent's shell: the bundled skill tells the agent to run it,
	// and a shell that cannot find the binary leaves the agent with no orchestration tools at all.
	// The daemon's own executable is the build that matches this daemon.
	if exe, err := os.Executable(); err == nil {
		set("PATH", prependPathDir(filepath.Dir(exe), envValue(env, "PATH")))
	}
	return env
}

// setEnv replaces key in place, or appends it.
//
// Appending a second copy instead of replacing leaves the child with two values for one key, and
// which one wins is the platform's business, not ours.
func setEnv(env []string, key, value string) []string {
	out := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if name, _, ok := strings.Cut(entry, "="); ok && name == key {
			continue
		}
		out = append(out, entry)
	}
	return append(out, key+"="+value)
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return entry[len(prefix):]
		}
	}
	return ""
}

func prependPathDir(dir, path string) string {
	if dir == "" {
		return path
	}
	for _, entry := range strings.Split(path, string(os.PathListSeparator)) {
		if entry == dir {
			return path
		}
	}
	if path == "" {
		return dir
	}
	return dir + string(os.PathListSeparator) + path
}

// dialableAddr turns the daemon's listen address into one a client on this machine can dial.
//
// A wildcard listen is reachable on loopback but not at the literal address, and a unix socket
// has no host:port to name, so it is left to the CLI's own resolution.
func dialableAddr(listen string) string {
	listen = strings.TrimSpace(listen)
	if listen == "" || strings.HasPrefix(listen, "unix:") || strings.HasPrefix(listen, "/") {
		return ""
	}
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return ""
	}
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
