package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// newOpenCodeV2Session creates the v2 session before starting its event stream. The transport
// stays on the shared session structure so lifecycle, timeline and snapshot behavior remain common.
func newOpenCodeV2Session(cfg LaunchConfig, baseURL, password string) (*OpenCodeSession, error) {
	client := newOpenCodeHTTPClient(password)
	s := &OpenCodeSession{
		baseURL:          strings.TrimRight(baseURL, "/"),
		version:          2,
		httpClient:       client,
		streamHTTPClient: newOpenCodeStreamHTTPClient(password),
		status:           "idle",
		cwd:              cfg.Cwd,
		model:            cfg.Model,
		modelProvider:    cfg.ModelProvider,
		modeID:           cfg.ModeID,
		thinking:         cfg.ThinkingOptionID,
		sessionID:        cfg.SessionHandle,
		eventSubscribers: make(map[int]func(map[string]any)),
		partTypes:        make(map[string]string), messageRoles: make(map[string]string),
		materializedText: make(map[string]string), closedParts: make(map[string]bool),
		toolIndexByID: make(map[string]int), pendingPermissions: make(map[string]map[string]any),
		systemPrompt: cfg.SystemPrompt, mcpServers: cfg.MCPServers, eventTimelineIndex: -1,
	}
	if s.sessionID != "" {
		if err := s.configureV2(context.Background()); err != nil {
			return nil, err
		}
		s.startEventStream()
		return s, nil
	}
	body, _ := json.Marshal(map[string]any{"location": map[string]any{"directory": cfg.Cwd}})
	endpoint := s.baseURL + "/api/session?directory=" + url.QueryEscape(cfg.Cwd)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("opencode v2 create session: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("opencode v2 create session: %s: %s", resp.Status, strings.TrimSpace(string(message)))
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("opencode v2 create session: %w", err)
	}
	if data, ok := result["data"].(map[string]any); ok {
		result = data
	}
	id, _ := result["id"].(string)
	if id == "" {
		return nil, fmt.Errorf("opencode v2 create session: response has no id")
	}
	s.sessionID = id
	if err := s.configureV2(context.Background()); err != nil {
		return nil, err
	}
	s.startEventStream()
	return s, nil
}
