package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
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
	timeline         []pi.TimelineEntry
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

func (s *OpenCodeSession) Timeline() []pi.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]pi.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *OpenCodeSession) SeedTimeline(entries []pi.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]pi.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *OpenCodeSession) SetNextClientMessageID(_ string) {}

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

func (s *OpenCodeSession) Prompt(_ context.Context, message string, _ []pi.ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.timeline = append(s.timeline, pi.TimelineEntry{
		Seq:       len(s.timeline) + 1,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item: pi.TimelineItem{
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
		payload, _ := json.Marshal(map[string]any{
			"parts": []map[string]any{
				{"type": "text", "text": message},
			},
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
			s.timeline = append(s.timeline, pi.TimelineEntry{
				Seq:       len(s.timeline) + 1,
				TurnID:    s.activeTurnID,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Item: pi.TimelineItem{
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

func (s *OpenCodeSession) Steer(ctx context.Context, message string, images []pi.ImageContent) error {
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

func (s *OpenCodeSession) GetState(_ context.Context) (*pi.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &pi.SessionState{
		SessionID:     s.sessionID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *OpenCodeSession) SetModel(_ context.Context, provider, modelID string) (*pi.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &pi.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *OpenCodeSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) GetCommands(_ context.Context) ([]pi.SlashCommand, error) {
	return []pi.SlashCommand{
		{Name: "compact", Description: "Compact session", Source: "builtin"},
	}, nil
}

func (s *OpenCodeSession) PendingPermissions() []map[string]any {
	return []map[string]any{}
}

func (s *OpenCodeSession) RespondToPermission(_ string, _ map[string]any) error {
	return nil
}

func (s *OpenCodeSession) ListSubagents(_ string) []pi.SubagentDescriptor {
	return []pi.SubagentDescriptor{}
}

func (s *OpenCodeSession) GetSubagent(_, _ string) (pi.SubagentDescriptor, bool) {
	return pi.SubagentDescriptor{}, false
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
