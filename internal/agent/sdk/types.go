// Package sdk holds the agent-facing types every provider shares: the timeline item shape,
// the model catalog, prompt attachments and subagent descriptors.
//
// It exists to break a dependency inversion: `providers` used to import `pi` just to reach
// these types, which made one concrete provider look like the agent core. Node never had the
// problem because all of this lives in `agent/agent-sdk-types.ts`, above every provider.
package sdk

import "encoding/json"

// TimelineItem is a normalized BySpace timeline item
// (user_message, assistant_message, reasoning, tool_call).
// Mirrors AgentTimelineItem in packages/server/src/server/agent/agent-sdk-types.ts.
type TimelineItem struct {
	Type            string `json:"type"`
	Text            string `json:"text,omitempty"`
	MessageID       string `json:"messageId,omitempty"`
	ClientMessageID string `json:"clientMessageId,omitempty"`
	CallID          string `json:"callId,omitempty"`
	Name            string `json:"name,omitempty"`
	Status          string `json:"status,omitempty"`
	Detail          any    `json:"detail,omitempty"`
	Error           any    `json:"error,omitempty"`
}

// MarshalJSON keeps tool_call items emitting `"error": null` when there is no error, which
// ToolCallRunningPayloadSchema / ToolCallCompletedPayloadSchema in @bytetrue/protocol require.
func (i TimelineItem) MarshalJSON() ([]byte, error) {
	if i.Type == "tool_call" {
		return json.Marshal(map[string]any{
			"type":   i.Type,
			"callId": i.CallID,
			"name":   i.Name,
			"status": i.Status,
			"detail": i.Detail,
			"error":  i.Error,
		})
	}
	m := map[string]any{
		"type": i.Type,
		"text": i.Text,
	}
	if i.MessageID != "" {
		m["messageId"] = i.MessageID
	}
	if i.ClientMessageID != "" {
		m["clientMessageId"] = i.ClientMessageID
	}
	return json.Marshal(m)
}

// TimelineEntry pairs a TimelineItem with the sequence range it occupies.
// A streamed message occupies seq..seqEnd; a discrete item has seq == seqEnd.
type TimelineEntry struct {
	Seq       int          `json:"seq"`
	SeqEnd    int          `json:"seqEnd,omitempty"`
	TurnID    string       `json:"turnId,omitempty"`
	Timestamp string       `json:"timestamp"`
	Item      TimelineItem `json:"item"`
}

// ImageContent is one base64 image block attached to a prompt.
type ImageContent struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// PromptImage is the wire shape of an image passed with a prompt.
type PromptImage struct {
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// Model is a provider model entry as reported by the provider runtime.
type Model struct {
	Provider         string             `json:"provider"`
	ID               string             `json:"id"`
	Name             string             `json:"name,omitempty"`
	Reasoning        bool               `json:"reasoning,omitempty"`
	ThinkingLevelMap map[string]*string `json:"thinkingLevelMap,omitempty"`
	ContextWindow    int                `json:"contextWindow,omitempty"`
	MaxTokens        int                `json:"maxTokens,omitempty"`
	API              string             `json:"api,omitempty"`
	BaseURL          string             `json:"baseUrl,omitempty"`
	Cost             map[string]any     `json:"cost,omitempty"`
}

// SessionState is the runtime status a provider reports for one session.
type SessionState struct {
	Model                 *Model `json:"model,omitempty"`
	ThinkingLevel         string `json:"thinkingLevel"`
	IsStreaming           bool   `json:"isStreaming"`
	IsCompacting          bool   `json:"isCompacting"`
	AutoCompactionEnabled bool   `json:"autoCompactionEnabled,omitempty"`
	SessionFile           string `json:"sessionFile,omitempty"`
	SessionID             string `json:"sessionId"`
	SessionName           string `json:"sessionName,omitempty"`
	MessageCount          int    `json:"messageCount"`
	PendingMessageCount   int    `json:"pendingMessageCount"`
}

// SessionStats carries token and cost accounting for a session.
type SessionStats struct {
	Tokens map[string]int `json:"tokens,omitempty"`
	Cost   float64        `json:"cost,omitempty"`
}

// SlashCommand is a command a provider exposes to the client.
type SlashCommand struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
}

// CatalogModel is a BySpace-formatted model definition shown in the model picker.
// Mirrors AgentModelDefinition in packages/protocol.
type CatalogModel struct {
	ID                      string            `json:"id"`
	Label                   string            `json:"label"`
	Description             string            `json:"description,omitempty"`
	Provider                string            `json:"provider"`
	Metadata                map[string]string `json:"metadata,omitempty"`
	IsDefault               bool              `json:"isDefault,omitempty"`
	IsSelectable            bool              `json:"isSelectable,omitempty"`
	ThinkingOptions         []ThinkingOption  `json:"thinkingOptions,omitempty"`
	DefaultThinkingOptionID string            `json:"defaultThinkingOptionId,omitempty"`
}

// ThinkingOption is one selectable reasoning level for a model.
type ThinkingOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	IsDefault   bool   `json:"isDefault,omitempty"`
}

// SubagentDescriptor mirrors ProviderSubagentDescriptorPayloadSchema in packages/protocol.
type SubagentDescriptor struct {
	ID               string  `json:"id"`
	ParentAgentID    string  `json:"parentAgentId"`
	ParentSubagentID *string `json:"parentSubagentId,omitempty"`
	Provider         string  `json:"provider"`
	Title            *string `json:"title"`
	Description      *string `json:"description"`
	Status           string  `json:"status"` // "running" | "completed" | "failed" | "canceled"
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt"`
	ToolCallID       *string `json:"toolCallId"`
	Cwd              *string `json:"cwd,omitempty"`

	// Internal pointer fields used for timeline recovery
	SessionID   string `json:"-"`
	SessionFile string `json:"-"`
}

// ImportableSession is a provider-owned transcript that can be imported as an agent.
// Mirrors RecentProviderSessionDescriptorPayloadSchema in packages/protocol.
type ImportableSession struct {
	Provider           string  `json:"providerId"`
	ProviderLabel      string  `json:"providerLabel"`
	ProviderHandleID   string  `json:"providerHandleId"`
	Cwd                string  `json:"cwd"`
	Title              string  `json:"title"`
	FirstPromptPreview *string `json:"firstPromptPreview"`
	LastPromptPreview  *string `json:"lastPromptPreview"`
	LastActivityAt     string  `json:"lastActivityAt"`
}
