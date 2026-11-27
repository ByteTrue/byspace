package providers

import (
	"reflect"
	"testing"
)

// Two agents whose environment differs cannot share a server: the process environment is fixed at
// spawn. Agents with the same environment still share one, which is the common case.
func TestOpenCodePoolPerEnvironment(t *testing.T) {
	resetSharedOpenCodePools()
	defer ShutdownOpenCodePool()

	first := sharedOpenCodePool("/home", "opencode", nil, map[string]string{"FOO": "1"})
	same := sharedOpenCodePool("/home", "opencode", nil, map[string]string{"FOO": "1"})
	other := sharedOpenCodePool("/home", "opencode", nil, map[string]string{"FOO": "2"})

	if first != same {
		t.Fatal("the same environment must reuse one pooled server")
	}
	if first == other {
		t.Fatal("a different environment needs its own server")
	}
}

// The agent identity cannot vary per session in a shared server, so it is dropped rather than
// giving every agent a server of its own. The host variables stay so `byspace` works there.
func TestOpenCodePoolEnvDropsIdentity(t *testing.T) {
	resetSharedOpenCodePools()
	defer ShutdownOpenCodePool()

	env := openCodePoolEnv([]string{
		"PATH=/bin",
		"BYSPACE_HOME=/home",
		"BYSPACE_AGENT_ID=agt_1",
		"BYSPACE_AGENT_CREDENTIAL=agent-secret",
		"BYSPACE_SUBAGENT_REPORT_TOKEN=secret",
		"ANTHROPIC_BASE_URL=https://proxy.example",
	})
	pool := sharedOpenCodePool("/home", "opencode", nil, env)
	pool.mu.Lock()
	pooledEnv := make(map[string]string, len(pool.env))
	for key, value := range pool.env {
		pooledEnv[key] = value
	}
	pool.mu.Unlock()

	if _, ok := pooledEnv["BYSPACE_AGENT_ID"]; ok {
		t.Fatal("the agent identity must not reach a shared server")
	}
	if _, ok := pooledEnv["BYSPACE_AGENT_CREDENTIAL"]; ok {
		t.Fatal("the agent credential must not reach a shared server")
	}
	if _, ok := pooledEnv["BYSPACE_SUBAGENT_REPORT_TOKEN"]; ok {
		t.Fatal("agent-scoped secrets must not reach a shared server")
	}
	if pooledEnv["BYSPACE_HOME"] != "/home" || pooledEnv["ANTHROPIC_BASE_URL"] != "https://proxy.example" {
		t.Fatalf("env = %v", pooledEnv)
	}
}

func TestOpenCodePoolSharesAgentsWithDifferentCredentials(t *testing.T) {
	resetSharedOpenCodePools()
	defer ShutdownOpenCodePool()

	firstEnv := openCodePoolEnv([]string{
		"BYSPACE_HOME=/home",
		"BYSPACE_AGENT_ID=agt_1",
		"BYSPACE_AGENT_CREDENTIAL=first-secret",
	})
	secondEnv := openCodePoolEnv([]string{
		"BYSPACE_HOME=/home",
		"BYSPACE_AGENT_ID=agt_2",
		"BYSPACE_AGENT_CREDENTIAL=second-secret",
	})
	firstKey := openCodePoolKey("/home", "opencode", nil, firstEnv)
	secondKey := openCodePoolKey("/home", "opencode", nil, secondEnv)
	if firstKey != secondKey {
		t.Fatal("per-agent credentials must not split the pool key")
	}

	first := sharedOpenCodePool("/home", "opencode", nil, firstEnv)
	second := sharedOpenCodePool("/home", "opencode", nil, secondEnv)
	if first != second {
		t.Fatal("agents differing only in identity and credential must share a server")
	}
	first.mu.Lock()
	got := make(map[string]string, len(first.env))
	for key, value := range first.env {
		got[key] = value
	}
	first.mu.Unlock()
	want := map[string]string{"BYSPACE_HOME": "/home"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("shared server environment = %#v, want %#v", got, want)
	}
}

func resetSharedOpenCodePools() {
	sharedPoolsMu.Lock()
	sharedPools = map[string]*OpenCodePool{}
	sharedPoolsMu.Unlock()
}
