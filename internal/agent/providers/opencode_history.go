package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func ListOpenCodeSessions(ctx context.Context, cfg LaunchConfig, command, cwd string, limit int) ([]sdk.ImportableSession, error) {
	if limit <= 0 {
		limit = 50
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENCODE_SERVER_URL")), "/")
	password := os.Getenv("OPENCODE_SERVER_PASSWORD")
	version := 0
	if strings.HasPrefix(command, "http://") || strings.HasPrefix(command, "https://") {
		baseURL, version = strings.TrimRight(command, "/"), 2
	}
	if baseURL == "" {
		server, err := sharedOpenCodePool(cfg.HomeDir, command, nil, openCodePoolEnv(cfg.Env)).Acquire(ctx)
		if err != nil {
			return nil, err
		}
		baseURL, version, password = server.URL, server.Version, server.Password
	}
	if version == 0 && strings.TrimSpace(os.Getenv("OPENCODE_SERVER_URL")) != "" {
		version = 2
	}
	if version == 0 {
		var err error
		version, err = probeOpenCodeBinaryVersion(ctx, command, nil, openCodePoolEnv(cfg.Env))
		if err != nil {
			return nil, err
		}
	}
	if version != 1 && version != 2 {
		return nil, fmt.Errorf("unsupported OpenCode protocol version %d", version)
	}
	client := newOpenCodeHTTPClient(password)
	entries := make([]sdk.ImportableSession, 0, limit)
	seen, cursors := map[string]bool{}, map[string]bool{}
	cursor := ""
	for len(entries) < limit && len(seen) < 500 {
		path := "/experimental/session"
		query := url.Values{"roots": {"true"}, "archived": {"true"}, "limit": {fmt.Sprint(min(limit, 50))}}
		if version == 2 {
			path = "/api/session"
			query = url.Values{"limit": {fmt.Sprint(min(limit, 50))}}
		}
		if cwd != "" && cursor == "" {
			query.Set("directory", cwd)
		}
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path+"?"+query.Encode(), nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		var payload any
		decodeErr := json.NewDecoder(resp.Body).Decode(&payload)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("opencode session list: %s", resp.Status)
		}
		if decodeErr != nil {
			return nil, decodeErr
		}
		rows, next := openCodeSessionListPage(payload)
		for _, raw := range rows {
			row, _ := raw.(map[string]any)
			id := openCodeString(row["id"])
			if id == "" || seen[id] || openCodeString(row["parentID"]) != "" {
				continue
			}
			seen[id] = true
			location, _ := row["location"].(map[string]any)
			rowCwd := openCodeString(row["directory"])
			if rowCwd == "" {
				rowCwd = openCodeString(location["directory"])
			}
			if cwd != "" && rowCwd != "" && !sameProviderPath(cwd, rowCwd) {
				continue
			}
			timing, _ := row["time"].(map[string]any)
			if openCodeSessionArchived(timing) {
				continue
			}
			title := strings.TrimSpace(openCodeString(row["title"]))
			entries = append(entries, sdk.ImportableSession{Provider: "opencode", ProviderLabel: "OpenCode", ProviderHandleID: id, Cwd: rowCwd, Title: title, LastActivityAt: openCodeSessionTime(timing)})
			if len(entries) >= limit {
				break
			}
		}
		if next == "" || cursors[next] || len(rows) == 0 {
			break
		}
		cursors[next] = true
		cursor = next
	}
	return entries, nil
}

func openCodeSessionListPage(payload any) ([]any, string) {
	if rows, ok := payload.([]any); ok {
		return rows, ""
	}
	object, _ := payload.(map[string]any)
	rows, _ := object["data"].([]any)
	if rows == nil {
		rows, _ = object["sessions"].([]any)
	}
	next := openCodeString(object["nextCursor"])
	if cursor, _ := object["cursor"].(map[string]any); cursor != nil {
		next = openCodeString(cursor["next"])
	}
	return rows, next
}

func openCodeSessionArchived(timing map[string]any) bool {
	switch value := timing["archived"].(type) {
	case float64:
		return value != 0
	case string:
		return value != "" && value != "0"
	case bool:
		return value
	default:
		return false
	}
}

func openCodeSessionTime(timing map[string]any) string {
	for _, key := range []string{"updated", "created"} {
		switch value := timing[key].(type) {
		case float64:
			return time.UnixMilli(int64(value)).UTC().Format(time.RFC3339Nano)
		case string:
			if value != "" {
				return value
			}
		}
	}
	return time.Unix(0, 0).UTC().Format(time.RFC3339Nano)
}

func (s *OpenCodeSession) appendOpenCodeImportedUser(messageID, text string) {
	if messageID == "" || text == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.timeline {
		item := &s.timeline[index].Item
		if item.Type == "user_message" && item.MessageID == messageID {
			return
		}
	}
	for index := range s.timeline {
		item := &s.timeline[index].Item
		if item.Type == "user_message" && item.Text == text && (item.MessageID == "" || item.MessageID == item.ClientMessageID) {
			item.MessageID = messageID
			return
		}
	}
	s.timeline = append(s.timeline, sdk.TimelineEntry{Seq: len(s.timeline) + 1, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: sdk.TimelineItem{Type: "user_message", MessageID: messageID, Text: text}})
}

func (s *OpenCodeSession) LoadNativeHistory(ctx context.Context) error {
	s.mu.Lock()
	sessionID := s.sessionID
	s.mu.Unlock()
	if sessionID == "" {
		return fmt.Errorf("opencode session is not initialized")
	}
	_, err := s.replayOpenCodeHistory(ctx, sessionID)
	return err
}
