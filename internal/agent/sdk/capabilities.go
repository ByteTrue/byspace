package sdk

// AgentCapabilities describes what the selected adapter can actually do. Runtime reporters may
// replace the provider defaults after protocol negotiation.
func DefaultAgentCapabilities() AgentCapabilities {
	return AgentCapabilities{
		SupportsStreaming: true, SupportsSessionPersistence: true, SupportsMcpServers: true,
		SupportsReasoningStream: true, SupportsToolInvocations: true, CanCancel: true,
		CanSelectModel: true, CanSelectThinking: true, SupportsImages: true, SupportsAttachments: true,
	}
}

type AgentCapabilities struct {
	SupportsStreaming          bool
	SupportsSessionPersistence bool
	SupportsDynamicModes       bool
	SupportsMcpServers         bool
	SupportsReasoningStream    bool
	SupportsToolInvocations    bool
	CanCancel                  bool
	CanSelectModel             bool
	CanSelectThinking          bool
	SupportsImages             bool
	SupportsAttachments        bool
	SupportsNativeArchive      bool
	SupportsHistoryImport      bool
	SupportsNativeSubagents    bool
}
