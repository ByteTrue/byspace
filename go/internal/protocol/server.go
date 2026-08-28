package protocol

import (
	"encoding/json"
	"errors"
)

type ServerMessage interface {
	serverMessageType() string
}

type ServerCapabilities struct {
	VoiceDictation       bool `json:"voiceDictation"`
	VoiceChat            bool `json:"voiceChat"`
	SpeechToText         bool `json:"speechToText"`
	ServerAudio          bool `json:"serverAudio"`
	BlobUpload           bool `json:"blobUpload"`
	BinaryTerminalStream bool `json:"binaryTerminalStream"`
	BinaryFileTransfer   bool `json:"binaryFileTransfer"`
	TerminalReconnectV2  bool `json:"terminalReconnectV2"`
	TerminalRestore      bool `json:"terminalRestore"`
	TerminalList         bool `json:"terminalList"`
	TerminalAttach       bool `json:"terminalAttach"`
	TerminalViewport     bool `json:"terminalViewport"`
	AgentSessionV2       bool `json:"agentSessionV2"`
}

type ServerFeatures struct {
	DirectorySync         bool `json:"directorySync"`
	AgentTurnIdentity     bool `json:"agentTurnIdentity"`
	WorkspaceMultiplicity bool `json:"workspaceMultiplicity,omitempty"`
	ProjectList           bool `json:"projectList,omitempty"`
	ProvidersSnapshot     bool `json:"providersSnapshot,omitempty"`
	ProvidersSnapshotCWD  bool `json:"providersSnapshotCwd,omitempty"`
	PairingOfferRPC       bool `json:"pairingOfferRpc,omitempty"`
	HubRelationship       bool `json:"hubRelationship,omitempty"`
}

type ServerInfo struct {
	Status       string              `json:"status"`
	ServerID     string              `json:"serverId"`
	Hostname     *string             `json:"hostname"`
	Version      *string             `json:"version"`
	Capabilities *ServerCapabilities `json:"capabilities,omitempty"`
	Features     *ServerFeatures     `json:"features,omitempty"`
}

func (ServerInfo) serverMessageType() string { return "status" }

type AgentCapabilities struct {
	SupportsStreaming          bool `json:"supportsStreaming"`
	SupportsSessionPersistence bool `json:"supportsSessionPersistence"`
	SupportsDynamicModes       bool `json:"supportsDynamicModes"`
	SupportsMCPServers         bool `json:"supportsMcpServers"`
	SupportsReasoningStream    bool `json:"supportsReasoningStream"`
	SupportsToolInvocations    bool `json:"supportsToolInvocations"`
}

type AgentSnapshot struct {
	ID                  string            `json:"id"`
	Provider            string            `json:"provider"`
	CWD                 string            `json:"cwd"`
	WorkspaceID         string            `json:"workspaceId,omitempty"`
	Model               *string           `json:"model"`
	ThinkingOptionID    *string           `json:"thinkingOptionId,omitempty"`
	EffectiveThinkingID *string           `json:"effectiveThinkingOptionId,omitempty"`
	CreatedAt           string            `json:"createdAt"`
	UpdatedAt           string            `json:"updatedAt"`
	LastUserMessageAt   *string           `json:"lastUserMessageAt"`
	Status              string            `json:"status"`
	Capabilities        AgentCapabilities `json:"capabilities"`
	CurrentModeID       *string           `json:"currentModeId"`
	AvailableModes      []json.RawMessage `json:"availableModes"`
	PendingPermissions  []json.RawMessage `json:"pendingPermissions"`
	Persistence         json.RawMessage   `json:"persistence"`
	Title               *string           `json:"title"`
	Labels              map[string]string `json:"labels"`
	RequiresAttention   *bool             `json:"requiresAttention,omitempty"`
	ProviderUnavailable *bool             `json:"providerUnavailable,omitempty"`
}

type AgentCreated struct {
	Status    string        `json:"status"`
	AgentID   string        `json:"agentId"`
	RequestID string        `json:"requestId"`
	Agent     AgentSnapshot `json:"agent"`
}

func (AgentCreated) serverMessageType() string { return "status" }

type AgentPageInfo struct {
	NextCursor *string `json:"nextCursor"`
	PrevCursor *string `json:"prevCursor"`
	HasMore    bool    `json:"hasMore"`
}

type AgentListSync struct {
	Generation string            `json:"generation"`
	HeadSeq    int               `json:"headSeq"`
	Mode       string            `json:"mode"`
	Removals   []json.RawMessage `json:"removals"`
}

type FetchAgentsResponse struct {
	RequestID      string            `json:"requestId"`
	SubscriptionID *string           `json:"subscriptionId"`
	Entries        []json.RawMessage `json:"entries"`
	PageInfo       AgentPageInfo     `json:"pageInfo"`
	Sync           AgentListSync     `json:"sync"`
}

func (FetchAgentsResponse) serverMessageType() string { return "fetch_agents_response" }

type TimelineWindow struct {
	MinSeq  int `json:"minSeq"`
	MaxSeq  int `json:"maxSeq"`
	NextSeq int `json:"nextSeq"`
}

type FetchAgentTimelineResponse struct {
	RequestID   string            `json:"requestId"`
	AgentID     string            `json:"agentId"`
	Agent       json.RawMessage   `json:"agent"`
	Direction   string            `json:"direction"`
	Projection  string            `json:"projection"`
	Epoch       string            `json:"epoch"`
	Reset       bool              `json:"reset"`
	StaleCursor bool              `json:"staleCursor"`
	Gap         bool              `json:"gap"`
	Window      TimelineWindow    `json:"window"`
	StartCursor json.RawMessage   `json:"startCursor"`
	EndCursor   json.RawMessage   `json:"endCursor"`
	HasOlder    bool              `json:"hasOlder"`
	HasNewer    bool              `json:"hasNewer"`
	MergeWindow *bool             `json:"mergeWindow,omitempty"`
	Entries     []json.RawMessage `json:"entries"`
	Error       *string           `json:"error"`
}

func (FetchAgentTimelineResponse) serverMessageType() string {
	return "fetch_agent_timeline_response"
}

type SendAgentMessageResponse struct {
	RequestID string  `json:"requestId"`
	AgentID   string  `json:"agentId"`
	Accepted  bool    `json:"accepted"`
	Error     *string `json:"error"`
}

func (SendAgentMessageResponse) serverMessageType() string {
	return "send_agent_message_response"
}

type AssistantTimelineItem struct {
	Type      string  `json:"type"`
	Text      string  `json:"text"`
	MessageID *string `json:"messageId,omitempty"`
}

type TimelineEvent struct {
	Type     string                `json:"type"`
	Provider string                `json:"provider"`
	Item     AssistantTimelineItem `json:"item"`
	TurnID   *string               `json:"turnId,omitempty"`
}

type AgentStream struct {
	AgentID   string        `json:"agentId"`
	Event     TimelineEvent `json:"event"`
	Timestamp string        `json:"timestamp"`
	Seq       int           `json:"seq"`
	Epoch     string        `json:"epoch"`
}

func (AgentStream) serverMessageType() string { return "agent_stream" }

func EncodePong() []byte {
	return []byte(`{"type":"pong"}`)
}

func EncodeServerMessage(message ServerMessage) ([]byte, error) {
	if message == nil {
		return nil, errors.New("protocol: server message is nil")
	}
	return EncodeSessionMessage(message.serverMessageType(), message)
}

func EncodeSessionMessage(messageType string, payload any) ([]byte, error) {
	if messageType == "" {
		return nil, errors.New("protocol: server message type is empty")
	}
	return json.Marshal(struct {
		Type    string `json:"type"`
		Message any    `json:"message"`
	}{
		Type: "session",
		Message: struct {
			Type    string `json:"type"`
			Payload any    `json:"payload"`
		}{
			Type:    messageType,
			Payload: payload,
		},
	})
}
