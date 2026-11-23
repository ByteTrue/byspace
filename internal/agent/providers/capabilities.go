package providers

import "github.com/ByteTrue/byspace/internal/agent/sdk"

// CapabilityReporter is implemented by sessions whose negotiated protocol differs from the
// provider's static defaults (ACP and versioned OpenCode in particular).
type CapabilityReporter interface {
	Capabilities() sdk.AgentCapabilities
}

func defaultAgentCapabilities() sdk.AgentCapabilities {
	return sdk.DefaultAgentCapabilities()
}

// CapabilitiesFor uses adapter defaults until a live session can report negotiated support.
func CapabilitiesFor(provider string, session ManagedSession) sdk.AgentCapabilities {
	if reporter, ok := session.(CapabilityReporter); ok {
		return reporter.Capabilities()
	}
	return defaultAgentCapabilities()
}
