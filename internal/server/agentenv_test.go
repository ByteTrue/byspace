package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// The agent finds the daemon through these variables; the CLI's defaults name the packaged
// daemon, so a repo home on 6778 would otherwise be a different daemon than the one that
// launched the agent.
func TestAgentEnvNamesThisDaemonAndCaller(t *testing.T) {
	s := &Server{homeDir: "/tmp/home", listenAddr: "0.0.0.0:6778"}
	env := s.agentEnv(store.AgentRecord{ID: "agt_1"})

	if got := envValue(env, "BYSPACE_HOME"); got != "/tmp/home" {
		t.Errorf("BYSPACE_HOME = %q", got)
	}
	if got := envValue(env, "BYSPACE_AGENT_ID"); got != "agt_1" {
		t.Errorf("BYSPACE_AGENT_ID = %q", got)
	}
	if got := envValue(env, "BYSPACE_HOST"); got != "127.0.0.1:6778" {
		t.Errorf("BYSPACE_HOST = %q, want the loopback form of the wildcard listen", got)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if dir := filepath.Dir(exe); !strings.Contains(envValue(env, "PATH"), dir) {
		t.Errorf("PATH %q does not lead with %q", envValue(env, "PATH"), dir)
	}
	// The credential is the home's own file, read by the CLI. Putting a second secret in the
	// environment is how two auth paths drift apart.
	if got := envValue(env, "BYSPACE_AGENT_CREDENTIAL"); got != "" {
		t.Errorf("agent env carries a credential: %q", got)
	}
}

func TestAgentEnvOverridesExistingValues(t *testing.T) {
	env := setEnv([]string{"BYSPACE_HOME=/old", "PATH=/bin"}, "BYSPACE_HOME", "/new")
	var homes []string
	for _, entry := range env {
		if strings.HasPrefix(entry, "BYSPACE_HOME=") {
			homes = append(homes, entry)
		}
	}
	if len(homes) != 1 || homes[0] != "BYSPACE_HOME=/new" {
		t.Fatalf("BYSPACE_HOME entries = %v, want exactly the override", homes)
	}
	if got := envValue(env, "PATH"); got != "/bin" {
		t.Errorf("PATH = %q, want the untouched entry", got)
	}
}

func TestDialableAddr(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1:6777":   "127.0.0.1:6777",
		"0.0.0.0:6778":     "127.0.0.1:6778",
		"[::]:6779":        "127.0.0.1:6779",
		":6780":            "127.0.0.1:6780",
		"":                 "",
		"unix:/tmp/x.sock": "",
		"/tmp/x.sock":      "",
	}
	for listen, want := range cases {
		if got := dialableAddr(listen); got != want {
			t.Errorf("dialableAddr(%q) = %q, want %q", listen, got, want)
		}
	}
}

func TestPrependPathDirLeavesAnExistingEntryAlone(t *testing.T) {
	sep := string(os.PathListSeparator)
	path := "/a" + sep + "/b"
	if got := prependPathDir("/a", path); got != path {
		t.Errorf("prependPathDir = %q, want %q", got, path)
	}
	if got := prependPathDir("/c", path); got != "/c"+sep+path {
		t.Errorf("prependPathDir = %q", got)
	}
}

// A per-agent environment reaches the provider process, and it cannot rewrite the identity BySpace
// puts there: an agent that could change BYSPACE_AGENT_ID could act as another agent.
func TestAgentEnvAppliesUserVariablesWithoutLosingIdentity(t *testing.T) {
	s := &Server{homeDir: "/tmp/home", listenAddr: "127.0.0.1:6778"}
	rec := store.AgentRecord{ID: "agt_1"}
	rec.Config = &store.AgentConfig{Env: map[string]string{
		"ANTHROPIC_BASE_URL": "https://proxy.example",
		"BYSPACE_AGENT_ID":   "agt_someone_else",
	}}
	env := s.agentEnv(rec)

	if got := envValue(env, "ANTHROPIC_BASE_URL"); got != "https://proxy.example" {
		t.Errorf("ANTHROPIC_BASE_URL = %q, want the per-agent value", got)
	}
	if got := envValue(env, "BYSPACE_AGENT_ID"); got != "agt_1" {
		t.Errorf("BYSPACE_AGENT_ID = %q, want the real id to win", got)
	}
}
