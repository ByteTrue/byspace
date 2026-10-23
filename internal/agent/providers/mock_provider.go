package providers

import (
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// The mock provider is Node's `mock-load-test-agent`: a scripted agent that streams realistic output
// without a subprocess. It ships in the daemon rather than the test harness because 76 Playwright specs
// create agents with `provider: "mock"` — it is what makes message submission, consecutive turns, rewind,
// streaming smoothness and image stability testable at all.
//
// Ported from `mock-load-test-agent.ts`. The prompt vocabulary is a contract with those specs: each
// phrase below exists because a spec sends it and asserts the resulting behaviour.

const (
	// MockProviderID is the provider id the specs pass to createAgent.
	MockProviderID = "mock"
	// MockDefaultModelID is the fallback when a request names no model.
	MockDefaultModelID = "five-minute-stream"
	// MockHandledCommand is the slash command the provider answers itself.
	MockHandledCommand = "/mock handled-command"
	// MockModeID is the default mode; the specs pass it explicitly.
	MockModeID = "load-test"
	// MockApprovalModeID is the second mode. It exists only so a profile can switch the mock
	// provider to a safe mode and watch the composer follow; the stream ignores it.
	MockApprovalModeID = "approval-test"

	mockDurationMs = 5 * 60 * 1000
	mockIntervalMs = 40

	// The window the cycle stream reports against. Node hardcodes 128_000 in every synthetic
	// usage block, so the meter's percentage matches what the specs measured against.
	mockContextWindowMaxTokens = 128_000

	// Strings the specs assert verbatim. Node's wording, not ours: assistant-fork-menu.spec.ts
	// waits on "[System Error] Requested mock provider failure".
	mockProviderFailureMessage = "Requested mock provider failure"
	mockHandledCommandReply    = "Mock command handled"
)

// MockProvider is the provider spec. It has no binary: `Native` marks a provider the daemon runs
// in-process, so availability never depends on PATH.
var MockProvider = ProviderSpec{
	ID: MockProviderID,
	// The label is a contract: specs read it back off the model picker row
	// (`Mock Load Test · One minute stream · Approval test`), and the protocol's dev-provider
	// manifest declares the same string.
	Label:         "Mock Load Test",
	Description:   "Development-only provider that emits synthetic agent traffic for performance tests",
	Binary:        "",
	Protocol:      "mock-native",
	DefaultModeID: MockModeID,
	Modes: []ModeDefinition{
		{
			ID:          MockModeID,
			Label:       "Load Test",
			Description: "Streams repeated markdown, reasoning, and tool calls for app stress testing",
			Icon:        "ShieldOff",
			ColorTier:   "dangerous",
		},
		{
			ID:          MockApprovalModeID,
			Label:       "Approval Test",
			Description: "Alternate development-only permission mode for preference tests",
			Icon:        "ShieldCheck",
			ColorTier:   "safe",
		},
	},
	Models: MockModels(),
	// Features must be non-nil: the agent snapshot sends it straight through, and the protocol requires an
	// array. A nil slice marshals to null, which fails validation and makes the client drop the whole
	// agent_update — including the status change that ends a turn.
	Features: []FeatureDefinition{},
}

// MockModel is one selectable model with the timing profile that shapes its stream.
type MockModel struct {
	ID             string
	Label          string
	Description    string
	IsDefault      bool
	IsSelectable   bool
	Aliases        []string
	DurationMs     int
	IntervalMs     int
	ThinkingOption []sdk.ThinkingOption
	DefaultThink   string
	// Burst is non-nil for the model whose arrival pattern is deliberately lumpy.
	Burst *MockBurstProfile
}

// MockBurstProfile reproduces uneven arrival: a run of tokens back to back, then an idle gap.
type MockBurstProfile struct {
	MinTokens int
	MaxTokens int
	GapMs     int
}

// mockThinkingOptions is the three-level list the streaming models expose.
func mockThinkingOptions() []sdk.ThinkingOption {
	return []sdk.ThinkingOption{
		{ID: "low", Label: "Low", IsDefault: true},
		{ID: "medium", Label: "Medium"},
		{ID: "high", Label: "High"},
	}
}

// MockModelList is the ordered model set.
//
// Order matters for one thing only: an unknown model id falls back to the first entry, which is the
// default. Everything else about the order is presentation.
func MockModelList() []MockModel {
	return []MockModel{
		{
			ID: MockDefaultModelID, Label: "Five minute stream",
			Description: "Realistic agent flow streamed as sub-word tokens for five minutes (good for scroll/coalesce debugging).",
			IsDefault:   true, IsSelectable: true,
			Aliases:        []string{"legacy-five-minute-stream"},
			DurationMs:     mockDurationMs,
			IntervalMs:     mockIntervalMs,
			ThinkingOption: mockThinkingOptions(),
			DefaultThink:   "low",
		},
		{
			ID: "thirty-minute-stream", Label: "Thirty minute stream",
			Description:  "Long-running realistic stream for extended scroll-anchor debugging.",
			IsSelectable: true,
			DurationMs:   30 * 60 * 1000,
			IntervalMs:   50,
		},
		{
			// Kept addressable but not offered: specs and older clients still name it.
			ID: "legacy-five-minute-stream", Label: "Legacy five minute stream",
			IsSelectable:   false,
			DurationMs:     mockDurationMs,
			IntervalMs:     mockIntervalMs,
			ThinkingOption: mockThinkingOptions(),
			DefaultThink:   "low",
		},
		{
			ID: "one-minute-stream", Label: "One minute stream",
			Description:  "Shorter realistic stream for quick manual checks.",
			IsSelectable: true,
			DurationMs:   60_000,
			IntervalMs:   40,
		},
		{
			ID: "bursty-stream", Label: "Bursty stream",
			Description:  "Emits tokens in uneven bursts separated by idle gaps, reproducing the lumpy arrival pattern real models produce. Use this to measure streaming smoothness.",
			IsSelectable: true,
			DurationMs:   60_000,
			IntervalMs:   0,
			Burst:        &MockBurstProfile{MinTokens: 1, MaxTokens: 40, GapMs: 90},
		},
		{
			ID: "ten-second-stream", Label: "Ten second stream",
			Description:    "Fast realistic stream for tests and smoke checks.",
			IsSelectable:   true,
			DurationMs:     10_000,
			IntervalMs:     5,
			ThinkingOption: mockThinkingOptions(),
			DefaultThink:   "low",
		},
		{
			// Used by the shared fixtures: short enough that a suite of specs stays quick.
			ID: "e2e-fast-stream", Label: "E2E fast stream",
			Description:  "Short deterministic stream for browser tests.",
			IsSelectable: false,
			DurationMs:   2_000,
			IntervalMs:   20,
		},
	}
}

// MockModels renders the catalog in the shape the provider spec carries.
//
// Aliases travel as the protocol's `aliases` field, not folded into metadata: the client resolves a
// remembered model id through `findModelByReference`, which reads `model.aliases`. Hiding them in
// metadata left a stored `legacy-five-minute-stream` preference unresolved, so the composer fell
// back to an empty selection instead of the default model that owns that alias.
func MockModels() []sdk.CatalogModel {
	list := MockModelList()
	out := make([]sdk.CatalogModel, 0, len(list))
	for _, model := range list {
		entry := sdk.CatalogModel{
			Provider:                MockProviderID,
			ID:                      model.ID,
			Label:                   model.Label,
			Description:             model.Description,
			Aliases:                 model.Aliases,
			IsDefault:               model.IsDefault,
			IsSelectable:            model.IsSelectable,
			ThinkingOptions:         model.ThinkingOption,
			DefaultThinkingOptionID: model.DefaultThink,
		}
		out = append(out, entry)
	}
	return out
}

// ResolveMockModel finds a model by id, falling back to the default.
//
// Matched by id only, like node: `legacy-five-minute-stream` is both its own model and an alias of the default, and
// resolving the alias first would hand that spec the wrong entry (an offered model instead of the retired one it
// deliberately selects). Aliases are metadata for the client's picker, not an input to resolution.
//
// The fallback is the contract: an unknown id must still produce a working stream, because several specs create agents
// without naming a model.
func ResolveMockModel(modelID string) MockModel {
	requested := modelID
	for _, model := range MockModelList() {
		if model.ID == requested {
			return model
		}
	}
	return MockModelList()[0]
}

// TestProviders are addressable providers that are not part of the product's six built-ins.
//
// Node registers `mock` and `mock-slow` unconditionally in provider-registry.ts, so an agent can be created
// with either id. Keeping them out of BuiltinProviders preserves "the product ships six providers" while
// still letting the end-to-end specs create agents with `provider: "mock"`.
var TestProviders = []ProviderSpec{MockProvider}
