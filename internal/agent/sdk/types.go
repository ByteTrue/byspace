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
	// Level and Message are the notification item's fields. The protocol's notification schema requires both, and
	// a notification without them fails validation — which drops the whole timeline response, not just that item.
	// Message doubles as the `error` item's text.
	Level   string `json:"level,omitempty"`
	Message string `json:"message,omitempty"`
	// Metadata is a tool_call's side channel: nested codemode rows read parentToolCallId and
	// nestedSummary out of it to fold their calls under the parent.
	Metadata map[string]any `json:"-"`
	// The custom_message item's fields. Display is required even when false, so MarshalJSON
	// emits it unconditionally rather than relying on a struct tag.
	CustomType string `json:"customType,omitempty"`
	Display    bool   `json:"-"`
	Content    string `json:"content,omitempty"`
	Details    any    `json:"-"`
	// Items is the todo item's task list.
	Items []TaskItem `json:"-"`
}

// TaskItem is one row of a todo item. Mirrors AgentTaskItem in packages/protocol.
type TaskItem struct {
	Text       string `json:"text"`
	Completed  bool   `json:"completed"`
	ID         string `json:"id,omitempty"`
	Status     string `json:"status,omitempty"`
	ActiveForm string `json:"activeForm,omitempty"`
}

// MarshalJSON emits exactly the fields the protocol's timeline union requires, per item type.
//
// One shape does not serve every branch: tool_call needs `"error": null` when there is no error
// (ToolCallRunningPayloadSchema / ToolCallCompletedPayloadSchema require it), notification needs
// level and message and no text, custom_message needs `display` even when false, todo needs its
// item list. Emitting a superset dropped the required keys of every non-text branch, and an item
// that fails validation takes the whole timeline response with it rather than being skipped.
func (i TimelineItem) MarshalJSON() ([]byte, error) {
	switch i.Type {
	case "tool_call":
		item := map[string]any{
			"type":   i.Type,
			"callId": i.CallID,
			"name":   i.Name,
			"status": i.Status,
			"detail": i.Detail,
			"error":  i.Error,
		}
		if i.Metadata != nil {
			item["metadata"] = i.Metadata
		}
		return json.Marshal(item)
	case "notification":
		return json.Marshal(map[string]any{
			"type":    i.Type,
			"level":   i.Level,
			"message": i.Message,
		})
	case "custom_message":
		item := map[string]any{
			"type":       i.Type,
			"customType": i.CustomType,
			"display":    i.Display,
			"content":    i.Content,
		}
		if i.Details != nil {
			item["details"] = i.Details
		}
		return json.Marshal(item)
	case "todo":
		items := i.Items
		if items == nil {
			items = []TaskItem{}
		}
		return json.Marshal(map[string]any{
			"type":  i.Type,
			"items": items,
		})
	case "error":
		return json.Marshal(map[string]any{
			"type":    i.Type,
			"message": i.Message,
		})
	}
	item := map[string]any{
		"type": i.Type,
		"text": i.Text,
	}
	if i.MessageID != "" {
		item["messageId"] = i.MessageID
	}
	if i.ClientMessageID != "" {
		item["clientMessageId"] = i.ClientMessageID
	}
	return json.Marshal(item)
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
// Mirrors PiSessionStats in archive/.../pi/rpc-types.ts.
type SessionStats struct {
	Tokens       map[string]int `json:"tokens,omitempty"`
	Cost         float64        `json:"cost,omitempty"`
	ContextUsage *ContextUsage  `json:"contextUsage,omitempty"`
}

// ContextUsage is how full the model's context window is.
// Pointers because pi reports nulls for models with no window information.
type ContextUsage struct {
	Tokens        *int `json:"tokens"`
	ContextWindow *int `json:"contextWindow"`
	// Percent is fractional: pi reports 1.5405 for 1.5405% of the window.
	Percent *float64 `json:"percent"`
}

// AgentUsage is what the composer renders: token counts, spend, and context fill.
// Mirrors AgentUsageSchema in packages/protocol.
type AgentUsage struct {
	InputTokens             int     `json:"inputTokens,omitempty"`
	CachedInputTokens       int     `json:"cachedInputTokens,omitempty"`
	OutputTokens            int     `json:"outputTokens,omitempty"`
	TotalCostUSD            float64 `json:"totalCostUsd,omitempty"`
	ContextWindowMaxTokens  *int    `json:"contextWindowMaxTokens,omitempty"`
	ContextWindowUsedTokens *int    `json:"contextWindowUsedTokens,omitempty"`
}

// SlashCommand is a command a provider exposes to the client.
type SlashCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// ArgumentHint names the argument's shape (`<message>`, `[on|off|toggle]`). Required by the
	// protocol: an omitted value fails the whole list_commands_response, so the palette would be empty
	// for every provider rather than for one.
	ArgumentHint string `json:"argumentHint"`
	// Kind is "command" or "skill". Optional on the wire, defaulting to "command".
	Kind string `json:"kind,omitempty"`
	// Source is provider bookkeeping, not part of AgentSlashCommand.
	Source string `json:"-"`
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
	// Subtitle is the provider-formatted one-liner shown under the title: model, effort, token
	// usage. Providers choose what belongs in it and clients must not parse it.
	Subtitle *string `json:"subtitle,omitempty"`
	// Model, Effort and TotalTokens are the raw facts a provider's own subtitle builder uses.
	// Keeping them means a subtitle can be rebuilt when a later event fills in a value that was
	// missing when the first upsert was sent.
	Model       *string `json:"-"`
	Effort      *string `json:"-"`
	TotalTokens *int64  `json:"-"`

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
