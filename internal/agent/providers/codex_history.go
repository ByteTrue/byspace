package providers

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/proc"
)

func codexAppServerArgs(commandArgs []string) []string {
	return append(append([]string{}, commandArgs...), "app-server")
}

func probeCodexSession(ctx context.Context, command, cwd string, env []string) (*CodexSession, error) {
	return probeCodexSessionWithArgs(ctx, command, nil, cwd, env)
}

func probeCodexSessionWithArgs(ctx context.Context, command string, commandArgs []string, cwd string, env []string) (*CodexSession, error) {
	cmd := proc.Command(command, codexAppServerArgs(commandArgs)...)
	cmd.Dir = cwd
	cmd.Env = env
	pipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	s := &CodexSession{cmd: cmd, stdin: pipe, cwd: cwd, pending: make(map[int64]chan map[string]any), frames: sdk.NewStreamFrames(func() {})}
	go s.readLoop(out)
	go func() { _ = cmd.Wait() }()
	if _, err := s.rpcCall(ctx, "initialize", map[string]any{"clientInfo": map[string]any{"name": "byspace", "version": "0.0.0"}, "capabilities": map[string]any{"experimentalApi": true}}); err != nil {
		_ = s.Close()
		return nil, err
	}
	return s, nil
}

func ListCodexSessions(ctx context.Context, command, cwd string, env []string, limit int) ([]sdk.ImportableSession, error) {
	if limit <= 0 {
		limit = 50
	}
	s, err := probeCodexSession(ctx, command, cwd, env)
	if err != nil {
		return nil, err
	}
	defer s.Close()
	entries := make([]sdk.ImportableSession, 0, limit)
	seen, cursors := map[string]bool{}, map[string]bool{}
	cursor := ""
	for len(entries) < limit && len(seen) < 500 {
		params := map[string]any{"limit": 50, "sortKey": "updated_at"}
		if cwd != "" {
			params["cwd"] = cwd
		}
		if cursor != "" {
			params["cursor"] = cursor
		}
		response, err := s.rpcCall(ctx, "thread/list", params)
		if err != nil {
			return nil, err
		}
		rows, _ := response["data"].([]any)
		for _, raw := range rows {
			row, _ := raw.(map[string]any)
			id, _ := row["id"].(string)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			rowCwd, _ := row["cwd"].(string)
			if cwd != "" && rowCwd != "" && !sameProviderPath(cwd, rowCwd) {
				continue
			}
			preview, _ := row["preview"].(string)
			title, _ := row["name"].(string)
			if strings.TrimSpace(title) == "" {
				title = preview
			}
			var previewPtr *string
			if preview != "" {
				previewPtr = &preview
			}
			entries = append(entries, sdk.ImportableSession{Provider: "codex", ProviderLabel: "Codex", ProviderHandleID: id, Cwd: rowCwd, Title: title, FirstPromptPreview: previewPtr, LastPromptPreview: previewPtr, LastActivityAt: codexSessionTime(row)})
			if len(entries) >= limit {
				break
			}
		}
		next, _ := response["nextCursor"].(string)
		if next == "" || cursors[next] || len(rows) == 0 {
			break
		}
		cursors[next] = true
		cursor = next
	}
	return entries, nil
}

func sameProviderPath(a, b string) bool {
	ac, errA := filepath.Abs(a)
	bc, errB := filepath.Abs(b)
	if errA == nil && errB == nil {
		return strings.EqualFold(filepath.Clean(ac), filepath.Clean(bc))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func codexSessionTime(row map[string]any) string {
	seconds := 0.0
	for _, key := range []string{"updatedAt", "createdAt"} {
		if value, ok := row[key].(float64); ok && value > 0 {
			seconds = value
			break
		}
	}
	return time.Unix(int64(seconds), 0).UTC().Format(time.RFC3339Nano)
}

func (s *CodexSession) LoadNativeHistory(ctx context.Context) error {
	s.mu.Lock()
	threadID := s.threadID
	s.mu.Unlock()
	if threadID == "" {
		return fmt.Errorf("codex thread is not initialized")
	}
	response, err := s.rpcCall(ctx, "thread/read", map[string]any{"threadId": threadID, "includeTurns": true})
	if err != nil {
		return err
	}
	thread, _ := response["thread"].(map[string]any)
	turns, _ := thread["turns"].([]any)
	if len(turns) > 0 {
		for _, rawTurn := range turns {
			turn, _ := rawTurn.(map[string]any)
			if turnID, _ := turn["id"].(string); turnID != "" {
				s.mu.Lock()
				s.recordTurnIDLocked(turnID)
				s.mu.Unlock()
			}
			items, _ := turn["items"].([]any)
			for _, raw := range items {
				if item, _ := raw.(map[string]any); item != nil {
					s.completeCodexHistoryItem(item)
				}
			}
		}
		return nil
	}
	cursor := ""
	for {
		params := map[string]any{"threadId": threadID, "limit": 100, "sortDirection": "asc"}
		if cursor != "" {
			params["cursor"] = cursor
		}
		page, err := s.rpcCall(ctx, "thread/items/list", params)
		if err != nil {
			return err
		}
		rows, _ := page["data"].([]any)
		for _, raw := range rows {
			row, _ := raw.(map[string]any)
			if turnID, _ := row["turnId"].(string); turnID != "" {
				s.mu.Lock()
				s.recordTurnIDLocked(turnID)
				s.mu.Unlock()
			}
			if item, _ := row["item"].(map[string]any); item != nil {
				s.completeCodexHistoryItem(item)
			}
		}
		next, _ := page["nextCursor"].(string)
		if next == "" || next == cursor || len(rows) == 0 {
			return nil
		}
		cursor = next
	}
}

func (s *CodexSession) completeCodexHistoryItem(item map[string]any) {
	s.mu.Lock()
	events := s.completeCodexItemLocked(item)
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	s.deliverEvents(subs, events)
}
