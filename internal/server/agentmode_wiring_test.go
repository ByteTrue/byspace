package server

import (
	"errors"
	"testing"

	"github.com/ByteTrue/byspace/internal/agentmode"
	"github.com/ByteTrue/byspace/internal/store"
)

// A mode id is provider-specific. A child created from a parent in another provider must not inherit
// it: the child would run with a mode its provider does not recognise.
func TestCreateAgentRejectsCrossProviderModeInheritance(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	mode := "acceptEdits"
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_claude_parent", Provider: "claude", Cwd: "/tmp", LastStatus: "idle",
		Config: &store.AgentConfig{ModeID: &mode},
	}); err != nil {
		t.Fatal(err)
	}
	parent := "agt_claude_parent"
	input := srv.agentModeInput("codex", nil, &parent)
	if input.Parent == nil || input.Parent.Provider != "claude" || input.Parent.ModeID == nil {
		t.Fatalf("parent not read from the store: %+v", input.Parent)
	}
	_, err := agentmode.Resolve(input)
	if !errors.Is(err, agentmode.ErrModeNotInheritable) {
		t.Fatalf("err = %v", err)
	}

	// Same provider inherits, because the id means the same thing there.
	same := srv.agentModeInput("claude", nil, &parent)
	if got, resolveErr := agentmode.Resolve(same); resolveErr != nil || got == nil || *got != "acceptEdits" {
		t.Fatalf("same-provider inherit: %v %v", got, resolveErr)
	}
}

// The target provider's modes come from the same snapshot the UI uses, so a mode the picker offered
// is a mode this accepts.
func TestProviderModeIDsMatchTheSnapshot(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	ids, known := srv.providerModeIDs("claude")
	if !known || len(ids) == 0 {
		t.Fatalf("claude declares modes: %v %v", ids, known)
	}
	if !srv.providerModeIsUnattended("claude", "bypassPermissions") {
		t.Fatal("bypassPermissions runs without asking")
	}
	if srv.providerModeIsUnattended("claude", "plan") {
		t.Fatal("plan asks")
	}
	// A provider that declares none is "unknown", which passes an explicit mode through rather
	// than refusing it: refusing would block every provider whose modes we have not probed.
	if _, known := srv.providerModeIDs("no-such-provider-with-no-modes"); known {
		t.Fatal("a provider without declared modes must report unknown")
	}
}
