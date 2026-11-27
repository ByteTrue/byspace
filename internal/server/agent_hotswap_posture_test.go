package server

import (
	"context"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestAgentHotSwapSameDerivedProviderReappliesVerifierPosture(t *testing.T) {
	tests := []struct {
		name         string
		providerID   string
		extends      string
		wantMode     string
		wantRestarts int
	}{
		{name: "OpenCode", providerID: "opencode-derived-verifier", extends: "opencode", wantMode: "plan", wantRestarts: 0},
		{name: "Codex", providerID: "codex-derived-verifier", extends: "codex", wantMode: "build", wantRestarts: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newHotSwapFixture(t, chief.RoleVerifier, tc.providerID, chief.TierStrong)
			configureDerivedVerifierHotSwap(t, f, tc.providerID, tc.extends)
			var restarts int
			f.service.applyOrRestart = func(ctx context.Context, mp *managedPi, applyErr error) error {
				restarts++
				return f.applyMockRestart(ctx, mp, applyErr)
			}

			result, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
			if err != nil {
				t.Fatalf("HotSwap() error = %v", err)
			}
			if result.PreviousAgentID != f.old.ID || result.ReplacementAgentID != f.old.ID {
				t.Fatalf("same-provider identity changed: %+v", result)
			}
			if restarts != tc.wantRestarts {
				t.Errorf("applyOrRestart calls = %d, want %d", restarts, tc.wantRestarts)
			}

			f.srv.mu.Lock()
			live := f.srv.agents[f.old.ID]
			f.srv.mu.Unlock()
			if live == nil {
				t.Fatal("live agent is missing")
			}
			persisted, err := f.srv.store.GetAgent(f.old.ID)
			if err != nil {
				t.Fatal(err)
			}
			if persisted == nil {
				t.Fatal("persisted agent is missing")
			}
			assertDerivedVerifierPosture(t, "live", live.record, tc.providerID, tc.extends, tc.wantMode)
			assertDerivedVerifierPosture(t, "persisted", *persisted, tc.providerID, tc.extends, tc.wantMode)

			session, ok := live.session.(*hotSwapObservableSession)
			if !ok {
				t.Fatalf("live session type = %T, want observable mock", live.session)
			}
			if session.modeID != tc.wantMode {
				t.Errorf("live session mode = %q, want %q", session.modeID, tc.wantMode)
			}
			if tc.extends == "codex" && session.featureValues["plan_mode"] != true {
				t.Errorf("live session featureValues = %#v, want plan_mode=true", session.featureValues)
			}
		})
	}
}

func configureDerivedVerifierHotSwap(t *testing.T, f *hotSwapFixture, providerID, extends string) {
	t.Helper()
	previous := providers.TestProviders
	providers.TestProviders = append(append([]providers.ProviderSpec(nil), previous...), providers.ProviderSpec{
		ID: providerID, Label: providerID, Protocol: "acp",
		Modes: []providers.ModeDefinition{{ID: "build"}, {ID: "plan"}},
	})
	t.Cleanup(func() { providers.TestProviders = previous })

	cfg := f.srv.store.LoadDaemonConfig()
	providerConfigs, _ := cfg["providers"].(map[string]any)
	if providerConfigs == nil {
		providerConfigs = map[string]any{}
	}
	providerConfigs[providerID] = map[string]any{"extends": extends}
	profiles, _ := cfg["agentProfiles"].([]any)
	for _, raw := range profiles {
		profile, _ := raw.(map[string]any)
		switch profile["id"] {
		case "old-verifier":
			profile["provider"] = providerID
		case f.targetProfileID():
			profile["provider"] = providerID
			profile["modeId"] = "build"
			delete(profile, "featureValues")
		}
	}
	f.srv.store.SaveDaemonConfig(map[string]any{"providers": providerConfigs, "agentProfiles": profiles})

	mode := "build"
	f.old.Provider = providerID
	f.old.Labels[chief.LabelRole] = chief.RoleVerifier
	f.old.LastModeID = &mode
	f.old.Config.ModeID = &mode
	f.old.Config.FeatureValues = nil
	f.old.Config.ProviderOptions = nil
	f.old.RuntimeInfo.Provider = providerID
	f.old.Persistence.Provider = providerID
	observed := &hotSwapObservableSession{MockSession: f.oldSession, modeID: mode}
	f.srv.mu.Lock()
	f.srv.agents[f.old.ID].record = f.old
	f.srv.agents[f.old.ID].session = observed
	f.srv.mu.Unlock()
	if err := f.srv.store.UpsertAgent(f.old); err != nil {
		t.Fatal(err)
	}
}

func assertDerivedVerifierPosture(t *testing.T, where string, rec store.AgentRecord, providerID, extends, wantMode string) {
	t.Helper()
	if rec.Provider != providerID {
		t.Errorf("%s provider = %q, want derived ID %q", where, rec.Provider, providerID)
	}
	if rec.Config == nil {
		t.Fatalf("%s config is nil", where)
	}
	if derefStr(rec.Config.ModeID) != wantMode || derefStr(rec.LastModeID) != wantMode {
		t.Errorf("%s modes = config %q last %q, want %q", where, derefStr(rec.Config.ModeID), derefStr(rec.LastModeID), wantMode)
	}
	if extends == "codex" {
		if rec.Config.ProviderOptions["sandbox_mode"] != "read-only" || rec.Config.ProviderOptions["approval_policy"] != "never" {
			t.Errorf("%s providerOptions = %#v, want read-only/never", where, rec.Config.ProviderOptions)
		}
		if rec.Config.FeatureValues["plan_mode"] != true {
			t.Errorf("%s featureValues = %#v, want plan_mode=true", where, rec.Config.FeatureValues)
		}
	}
}
