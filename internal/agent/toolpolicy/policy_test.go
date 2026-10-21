package toolpolicy

import "testing"

// The default has to be on, or upgrading would silently remove the tools from every existing
// agent.
func TestResolveDefaultsToEnabled(t *testing.T) {
	if got := Resolve("pi", nil); got != nil {
		t.Fatalf("no settings should mean no policy: %+v", got)
	}
	if got := Resolve("pi", map[string]any{}); got != nil {
		t.Fatalf("missing provider entry: %+v", got)
	}
	// An empty policy is enabled.
	policy := Resolve("pi", map[string]any{"pi": map[string]any{"byspaceTools": map[string]any{}}})
	if policy == nil || !IsToolEnabled(policy, "create_agent") {
		t.Fatal("an empty policy must leave tools enabled")
	}
}

// A user working with a provider they half trust needs to take specific tools away without
// disabling the whole bridge, which would also remove the harmless ones.
func TestIsToolEnabled(t *testing.T) {
	policy := Resolve("claude", map[string]any{
		"claude": map[string]any{"byspaceTools": map[string]any{
			"disabledTools": []any{"create_agent", "send_agent_message"},
		}},
	})
	if IsToolEnabled(policy, "create_agent") || IsToolEnabled(policy, "send_agent_message") {
		t.Fatal("disabled tools must be refused")
	}
	if !IsToolEnabled(policy, "list_agents") {
		t.Fatal("a tool not named stays enabled")
	}

	// Turning the whole bridge off.
	disabled := false
	off := Resolve("pi", map[string]any{"pi": map[string]any{"byspaceTools": map[string]any{"enabled": disabled}}})
	if IsToolEnabled(off, "list_agents") {
		t.Fatal("enabled=false must disable everything")
	}

	// `speak` is always allowed: it cannot read, write or spawn anything, and letting a policy
	// disable it turns "I turned off BySpace tools" into "the agent went silent".
	if !IsToolEnabled(off, SpeakToolName) {
		t.Fatal("speak must survive every policy")
	}
}

func TestFilterPreservesOrder(t *testing.T) {
	policy := &Policy{DisabledTools: []string{"b"}}
	got := Filter(policy, []string{"a", "b", "c"})
	if len(got) != 2 || got[0] != "a" || got[1] != "c" {
		t.Fatalf("got %v", got)
	}
}
