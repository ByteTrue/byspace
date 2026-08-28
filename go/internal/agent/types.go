package agent

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrAgentBusy        = errors.New("agent already has an active turn")
	ErrAgentNotFound    = errors.New("agent not found")
	ErrAgentNotRunning  = errors.New("agent has no active turn")
	ErrAgentClosed      = errors.New("agent is closed")
	ErrProviderExited   = errors.New("agent provider session has exited")
	ErrSessionUnusable  = errors.New("provider session is unusable")
	ErrManagerClosed    = errors.New("agent manager is closed")
	ErrProviderNotFound = errors.New("agent provider not found")
)

type Lifecycle string

const (
	LifecycleInitializing Lifecycle = "initializing"
	LifecycleIdle         Lifecycle = "idle"
	LifecycleRunning      Lifecycle = "running"
	LifecycleError        Lifecycle = "error"
	LifecycleClosed       Lifecycle = "closed"
)

type Config struct {
	Provider         string
	CWD              string
	WorkspaceID      string
	Model            string
	ThinkingOptionID string
	Title            string
	Labels           map[string]string
	Resume           *PersistenceHandle
}

type Capabilities struct {
	SupportsStreaming          bool `json:"supportsStreaming"`
	SupportsSessionPersistence bool `json:"supportsSessionPersistence"`
	SupportsDynamicModes       bool `json:"supportsDynamicModes"`
	SupportsMCPServers         bool `json:"supportsMcpServers"`
	SupportsReasoningStream    bool `json:"supportsReasoningStream"`
	SupportsToolInvocations    bool `json:"supportsToolInvocations"`
}

type RuntimeInfo struct {
	Provider         string `json:"provider"`
	SessionID        string `json:"sessionId"`
	NativeHandle     string `json:"nativeHandle"`
	Model            string `json:"model"`
	ThinkingOptionID string `json:"thinkingOptionId"`
	ModeID           string `json:"modeId"`
}

type PersistenceHandle struct {
	Provider     string `json:"provider"`
	SessionID    string `json:"sessionId"`
	NativeHandle string `json:"nativeHandle"`
}

type Snapshot struct {
	ID                string             `json:"id"`
	Provider          string             `json:"provider"`
	CWD               string             `json:"cwd"`
	WorkspaceID       string             `json:"workspaceId"`
	Title             string             `json:"title"`
	Labels            map[string]string  `json:"labels"`
	Lifecycle         Lifecycle          `json:"lifecycle"`
	CreatedAt         time.Time          `json:"createdAt"`
	UpdatedAt         time.Time          `json:"updatedAt"`
	LastUserMessageAt time.Time          `json:"lastUserMessageAt,omitempty"`
	ActiveTurnID      string             `json:"activeTurnId,omitempty"`
	LastError         string             `json:"lastError,omitempty"`
	RuntimeInfo       RuntimeInfo        `json:"runtimeInfo"`
	Capabilities      Capabilities       `json:"capabilities"`
	Persistence       *PersistenceHandle `json:"persistence,omitempty"`
	TimelineEpoch     string             `json:"timelineEpoch"`
	TimelineHeadSeq   uint64             `json:"timelineHeadSeq"`
}

type TimelineItemType string

const (
	TimelineUserMessage      TimelineItemType = "user_message"
	TimelineAssistantMessage TimelineItemType = "assistant_message"
	TimelineReasoning        TimelineItemType = "reasoning"
	TimelineToolCall         TimelineItemType = "tool_call"
	TimelineError            TimelineItemType = "error"
)

type TimelineItem struct {
	Type            TimelineItemType `json:"type"`
	Text            string           `json:"text,omitempty"`
	MessageID       string           `json:"messageId,omitempty"`
	ClientMessageID string           `json:"clientMessageId,omitempty"`
	CallID          string           `json:"callId,omitempty"`
	Name            string           `json:"name,omitempty"`
	Status          string           `json:"status,omitempty"`
	Input           json.RawMessage  `json:"input,omitempty"`
	Output          json.RawMessage  `json:"output,omitempty"`
	Error           string           `json:"error,omitempty"`
}

type TimelineRow struct {
	Seq       uint64       `json:"seq"`
	Timestamp time.Time    `json:"timestamp"`
	TurnID    string       `json:"turnId,omitempty"`
	Item      TimelineItem `json:"item"`
}

type TimelineSnapshot struct {
	Epoch string        `json:"epoch"`
	Rows  []TimelineRow `json:"rows"`
}

type ProviderEventType string

const (
	ProviderEventThreadStarted ProviderEventType = "thread_started"
	ProviderEventTurnStarted   ProviderEventType = "turn_started"
	ProviderEventTimeline      ProviderEventType = "timeline"
	ProviderEventTurnCompleted ProviderEventType = "turn_completed"
	ProviderEventTurnFailed    ProviderEventType = "turn_failed"
	ProviderEventTurnCanceled  ProviderEventType = "turn_canceled"
	ProviderEventProcessExited ProviderEventType = "process_exited"
)

type ProviderEvent struct {
	Type      ProviderEventType
	TurnID    string
	SessionID string
	Item      TimelineItem
	Error     string
}

type Provider interface {
	Start(context.Context, Config) (Session, error)
}

type Session interface {
	RuntimeInfo() RuntimeInfo
	Capabilities() Capabilities
	Events() <-chan ProviderEvent
	Prompt(context.Context, string, string) error
	Abort(context.Context) error
	Close(context.Context) error
}

type SendResult struct {
	Accepted  bool
	Duplicate bool
	TurnID    string
}

type EventType string

const (
	EventAgentState  EventType = "agent_state"
	EventAgentStream EventType = "agent_stream"
)

type Event struct {
	Type    EventType
	AgentID string
	Agent   *Snapshot
	Stream  *ProviderEvent
	Row     *TimelineRow
	Epoch   string
}
