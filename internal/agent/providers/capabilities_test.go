package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type capabilityTestSession struct {
	ManagedSession
	capabilities sdk.AgentCapabilities
}

func (s capabilityTestSession) Capabilities() sdk.AgentCapabilities { return s.capabilities }

func TestCapabilitiesForPrefersNegotiatedRuntime(t *testing.T) {
	want := sdk.AgentCapabilities{SupportsStreaming: true, SupportsDynamicModes: true, CanCancel: true}
	got := CapabilitiesFor("acp", capabilityTestSession{capabilities: want})
	if got != want {
		t.Fatalf("capabilities = %#v, want %#v", got, want)
	}
}

func TestCapabilitiesForUsesAdapterDefaultsWithoutSession(t *testing.T) {
	got := CapabilitiesFor("claude", nil)
	if !got.SupportsStreaming || !got.SupportsToolInvocations || !got.CanCancel {
		t.Fatalf("missing default capabilities: %#v", got)
	}
	if got.SupportsDynamicModes {
		t.Fatal("static provider modes must not be advertised as dynamic")
	}
}
