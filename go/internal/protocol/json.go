package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// ClientFrame is one decoded client WebSocket frame. Exactly one of Hello or
// Message is populated for hello and session frames respectively.
type ClientFrame struct {
	Type    string
	Hello   *HelloMessage
	Message ClientMessage
}

type HelloMessage struct {
	Type            string                     `json:"type"`
	ClientID        string                     `json:"clientId"`
	ClientType      string                     `json:"clientType"`
	ProtocolVersion int                        `json:"protocolVersion"`
	AppVersion      string                     `json:"appVersion,omitempty"`
	Capabilities    map[string]json.RawMessage `json:"capabilities,omitempty"`
}

type ClientMessage interface {
	clientMessage()
}

type ClientHeartbeat struct {
	Type                   string          `json:"type"`
	DeviceType             string          `json:"deviceType"`
	FocusedAgentID         json.RawMessage `json:"focusedAgentId"`
	FocusedTerminalID      json.RawMessage `json:"focusedTerminalId,omitempty"`
	LastActivityAt         string          `json:"lastActivityAt"`
	AppVisible             bool            `json:"appVisible"`
	AppVisibilityChangedAt string          `json:"appVisibilityChangedAt,omitempty"`
}

func (ClientHeartbeat) clientMessage() {}

type FetchAgentsRequest struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Scope     string          `json:"scope,omitempty"`
	Sort      json.RawMessage `json:"sort,omitempty"`
	Page      json.RawMessage `json:"page,omitempty"`
	Subscribe json.RawMessage `json:"subscribe,omitempty"`
}

func (FetchAgentsRequest) clientMessage() {}

type FetchWorkspacesRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

func (FetchWorkspacesRequest) clientMessage() {}

type ProjectListRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

func (ProjectListRequest) clientMessage() {}

type ProjectIconRequest struct {
	Type      string `json:"type"`
	CWD       string `json:"cwd"`
	RequestID string `json:"requestId"`
}

func (ProjectIconRequest) clientMessage() {}

type ProjectIconGetRequest struct {
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	RequestID string `json:"requestId"`
}

func (ProjectIconGetRequest) clientMessage() {}

type DaemonGetPairingOfferRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	AppURL    string `json:"appUrl,omitempty"`
	RelayURL  string `json:"relayUrl,omitempty"`
}

func (DaemonGetPairingOfferRequest) clientMessage() {}

type GetDaemonConfigRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

func (GetDaemonConfigRequest) clientMessage() {}

type CheckoutStatusRequest struct {
	Type      string `json:"type"`
	CWD       string `json:"cwd"`
	RequestID string `json:"requestId"`
}

func (CheckoutStatusRequest) clientMessage() {}

type CheckoutPRStatusRequest struct {
	Type      string `json:"type"`
	CWD       string `json:"cwd"`
	RequestID string `json:"requestId"`
}

func (CheckoutPRStatusRequest) clientMessage() {}

type SubscribeTerminalsRequest struct {
	Type        string `json:"type"`
	CWD         string `json:"cwd"`
	WorkspaceID string `json:"workspaceId,omitempty"`
}

func (SubscribeTerminalsRequest) clientMessage() {}

type UnsubscribeTerminalsRequest struct {
	Type        string `json:"type"`
	CWD         string `json:"cwd"`
	WorkspaceID string `json:"workspaceId,omitempty"`
}

func (UnsubscribeTerminalsRequest) clientMessage() {}

type ListTerminalsRequest struct {
	Type        string `json:"type"`
	CWD         string `json:"cwd,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	RequestID   string `json:"requestId"`
}

func (ListTerminalsRequest) clientMessage() {}

type WorkspaceSetupStatusRequest struct {
	Type        string `json:"type"`
	WorkspaceID string `json:"workspaceId"`
	RequestID   string `json:"requestId"`
}

func (WorkspaceSetupStatusRequest) clientMessage() {}

type ListProviderFeaturesRequest struct {
	Type        string `json:"type"`
	DraftConfig struct {
		Provider string `json:"provider"`
	} `json:"draftConfig"`
	RequestID string `json:"requestId"`
}

func (ListProviderFeaturesRequest) clientMessage() {}

type ListAvailableProvidersRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

func (ListAvailableProvidersRequest) clientMessage() {}

type GetProvidersSnapshotRequest struct {
	Type        string  `json:"type"`
	CWD         *string `json:"cwd,omitempty"`
	IfNoneMatch *string `json:"ifNoneMatch,omitempty"`
	RequestID   string  `json:"requestId"`
}

func (GetProvidersSnapshotRequest) clientMessage() {}

type RefreshProvidersSnapshotRequest struct {
	Type      string   `json:"type"`
	Providers []string `json:"providers,omitempty"`
	CWD       *string  `json:"cwd,omitempty"`
	RequestID string   `json:"requestId"`
}

func (RefreshProvidersSnapshotRequest) clientMessage() {}

type ListProviderModelsRequest struct {
	Type      string  `json:"type"`
	Provider  string  `json:"provider"`
	CWD       *string `json:"cwd,omitempty"`
	RequestID string  `json:"requestId"`
}

func (ListProviderModelsRequest) clientMessage() {}

type ListProviderModesRequest struct {
	Type      string  `json:"type"`
	Provider  string  `json:"provider"`
	CWD       *string `json:"cwd,omitempty"`
	RequestID string  `json:"requestId"`
}

func (ListProviderModesRequest) clientMessage() {}

type AgentSessionConfig struct {
	Provider         string          `json:"provider"`
	CWD              string          `json:"cwd"`
	ModeID           *string         `json:"modeId,omitempty"`
	Model            *string         `json:"model,omitempty"`
	ThinkingOptionID *string         `json:"thinkingOptionId,omitempty"`
	FeatureValues    json.RawMessage `json:"featureValues,omitempty"`
	Title            *string         `json:"title,omitempty"`
	ProviderOptions  json.RawMessage `json:"providerOptions,omitempty"`
	SystemPrompt     *string         `json:"systemPrompt,omitempty"`
	MCPServers       json.RawMessage `json:"mcpServers,omitempty"`
}

type CreateAgentRequest struct {
	Type            string             `json:"type"`
	Config          AgentSessionConfig `json:"config"`
	WorkspaceID     string             `json:"workspaceId,omitempty"`
	CallerAgentID   string             `json:"callerAgentId,omitempty"`
	Env             map[string]string  `json:"env,omitempty"`
	Labels          map[string]string  `json:"labels"`
	InitialPrompt   string             `json:"initialPrompt,omitempty"`
	ClientMessageID string             `json:"clientMessageId,omitempty"`
	OutputSchema    json.RawMessage    `json:"outputSchema,omitempty"`
	Images          json.RawMessage    `json:"images,omitempty"`
	Attachments     json.RawMessage    `json:"attachments,omitempty"`
	Git             json.RawMessage    `json:"git,omitempty"`
	Worktree        json.RawMessage    `json:"worktree,omitempty"`
	WorktreeName    string             `json:"worktreeName,omitempty"`
	AutoArchive     bool               `json:"autoArchive"`
	RequestID       string             `json:"requestId"`
}

func (CreateAgentRequest) clientMessage() {}

type AgentTimelineCursor struct {
	Epoch string `json:"epoch"`
	Seq   int    `json:"seq"`
}

type FetchAgentTimelineRequest struct {
	Type        string               `json:"type"`
	AgentID     string               `json:"agentId"`
	Direction   *string              `json:"direction,omitempty"`
	Cursor      *AgentTimelineCursor `json:"cursor,omitempty"`
	Limit       *int                 `json:"limit,omitempty"`
	Projection  *string              `json:"projection,omitempty"`
	MergeWindow *bool                `json:"mergeWindow,omitempty"`
	RequestID   string               `json:"requestId"`
}

func (FetchAgentTimelineRequest) clientMessage() {}

type SendAgentMessageRequest struct {
	Type               string          `json:"type"`
	AgentID            string          `json:"agentId"`
	Text               string          `json:"text"`
	Images             json.RawMessage `json:"images,omitempty"`
	Attachments        json.RawMessage `json:"attachments,omitempty"`
	MessageID          *string         `json:"messageId,omitempty"`
	ActiveTurnBehavior *string         `json:"activeTurnBehavior,omitempty"`
	RequestID          string          `json:"requestId"`
}

func (SendAgentMessageRequest) clientMessage() {}

type CancelAgentRequest struct {
	Type      string `json:"type"`
	AgentID   string `json:"agentId"`
	RequestID string `json:"requestId,omitempty"`
}

func (CancelAgentRequest) clientMessage() {}

func DecodeClientFrame(data []byte) (ClientFrame, error) {
	object, err := decodeObject(data)
	if err != nil {
		return ClientFrame{}, err
	}

	frameType, err := requiredString(object, "type")
	if err != nil {
		return ClientFrame{}, err
	}

	switch frameType {
	case "ping":
		return ClientFrame{Type: "ping"}, nil
	case "hello":
		return decodeHello(data, object)
	case "session":
		messageData, _, err := requiredObject(object, "message")
		if err != nil {
			return ClientFrame{}, err
		}
		message, err := decodeClientMessage(messageData)
		if err != nil {
			return ClientFrame{}, err
		}
		return ClientFrame{Type: "session", Message: message}, nil
	default:
		return ClientFrame{}, fmt.Errorf("protocol: unsupported client frame type %q", frameType)
	}
}

func decodeHello(data []byte, object map[string]json.RawMessage) (ClientFrame, error) {
	clientID, err := requiredString(object, "clientId")
	if err != nil {
		return ClientFrame{}, err
	}
	if clientID == "" {
		return ClientFrame{}, errors.New("protocol: clientId must not be empty")
	}
	clientType, err := requiredString(object, "clientType")
	if err != nil {
		return ClientFrame{}, err
	}
	if !oneOf(clientType, "mobile", "browser", "cli", "mcp") {
		return ClientFrame{}, fmt.Errorf("protocol: invalid clientType %q", clientType)
	}
	if _, err := requiredInt(object, "protocolVersion"); err != nil {
		return ClientFrame{}, err
	}
	if raw, ok := object["capabilities"]; ok {
		if _, err := decodeObject(raw); err != nil {
			return ClientFrame{}, fmt.Errorf("protocol: capabilities: %w", err)
		}
	}

	var hello HelloMessage
	if err := json.Unmarshal(data, &hello); err != nil {
		return ClientFrame{}, fmt.Errorf("protocol: decode hello: %w", err)
	}
	return ClientFrame{Type: "hello", Hello: &hello}, nil
}

func decodeClientMessage(data []byte) (ClientMessage, error) {
	object, err := decodeObject(data)
	if err != nil {
		return nil, fmt.Errorf("protocol: session message: %w", err)
	}
	messageType, err := requiredString(object, "type")
	if err != nil {
		return nil, err
	}

	switch messageType {
	case "client_heartbeat":
		for _, field := range []string{"deviceType", "lastActivityAt"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		if err := optionalEnum(object, "deviceType", "web", "mobile"); err != nil {
			return nil, err
		}
		if err := nullableString(object, "focusedAgentId", true); err != nil {
			return nil, err
		}
		if err := nullableString(object, "focusedTerminalId", false); err != nil {
			return nil, err
		}
		if _, ok := object["appVisible"]; !ok {
			return nil, errors.New("protocol: missing appVisible")
		}
		var message ClientHeartbeat
		return message, decodeInto(data, &message)
	case "fetch_agents_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message FetchAgentsRequest
		return message, decodeInto(data, &message)
	case "fetch_workspaces_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message FetchWorkspacesRequest
		return message, decodeInto(data, &message)
	case "project.list.request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message ProjectListRequest
		return message, decodeInto(data, &message)
	case "project_icon_request":
		for _, field := range []string{"cwd", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message ProjectIconRequest
		return message, decodeInto(data, &message)
	case "project.icon.get.request":
		for _, field := range []string{"projectId", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message ProjectIconGetRequest
		return message, decodeInto(data, &message)
	case "daemon.get_pairing_offer.request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		for _, field := range []string{"appUrl", "relayUrl"} {
			if raw, ok := object[field]; ok {
				var value string
				if err := json.Unmarshal(raw, &value); err != nil {
					return nil, fmt.Errorf("protocol: %s must be a string", field)
				}
			}
		}
		var message DaemonGetPairingOfferRequest
		return message, decodeInto(data, &message)
	case "get_daemon_config_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message GetDaemonConfigRequest
		return message, decodeInto(data, &message)
	case "checkout_status_request":
		for _, field := range []string{"cwd", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message CheckoutStatusRequest
		return message, decodeInto(data, &message)
	case "checkout_pr_status_request":
		for _, field := range []string{"cwd", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message CheckoutPRStatusRequest
		return message, decodeInto(data, &message)
	case "subscribe_terminals_request", "unsubscribe_terminals_request":
		if _, err := requiredString(object, "cwd"); err != nil {
			return nil, err
		}
		if messageType == "subscribe_terminals_request" {
			var message SubscribeTerminalsRequest
			return message, decodeInto(data, &message)
		}
		var message UnsubscribeTerminalsRequest
		return message, decodeInto(data, &message)
	case "list_terminals_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message ListTerminalsRequest
		return message, decodeInto(data, &message)
	case "workspace_setup_status_request":
		for _, field := range []string{"workspaceId", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message WorkspaceSetupStatusRequest
		return message, decodeInto(data, &message)
	case "list_provider_features_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		_, draftConfig, err := requiredObject(object, "draftConfig")
		if err != nil {
			return nil, err
		}
		if _, err := requiredString(draftConfig, "provider"); err != nil {
			return nil, fmt.Errorf("protocol: draftConfig: %w", err)
		}
		var message ListProviderFeaturesRequest
		return message, decodeInto(data, &message)
	case "list_available_providers_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message ListAvailableProvidersRequest
		return message, decodeInto(data, &message)
	case "get_providers_snapshot_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		var message GetProvidersSnapshotRequest
		return message, decodeInto(data, &message)
	case "refresh_providers_snapshot_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		if err := optionalArray(object, "providers"); err != nil {
			return nil, err
		}
		var message RefreshProvidersSnapshotRequest
		return message, decodeInto(data, &message)
	case "list_provider_models_request":
		for _, field := range []string{"provider", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message ListProviderModelsRequest
		return message, decodeInto(data, &message)
	case "list_provider_modes_request":
		for _, field := range []string{"provider", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message ListProviderModesRequest
		return message, decodeInto(data, &message)
	case "create_agent_request":
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		_, config, err := requiredObject(object, "config")
		if err != nil {
			return nil, err
		}
		if _, err := requiredString(config, "provider"); err != nil {
			return nil, fmt.Errorf("protocol: config: %w", err)
		}
		if _, err := requiredString(config, "cwd"); err != nil {
			return nil, fmt.Errorf("protocol: config: %w", err)
		}
		for _, field := range []string{"images", "attachments"} {
			if err := optionalArray(object, field); err != nil {
				return nil, err
			}
		}
		var message CreateAgentRequest
		return message, decodeInto(data, &message)
	case "fetch_agent_timeline_request":
		if _, err := requiredString(object, "agentId"); err != nil {
			return nil, err
		}
		if _, err := requiredString(object, "requestId"); err != nil {
			return nil, err
		}
		if err := optionalEnum(object, "direction", "tail", "before", "after"); err != nil {
			return nil, err
		}
		if err := optionalEnum(object, "projection", "projected", "canonical"); err != nil {
			return nil, err
		}
		if err := optionalNonnegativeInt(object, "limit"); err != nil {
			return nil, err
		}
		if cursor, ok := object["cursor"]; ok {
			cursorObject, err := decodeObject(cursor)
			if err != nil {
				return nil, fmt.Errorf("protocol: cursor: %w", err)
			}
			if _, err := requiredString(cursorObject, "epoch"); err != nil {
				return nil, fmt.Errorf("protocol: cursor: %w", err)
			}
			seq, err := requiredInt(cursorObject, "seq")
			if err != nil {
				return nil, fmt.Errorf("protocol: cursor: %w", err)
			}
			if seq < 0 {
				return nil, errors.New("protocol: cursor seq must not be negative")
			}
		}
		var message FetchAgentTimelineRequest
		return message, decodeInto(data, &message)
	case "send_agent_message_request":
		for _, field := range []string{"agentId", "text", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		if err := optionalEnum(object, "activeTurnBehavior", "interrupt", "steer"); err != nil {
			return nil, err
		}
		for _, field := range []string{"images", "attachments"} {
			if err := optionalArray(object, field); err != nil {
				return nil, err
			}
		}
		var message SendAgentMessageRequest
		return message, decodeInto(data, &message)
	case "cancel_agent_request":
		for _, field := range []string{"agentId", "requestId"} {
			if _, err := requiredString(object, field); err != nil {
				return nil, err
			}
		}
		var message CancelAgentRequest
		return message, decodeInto(data, &message)
	default:
		return nil, fmt.Errorf("protocol: unsupported client message type %q", messageType)
	}
}

func (frame ClientFrame) MarshalJSON() ([]byte, error) {
	switch frame.Type {
	case "ping":
		return []byte(`{"type":"ping"}`), nil
	case "hello":
		if frame.Hello == nil {
			return nil, errors.New("protocol: hello frame has no hello payload")
		}
		hello := *frame.Hello
		hello.Type = "hello"
		return json.Marshal(hello)
	case "session":
		if frame.Message == nil {
			return nil, errors.New("protocol: session frame has no message")
		}
		return json.Marshal(struct {
			Type    string        `json:"type"`
			Message ClientMessage `json:"message"`
		}{Type: "session", Message: frame.Message})
	default:
		return nil, fmt.Errorf("protocol: unsupported client frame type %q", frame.Type)
	}
}

func decodeObject(data []byte) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, fmt.Errorf("protocol: expected JSON object: %w", err)
	}
	if object == nil {
		return nil, errors.New("protocol: expected JSON object")
	}
	return object, nil
}

func requiredObject(object map[string]json.RawMessage, field string) (json.RawMessage, map[string]json.RawMessage, error) {
	raw, ok := object[field]
	if !ok {
		return nil, nil, fmt.Errorf("protocol: missing %s", field)
	}
	value, err := decodeObject(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("protocol: %s: %w", field, err)
	}
	return raw, value, nil
}

func requiredString(object map[string]json.RawMessage, field string) (string, error) {
	raw, ok := object[field]
	if !ok {
		return "", fmt.Errorf("protocol: missing %s", field)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("protocol: %s must be a string", field)
	}
	return value, nil
}

func requiredInt(object map[string]json.RawMessage, field string) (int, error) {
	raw, ok := object[field]
	if !ok {
		return 0, fmt.Errorf("protocol: missing %s", field)
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, fmt.Errorf("protocol: %s must be an integer", field)
	}
	return value, nil
}

func nullableString(object map[string]json.RawMessage, field string, required bool) error {
	raw, ok := object[field]
	if !ok {
		if required {
			return fmt.Errorf("protocol: missing %s", field)
		}
		return nil
	}
	var value *string
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("protocol: %s must be a string or null", field)
	}
	return nil
}

func optionalEnum(object map[string]json.RawMessage, field string, allowed ...string) error {
	raw, ok := object[field]
	if !ok {
		return nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("protocol: %s must be a string", field)
	}
	if !oneOf(value, allowed...) {
		return fmt.Errorf("protocol: invalid %s %q", field, value)
	}
	return nil
}

func optionalArray(object map[string]json.RawMessage, field string) error {
	raw, ok := object[field]
	if !ok {
		return nil
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return fmt.Errorf("protocol: %s must be an array", field)
	}
	var values []json.RawMessage
	if err := json.Unmarshal(trimmed, &values); err != nil {
		return fmt.Errorf("protocol: %s must be an array", field)
	}
	return nil
}

func optionalNonnegativeInt(object map[string]json.RawMessage, field string) error {
	raw, ok := object[field]
	if !ok {
		return nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil || value < 0 {
		return fmt.Errorf("protocol: %s must be a nonnegative integer", field)
	}
	return nil
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func decodeInto(data []byte, value any) error {
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("protocol: decode message: %w", err)
	}
	return nil
}
