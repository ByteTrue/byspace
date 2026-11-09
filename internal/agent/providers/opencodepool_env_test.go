package providers

import "testing"

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
	env := openCodePoolEnv([]string{
		"PATH=/bin",
		"BYSPACE_HOME=/home",
		"BYSPACE_AGENT_ID=agt_1",
		"BYSPACE_SUBAGENT_REPORT_TOKEN=secret",
		"ANTHROPIC_BASE_URL=https://proxy.example",
	})
	if _, ok := env["BYSPACE_AGENT_ID"]; ok {
		t.Fatal("the agent identity must not reach a shared server")
	}
	if _, ok := env["BYSPACE_SUBAGENT_REPORT_TOKEN"]; ok {
		t.Fatal("agent-scoped secrets must not reach a shared server")
	}
	if env["BYSPACE_HOME"] != "/home" || env["ANTHROPIC_BASE_URL"] != "https://proxy.example" {
		t.Fatalf("env = %v", env)
	}
}

func resetSharedOpenCodePools() {
	sharedPoolsMu.Lock()
	sharedPools = map[string]*OpenCodePool{}
	sharedPoolsMu.Unlock()
}
