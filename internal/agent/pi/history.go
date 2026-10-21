package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ImportableSession describes a persisted Pi .jsonl session on disk.
type ImportableSession struct {
	ProviderHandleID   string  `json:"providerHandleId"`
	Cwd                string  `json:"cwd"`
	Title              *string `json:"title"`
	FirstPromptPreview *string `json:"firstPromptPreview"`
	LastPromptPreview  *string `json:"lastPromptPreview"`
	LastActivityAt     string  `json:"lastActivityAt"`
	Model              *string `json:"model,omitempty"`
	ThinkingOptionID   *string `json:"thinkingOptionId,omitempty"`
}

// HistoryOptions configures session directory discovery and filtering.
type HistoryOptions struct {
	// Since (RFC3339) drops sessions whose last activity predates it.
	Since      string
	SessionDir string
	Cwd        string
	Limit      int
}

// ResolveSessionsDir returns the Pi sessions directory (~/.pi/agent/sessions by default).
func ResolveSessionsDir(explicit string) string {
	if strings.TrimSpace(explicit) != "" {
		return explicit
	}
	if v := strings.TrimSpace(os.Getenv("PI_CODING_AGENT_SESSION_DIR")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("PI_CODING_AGENT_DIR")); v != "" {
		return filepath.Join(v, "sessions")
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(homeDir, ".pi", "agent", "sessions")
}

// ListImportableSessions scans the Pi sessions directory for .jsonl session files.
func ListImportableSessions(opts HistoryOptions) ([]ImportableSession, error) {
	root := ResolveSessionsDir(opts.SessionDir)
	if root == "" {
		return []ImportableSession{}, nil
	}
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return []ImportableSession{}, nil
	}

	type fileWithMtime struct {
		path  string
		mtime time.Time
	}
	var candidates []fileWithMtime
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if info, err := d.Info(); err == nil {
			candidates = append(candidates, fileWithMtime{path: p, mtime: info.ModTime()})
		}
		return nil
	})

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].mtime.After(candidates[j].mtime)
	})

	limit := opts.Limit
	if limit <= 0 {
		limit = 20
	}
	filterCwd := ""
	if strings.TrimSpace(opts.Cwd) != "" {
		if abs, err := filepath.Abs(opts.Cwd); err == nil {
			filterCwd = abs
		} else {
			filterCwd = opts.Cwd
		}
	}

	var sinceTime time.Time
	if strings.TrimSpace(opts.Since) != "" {
		if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(opts.Since)); err == nil {
			sinceTime = parsed
		}
	}

	out := make([]ImportableSession, 0, limit)
	for _, c := range candidates {
		if !sinceTime.IsZero() && c.mtime.Before(sinceTime) {
			continue
		}
		desc, err := ParseSessionFile(c.path, c.mtime)
		if err != nil || desc == nil {
			continue
		}
		if filterCwd != "" && desc.Cwd != filterCwd {
			continue
		}
		out = append(out, *desc)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// ParseSessionFile inspects a single Pi .jsonl file and extracts its ImportableSession metadata.
func ParseSessionFile(filePath string, fallbackMtime time.Time) (*ImportableSession, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)

	var (
		hasHeader   bool
		cwd         string
		title       *string
		firstPrompt *string
		lastPrompt  *string
		model       *string
		thinking    *string
		lastTS      string
	)

	lineIdx := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			if lineIdx == 0 {
				return nil, nil
			}
			continue
		}
		recType, _ := rec["type"].(string)
		if lineIdx == 0 {
			if recType != "session" {
				return nil, nil
			}
			id, _ := rec["id"].(string)
			c, _ := rec["cwd"].(string)
			if id == "" || c == "" {
				return nil, nil
			}
			hasHeader = true
			cwd = c
			if ts, _ := rec["timestamp"].(string); ts != "" {
				lastTS = ts
			}
			lineIdx++
			continue
		}
		lineIdx++

		if ts, _ := rec["timestamp"].(string); ts != "" {
			lastTS = ts
		}
		switch recType {
		case "session_info":
			if name, _ := rec["name"].(string); strings.TrimSpace(name) != "" {
				trimmed := strings.TrimSpace(name)
				title = &trimmed
			}
		case "model_change":
			prov, _ := rec["provider"].(string)
			modID, _ := rec["modelId"].(string)
			if prov != "" && modID != "" {
				combined := prov + "/" + modID
				model = &combined
			}
		case "thinking_level_change":
			if lvl, _ := rec["thinkingLevel"].(string); strings.TrimSpace(lvl) != "" {
				trimmed := strings.TrimSpace(lvl)
				thinking = &trimmed
			}
		case "message":
			msg, ok := rec["message"].(map[string]any)
			if !ok {
				continue
			}
			role, _ := msg["role"].(string)
			if role == "user" {
				if txt := extractUserContentText(msg["content"]); txt != "" {
					preview := truncatePreview(txt)
					if firstPrompt == nil {
						firstPrompt = &preview
					}
					lastPrompt = &preview
				}
			} else if role == "assistant" {
				prov, _ := msg["provider"].(string)
				modID, _ := msg["model"].(string)
				if prov != "" && modID != "" {
					combined := prov + "/" + modID
					model = &combined
				}
			}
		}
	}

	if !hasHeader {
		return nil, nil
	}
	if title == nil && firstPrompt != nil {
		title = firstPrompt
	}
	if lastPrompt == nil {
		lastPrompt = firstPrompt
	}
	if lastTS == "" {
		lastTS = fallbackMtime.UTC().Format(time.RFC3339Nano)
	}

	return &ImportableSession{
		ProviderHandleID:   filePath,
		Cwd:                cwd,
		Title:              title,
		FirstPromptPreview: firstPrompt,
		LastPromptPreview:  lastPrompt,
		LastActivityAt:     lastTS,
		Model:              model,
		ThinkingOptionID:   thinking,
	}, nil
}

// LoadTimelineFromJSONL reads a Pi .jsonl file and converts its persisted messages into TimelineEntries.
func LoadTimelineFromJSONL(filePath string) ([]TimelineEntry, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)

	var entries []TimelineEntry
	toolIndexByID := make(map[string]int)
	toolArgsByID := make(map[string]any)
	turnCounter := 0
	var currentTurnID string
	appendEntry := func(ts string, item TimelineItem) int {
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339Nano)
		}
		seq := len(entries) + 1
		entries = append(entries, TimelineEntry{
			Seq:       seq,
			TurnID:    currentTurnID,
			Timestamp: ts,
			Item:      item,
		})
		return len(entries) - 1
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		if rec["type"] != "message" {
			continue
		}
		rowID, _ := rec["id"].(string)
		ts, _ := rec["timestamp"].(string)
		msg, ok := rec["message"].(map[string]any)
		if !ok {
			continue
		}
		role, _ := msg["role"].(string)
		switch role {
		case "user":
			if txt := extractUserContentText(msg["content"]); txt != "" {
				// BySpace injects prompts on its own behalf (chat mentions, schedule fires,
				// finish notifications) wrapped in a system envelope. They are user messages
				// to the provider but not something the human said; showing them as user
				// bubbles makes the transcript lie about who asked.
				if sdk.IsSystemInjectedEnvelope(txt) {
					break
				}
				turnCounter++
				currentTurnID = fmt.Sprintf("turn_%d", turnCounter)
				appendEntry(ts, TimelineItem{
					Type:      "user_message",
					Text:      txt,
					MessageID: rowID,
				})
			}
		case "assistant":
			blocks, _ := msg["content"].([]any)
			for _, rawBlock := range blocks {
				block, ok := rawBlock.(map[string]any)
				if !ok {
					continue
				}
				bType, _ := block["type"].(string)
				switch bType {
				case "thinking":
					if th, _ := block["thinking"].(string); th != "" {
						appendEntry(ts, TimelineItem{
							Type: "reasoning",
							Text: th,
						})
					}
				case "text":
					if tx, _ := block["text"].(string); tx != "" {
						appendEntry(ts, TimelineItem{
							Type:      "assistant_message",
							Text:      leadingMagicTagRe.ReplaceAllString(tx, ""),
							MessageID: rowID,
						})
					}
				case "toolCall":
					callID, _ := block["id"].(string)
					name, _ := block["name"].(string)
					args := block["arguments"]
					if callID != "" {
						toolArgsByID[callID] = args
					}
					idx := appendEntry(ts, TimelineItem{
						Type:   "tool_call",
						CallID: callID,
						Name:   name,
						Status: "completed",
						Detail: BuildToolCallDetail(name, args, nil),
						Error:  nil,
					})
					if callID != "" {
						toolIndexByID[callID] = idx
					}
				}
			}
		case "toolResult":
			callID, _ := msg["toolCallId"].(string)
			toolName, _ := msg["toolName"].(string)
			isErr, _ := msg["isError"].(bool)
			if idx, ok := toolIndexByID[callID]; ok && idx >= 0 && idx < len(entries) {
				if toolName == "" {
					toolName = entries[idx].Item.Name
				}
				if isErr {
					entries[idx].Item.Status = "failed"
					entries[idx].Item.Error = extractResultText(msg)
				} else {
					entries[idx].Item.Status = "completed"
					entries[idx].Item.Error = nil
				}
				entries[idx].Item.Detail = BuildToolCallDetail(toolName, toolArgsByID[callID], msg)
			}
		}
	}
	return entries, nil
}

func extractUserContentText(content any) string {
	if s, ok := content.(string); ok {
		return strings.TrimSpace(s)
	}
	arr, ok := content.([]any)
	if !ok {
		return ""
	}
	var parts []string
	for _, raw := range arr {
		if m, ok := raw.(map[string]any); ok && m["type"] == "text" {
			if t, _ := m["text"].(string); strings.TrimSpace(t) != "" {
				parts = append(parts, strings.TrimSpace(t))
			}
		}
	}
	return strings.Join(parts, "\n\n")
}

func truncatePreview(s string) string {
	collapsed := strings.Join(strings.Fields(s), " ")
	if len(collapsed) > 160 {
		return collapsed[:160]
	}
	return collapsed
}
