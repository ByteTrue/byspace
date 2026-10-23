package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// OpenCodeSession hosts an OpenCode agent via its HTTP/SSE server (`opencode serve`)
// or an ACP/JSON-RPC compatible OpenCode binary.
type OpenCodeSession struct {
	baseURL    string
	httpClient *http.Client
	cmd        *exec.Cmd
	acpFallbk  *ACPSession

	mu               sync.Mutex
	status           string
	sessionID        string
	cwd              string
	model            string
	modeID           string
	thinking         string
	turnCounter      int
	activeTurnID     string
	timeline         []sdk.TimelineEntry
	finishWaiters    []chan error
	eventSubscribers map[int]func(map[string]any)
	nextSubID        int
}

// StartOpenCodeSession starts or attaches to an OpenCode agent session.
func StartOpenCodeSession(cfg LaunchConfig, cmdOverride string) (ManagedSession, error) {
	urlOverride := strings.TrimSpace(os.Getenv("OPENCODE_SERVER_URL"))
	if strings.HasPrefix(cmdOverride, "http://") || strings.HasPrefix(cmdOverride, "https://") {
		urlOverride = cmdOverride
	}

	if urlOverride != "" {
		return newHTTPOpenCodeSession(cfg, strings.TrimRight(urlOverride, "/"))
	}

	// No override and no explicit ACP request: start (or reuse) an `opencode serve` process. Without this
	// an OpenCode agent on a machine with no manually started server did not work at all — the session
	// appeared to exist and every request failed.
	if !strings.HasSuffix(cmdOverride, "acp") {
		spec := GetProviderSpec("opencode")
		pool := sharedOpenCodePool(cfg.HomeDir, cmdOverride, spec.DefaultArgs)
		server, err := pool.Acquire(context.Background())
		if err == nil && server != nil {
			return newHTTPOpenCodeSession(cfg, server.URL)
		}
		// Fall through to ACP: a machine without the server binary can still drive the agent through
		// stdio, and that is better than failing the create.
	}

	// If command override points to a stdio script/binary or `opencode acp`, drive via ACP/stdio
	spec := GetProviderSpec("opencode")
	spec.DefaultArgs = []string{"acp"}
	return StartACPSession(cfg, spec, cmdOverride)
}

func newHTTPOpenCodeSession(cfg LaunchConfig, baseURL string) (*OpenCodeSession, error) {
	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{Proxy: nil},
	}
	s := &OpenCodeSession{
		baseURL:          baseURL,
		httpClient:       client,
		status:           "idle",
		cwd:              cfg.Cwd,
		model:            cfg.Model,
		modeID:           cfg.ModeID,
		thinking:         cfg.ThinkingOptionID,
		sessionID:        cfg.SessionHandle,
		eventSubscribers: make(map[int]func(map[string]any)),
	}

	if s.sessionID == "" {
		body, _ := json.Marshal(map[string]any{"cwd": cfg.Cwd})
		resp, err := client.Post(baseURL+"/session", "application/json", bytes.NewReader(body))
		if err == nil {
			var res map[string]any
			_ = json.NewDecoder(resp.Body).Decode(&res)
			_ = resp.Body.Close()
			if id, ok := res["id"].(string); ok && id != "" {
				s.sessionID = id
			}
		}
		if s.sessionID == "" {
			s.sessionID = "oc_sess_1"
		}
	}
	return s, nil
}

func (s *OpenCodeSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *OpenCodeSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *OpenCodeSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *OpenCodeSession) SetNextClientMessageID(_ string) {}

func (s *OpenCodeSession) LastError() string {
	return ""
}

// TurnToken returns "" for providers without an explicit turn token; the daemon then relies
// on its own turn id comparison.
func (s *OpenCodeSession) TurnToken() string { return "" }

// Usage reports token/cost accounting when the provider exposes it.
func (s *OpenCodeSession) Usage(_ context.Context) *sdk.AgentUsage {
	return nil
}

func (s *OpenCodeSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.timeline)
}

func (s *OpenCodeSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" {
		return "", ""
	}
	return s.activeTurnID, ""
}

func (s *OpenCodeSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *OpenCodeSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := sdk.TimelineEntry{
		Seq:       len(s.timeline) + 1,
		SeqEnd:    len(s.timeline) + 1,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	}
	s.timeline = append(s.timeline, entry)
	return entry
}

func (s *OpenCodeSession) Prompt(_ context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.timeline = append(s.timeline, sdk.TimelineEntry{
		Seq:       len(s.timeline) + 1,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item: sdk.TimelineItem{
			Type: "user_message",
			Text: message,
		},
	})
	sid := s.sessionID
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{"type": "turn_start"})
	}

	go func() {
		parts := []map[string]any{{"type": "text", "text": message}}
		parts = append(parts, imageBlocksForOpenCode(images)...)
		payload, _ := json.Marshal(map[string]any{
			"parts": parts,
		})
		resp, err := s.httpClient.Post(s.baseURL+"/session/"+sid+"/message", "application/json", bytes.NewReader(payload))
		var replyText string
		if err == nil {
			var res map[string]any
			if json.NewDecoder(resp.Body).Decode(&res) == nil {
				if t, ok := res["text"].(string); ok {
					replyText = t
				} else if parts, ok := res["parts"].([]any); ok {
					for _, p := range parts {
						if pm, ok := p.(map[string]any); ok {
							if t, ok := pm["text"].(string); ok {
								replyText += t
							}
						}
					}
				}
			}
			_ = resp.Body.Close()
		}

		s.mu.Lock()
		if replyText != "" {
			s.timeline = append(s.timeline, sdk.TimelineEntry{
				Seq:       len(s.timeline) + 1,
				TurnID:    s.activeTurnID,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Item: sdk.TimelineItem{
					Type: "assistant_message",
					Text: replyText,
				},
			})
		}
		s.status = "idle"
		s.activeTurnID = ""
		waiters := s.finishWaiters
		s.finishWaiters = nil
		for _, ch := range waiters {
			ch <- err
			close(ch)
		}
		endSubs := make([]func(map[string]any), 0, len(s.eventSubscribers))
		for _, fn := range s.eventSubscribers {
			endSubs = append(endSubs, fn)
		}
		s.mu.Unlock()

		for _, fn := range endSubs {
			if replyText != "" {
				fn(map[string]any{"type": "message_end"})
			}
			fn(map[string]any{"type": "agent_end"})
		}
	}()
	return nil
}

func (s *OpenCodeSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	return s.Prompt(ctx, message, images)
}

func (s *OpenCodeSession) Abort(_ context.Context) error {
	s.mu.Lock()
	sid := s.sessionID
	s.status = "idle"
	s.mu.Unlock()
	_, _ = s.httpClient.Post(s.baseURL+"/session/"+sid+"/abort", "application/json", bufio.NewReader(strings.NewReader("{}")))
	return nil
}

func (s *OpenCodeSession) WaitForFinish(ctx context.Context) error {
	s.mu.Lock()
	if s.status != "running" {
		s.mu.Unlock()
		return nil
	}
	ch := make(chan error, 1)
	s.finishWaiters = append(s.finishWaiters, ch)
	s.mu.Unlock()

	select {
	case err := <-ch:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *OpenCodeSession) GetState(_ context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdk.SessionState{
		SessionID:     s.sessionID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *OpenCodeSession) SetModel(_ context.Context, provider, modelID string) (*sdk.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *OpenCodeSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) GetCommands(_ context.Context) ([]sdk.SlashCommand, error) {
	return []sdk.SlashCommand{
		{Name: "compact", Description: "Compact session", Source: "builtin"},
	}, nil
}

func (s *OpenCodeSession) PendingPermissions() []map[string]any {
	return []map[string]any{}
}

func (s *OpenCodeSession) RespondToPermission(_ string, _ map[string]any) error {
	return nil
}

func (s *OpenCodeSession) ListSubagents(_ string) []sdk.SubagentDescriptor {
	return []sdk.SubagentDescriptor{}
}

func (s *OpenCodeSession) GetSubagent(_, _ string) (sdk.SubagentDescriptor, bool) {
	return sdk.SubagentDescriptor{}, false
}

func (s *OpenCodeSession) OnEvent(fn func(map[string]any)) func() {
	s.mu.Lock()
	id := s.nextSubID
	s.nextSubID++
	s.eventSubscribers[id] = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.eventSubscribers, id)
		s.mu.Unlock()
	}
}

func (s *OpenCodeSession) Close() error {
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return nil
}

// ConversationFSRewind reports what this provider can rewind.
//
// OpenCode's revert restores the conversation and the files the session changed, so both are true.
func (s *OpenCodeSession) RewindCapabilities() RewindCapabilities {
	return RewindCapabilities{Conversation: true, Files: true}
}

// Rewind reverts the conversation to a message.
//
// Ported from opencode/rewind.ts: `session.revert` with the message id. OpenCode keeps unrevert available only until a
// later prompt triggers its cleanup, which permanently drops the reverted messages, so there is nothing to undo here
// even if a caller asks.
func (s *OpenCodeSession) RewindConversation(ctx context.Context, messageID string) error {
	trimmed := strings.TrimSpace(messageID)
	if trimmed == "" {
		return errors.New("rewind needs a message id")
	}
	s.mu.Lock()
	sid := s.sessionID
	base := s.baseURL
	s.mu.Unlock()
	if sid == "" {
		return errors.New("rewind needs a session")
	}

	s.mu.Lock()
	directory := s.cwd
	s.mu.Unlock()
	body, err := json.Marshal(map[string]any{"messageID": trimmed, "directory": directory})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/session/"+sid+"/revert", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("opencode revert failed (%d): %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}

	// The reverted messages are gone, so the transcript the client holds is wrong until it is re-read.
	s.mu.Lock()
	s.status = "idle"
	s.mu.Unlock()
	return nil
}

// TreeEntryForMessage maps a message id to the provider's own reference.
//
// OpenCode addresses messages by id directly, so the mapping is the identity. The pi session needs a translation
// because its rewind goes through a tree whose entries are not message ids.
func (s *OpenCodeSession) TreeEntryForMessage(messageID string) (string, bool) {
	trimmed := strings.TrimSpace(messageID)
	return trimmed, trimmed != ""
}
