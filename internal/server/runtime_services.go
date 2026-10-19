package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

type fileSubscription struct {
	id          string
	sink        frameSink
	cwd         string
	path        string
	lastVersion string
}

type diffSubscription struct {
	id         string
	sink       frameSink
	cwd        string
	compare    map[string]any
	lastDigest string
}

type tunnelRecord struct {
	PeerID    string `json:"peerId"`
	Name      string `json:"name"`
	LocalPort int    `json:"localPort"`
	Enabled   bool   `json:"enabled"`
	CreatedAt string `json:"createdAt"`
}

func isLoopbackAddr(remoteAddr string) bool {
	if remoteAddr == "" {
		return true
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) handleHTTPTerminalActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopbackAddr(r.RemoteAddr) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"Forbidden"}`))
		return
	}

	var body struct {
		TerminalID string `json:"terminalId"`
		Token      string `json:"token"`
		State      string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TerminalID == "" || body.Token == "" || body.State == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"Invalid terminal activity report"}`))
		return
	}

	s.mu.Lock()
	slot, ok := s.terminalSlotsByID[body.TerminalID]
	var sess = s.terminals[slot]
	s.mu.Unlock()

	if !ok || sess == nil || !sess.ValidateActivityToken(body.Token) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"Forbidden"}`))
		return
	}

	normState := "idle"
	if body.State == "running" || body.State == "working" {
		normState = "working"
	}
	if sess.SetActivity(normState) {
		s.broadcastTerminalsChanged(sess.Cwd, sess.WorkspaceID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleHTTPSubagentReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopbackAddr(r.RemoteAddr) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"Forbidden"}`))
		return
	}

	var body struct {
		Token        string           `json:"token"`
		Observations []map[string]any `json:"observations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" || len(body.Observations) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"Invalid subagent report"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) broadcastTerminalsChanged(cwd, workspaceID string) {
	nowMs := time.Now().UnixMilli()
	s.mu.Lock()
	list := make([]map[string]any, 0, len(s.terminals))
	for _, t := range s.terminals {
		if workspaceID != "" && t.WorkspaceID != "" && t.WorkspaceID != workspaceID {
			continue
		}
		list = append(list, map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"cwd":         t.Cwd,
			"workspaceId": t.WorkspaceID,
			"activity":    map[string]any{"state": t.Activity(), "changedAt": nowMs},
		})
	}
	s.mu.Unlock()

	payload := map[string]any{
		"terminals": list,
	}
	if cwd != "" {
		payload["cwd"] = cwd
	}
	s.broadcastSessionMsg("terminals_changed", payload)
}

// RegisterFileSubscription registers a live file watcher subscription for fs.file.update notifications.
func (s *Server) RegisterFileSubscription(subID string, sink frameSink, cwd, relPath, initialVersion string) {
	if subID == "" {
		return
	}
	s.mu.Lock()
	if s.fileSubs == nil {
		s.fileSubs = make(map[string]fileSubscription)
	}
	s.fileSubs[subID] = fileSubscription{
		id:          subID,
		sink:        sink,
		cwd:         cwd,
		path:        relPath,
		lastVersion: initialVersion,
	}
	s.mu.Unlock()
}

// UnregisterFileSubscription removes a file watcher subscription.
func (s *Server) UnregisterFileSubscription(subID string) {
	s.mu.Lock()
	delete(s.fileSubs, subID)
	s.mu.Unlock()
}

// RegisterDiffSubscription registers a live git working diff subscription for checkout_diff_update notifications.
func (s *Server) RegisterDiffSubscription(subID string, sink frameSink, cwd string, compare map[string]any, files []workspace.ParsedDiffFile) {
	if subID == "" {
		return
	}
	b, _ := json.Marshal(files)
	sum := sha256.Sum256(b)
	s.mu.Lock()
	if s.diffSubs == nil {
		s.diffSubs = make(map[string]diffSubscription)
	}
	s.diffSubs[subID] = diffSubscription{
		id:         subID,
		sink:       sink,
		cwd:        cwd,
		compare:    compare,
		lastDigest: hex.EncodeToString(sum[:]),
	}
	s.mu.Unlock()
}

// UnregisterDiffSubscription removes a git diff subscription.
func (s *Server) UnregisterDiffSubscription(subID string) {
	s.mu.Lock()
	delete(s.diffSubs, subID)
	s.mu.Unlock()
}

// PollSubscriptionsOnce checks active file and git diff subscriptions and pushes updates when changed.
func (s *Server) PollSubscriptionsOnce(ctx context.Context) {
	s.mu.Lock()
	fSubs := make([]fileSubscription, 0, len(s.fileSubs))
	for _, fs := range s.fileSubs {
		if s.clients[fs.sink] {
			fSubs = append(fSubs, fs)
		} else {
			delete(s.fileSubs, fs.id)
		}
	}
	dSubs := make([]diffSubscription, 0, len(s.diffSubs))
	for _, ds := range s.diffSubs {
		if s.clients[ds.sink] {
			dSubs = append(dSubs, ds)
		} else {
			delete(s.diffSubs, ds.id)
		}
	}
	s.mu.Unlock()

	for _, fs := range fSubs {
		fc, err := workspace.ReadFile(fs.cwd, fs.path)
		if err != nil || fc.Revision == fs.lastVersion {
			continue
		}
		s.mu.Lock()
		if cur, ok := s.fileSubs[fs.id]; ok {
			cur.lastVersion = fc.Revision
			s.fileSubs[fs.id] = cur
		}
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, fs.sink, "fs.file.update", map[string]any{
			"subscriptionId": fs.id,
			"version":        fc.Revision,
		})
	}

	for _, ds := range dSubs {
		files, err := workspace.GetWorkingDiff(ctx, ds.cwd)
		if err != nil {
			continue
		}
		b, _ := json.Marshal(files)
		sum := sha256.Sum256(b)
		digest := hex.EncodeToString(sum[:])
		if digest == ds.lastDigest {
			continue
		}
		s.mu.Lock()
		if cur, ok := s.diffSubs[ds.id]; ok {
			cur.lastDigest = digest
			s.diffSubs[ds.id] = cur
		}
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, ds.sink, "checkout_diff_update", map[string]any{
			"subscriptionId": ds.id,
			"cwd":            ds.cwd,
			"compare":        ds.compare,
			"files":          files,
			"error":          nil,
		})
	}
}

// ReconcileSkills syncs bundled skills into target agent skill directories (~/.agents/skills, ~/.claude/skills).
func ReconcileSkills(selection map[string]any, targets []string, uninstallAll bool) (string, []map[string]any, []string, []string) {
	if len(targets) == 0 {
		targets = []string{"agents", "claude"}
	}
	avail, _ := scanLocalSkills()
	userHome, err := os.UserHomeDir()
	if err != nil {
		return "up-to-date", []map[string]any{}, avail, []string{}
	}

	targetDirs := make(map[string]string)
	for _, t := range targets {
		switch t {
		case "agents":
			targetDirs["agents"] = filepath.Join(userHome, ".agents", "skills")
		case "claude":
			targetDirs["claude"] = filepath.Join(userHome, ".claude", "skills")
		}
	}

	desired := make(map[string]bool)
	if !uninstallAll {
		mode, _ := selection["mode"].(string)
		if mode == "custom" {
			if rawSkills, ok := selection["skills"].([]any); ok {
				for _, rs := range rawSkills {
					if name, ok := rs.(string); ok {
						desired[name] = true
					}
				}
			}
		} else {
			for _, name := range avail {
				desired[name] = true
			}
		}
	}

	var srcRoot string
	if wd, err := os.Getwd(); err == nil {
		cand := filepath.Join(wd, "skills")
		if info, statErr := os.Stat(cand); statErr == nil && info.IsDir() {
			srcRoot = cand
		}
	}

	ops := make([]map[string]any, 0)
	installedSet := make(map[string]bool)

	for _, name := range avail {
		if desired[name] {
			installedSet[name] = true
			if srcRoot != "" {
				srcSkill := filepath.Join(srcRoot, name)
				for _, dstBase := range targetDirs {
					_ = copySkillDir(srcSkill, filepath.Join(dstBase, name))
				}
			}
		}
	}

	installed := make([]string, 0, len(installedSet))
	for k := range installedSet {
		installed = append(installed, k)
	}
	sort.Strings(installed)
	state := "up-to-date"
	if len(installed) == 0 && len(avail) > 0 && uninstallAll {
		state = "not-installed"
	}
	return state, ops, avail, installed
}

func copySkillDir(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		srcPath := filepath.Join(srcDir, e.Name())
		dstPath := filepath.Join(dstDir, e.Name())
		if e.IsDir() {
			_ = copySkillDir(srcPath, dstPath)
			continue
		}
		f, err := os.Open(srcPath)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(f)
		_ = f.Close()
		_ = home.WriteAtomic(dstPath, b, 0o644)
	}
	return nil
}

// RenderASCIIQRCode renders a compact UTF-8 half-block deterministic QR-style matrix for terminal pairing.
func RenderASCIIQRCode(data string) string {
	sum := sha256.Sum256([]byte(data))
	const size = 21
	grid := make([][]bool, size+2)
	for r := range grid {
		grid[r] = make([]bool, size+2)
	}

	drawFinder := func(r0, c0 int) {
		for r := 0; r < 7; r++ {
			for c := 0; c < 7; c++ {
				if r == 0 || r == 6 || c == 0 || c == 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
					grid[r0+r+1][c0+c+1] = true
				}
			}
		}
	}
	drawFinder(0, 0)
	drawFinder(0, size-7)
	drawFinder(size-7, 0)

	bitIdx := 0
	for r := 0; r < size; r++ {
		for c := 0; c < size; c++ {
			if (r < 8 && c < 8) || (r < 8 && c >= size-8) || (r >= size-8 && c < 8) {
				continue
			}
			bytePos := (bitIdx / 8) % len(sum)
			bitPos := uint(bitIdx % 8)
			grid[r+1][c+1] = ((sum[bytePos] >> bitPos) & 1) == 1
			bitIdx++
		}
	}

	var sb strings.Builder
	for r := 0; r < len(grid); r += 2 {
		for c := 0; c < len(grid[0]); c++ {
			top := grid[r][c]
			bot := false
			if r+1 < len(grid) {
				bot = grid[r+1][c]
			}
			switch {
			case top && bot:
				sb.WriteString("█")
			case top && !bot:
				sb.WriteString("▀")
			case !top && bot:
				sb.WriteString("▄")
			default:
				sb.WriteString(" ")
			}
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

// FilterAndSortAgents applies searchQuery, status/provider/workspaceId/labels filtering, sorting, and cursor pagination.
func FilterAndSortAgents(records []store.AgentRecord, searchQuery string, filter map[string]any, sortField string, limit int, cursor string) ([]store.AgentRecord, bool, *string) {
	q := strings.ToLower(strings.TrimSpace(searchQuery))
	var wsFilter, provFilter, statusFilter string
	if filter != nil {
		wsFilter, _ = filter["workspaceId"].(string)
		provFilter, _ = filter["provider"].(string)
		statusFilter, _ = filter["status"].(string)
	}

	filtered := make([]store.AgentRecord, 0, len(records))
	for _, r := range records {
		if wsFilter != "" && r.WorkspaceID != wsFilter {
			continue
		}
		if provFilter != "" && r.Provider != provFilter {
			continue
		}
		if statusFilter != "" && r.LastStatus != statusFilter {
			continue
		}
		if q != "" {
			title := ""
			if r.Title != nil {
				title = strings.ToLower(*r.Title)
			}
			if !strings.Contains(title, q) && !strings.Contains(strings.ToLower(r.Cwd), q) && !strings.Contains(strings.ToLower(r.ID), q) {
				continue
			}
		}
		filtered = append(filtered, r)
	}

	switch sortField {
	case "created_at":
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].CreatedAt > filtered[j].CreatedAt })
	case "title":
		sort.Slice(filtered, func(i, j int) bool {
			var ti, tj string
			if filtered[i].Title != nil {
				ti = *filtered[i].Title
			}
			if filtered[j].Title != nil {
				tj = *filtered[j].Title
			}
			return ti < tj
		})
	default:
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].UpdatedAt > filtered[j].UpdatedAt })
	}

	startIdx := 0
	if cursor != "" {
		if n, err := strconv.Atoi(cursor); err == nil && n >= 0 && n < len(filtered) {
			startIdx = n
		}
	}
	if startIdx > 0 {
		filtered = filtered[startIdx:]
	}
	hasMore := false
	var nextCursor *string
	if limit > 0 && len(filtered) > limit {
		hasMore = true
		nc := fmt.Sprintf("%d", startIdx+limit)
		nextCursor = &nc
		filtered = filtered[:limit]
	}
	return filtered, hasMore, nextCursor
}
