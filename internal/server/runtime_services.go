package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ByteTrue/byspace/internal/terminal"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/skip2/go-qrcode"

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
			// attentionReason distinguishes "just finished" from "idle all along", which is what
			// the sidebar's rollup shows. Nullable: absent means nothing to show.
			"activity": map[string]any{
				"state":           t.Activity(),
				"attentionReason": nullableReason(t.AttentionReason()),
				"changedAt":       nowMs,
			},
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
	// Written on every membership change: the tabs that existed when the process died are what
	// the user expects to find when the daemon comes back.
	s.persistTerminalSessions()
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

// RenderASCIIQRCode renders a scannable QR code as UTF-8 half blocks, mirroring
// packages/server/src/server/pairing-qr.ts (which uses the `qrcode` npm package with
// type:"utf8", margin:4). Both produce the same kind of terminal-artifact: a real QR
// matrix, not a decorative pattern.
func RenderASCIIQRCode(data string) (string, error) {
	qr, err := qrcode.New(data, qrcode.Medium)
	if err != nil {
		return "", err
	}
	qr.DisableBorder = false
	// Bitmap() includes the quiet zone; pair rows into half blocks so the output stays
	// roughly square in a terminal (two vertical pixels per character cell).
	grid := qr.Bitmap()
	const margin = 4
	rows := make([][]bool, 0, len(grid)+margin*2)
	for i := 0; i < margin; i++ {
		rows = append(rows, make([]bool, len(grid[0])+margin*2))
	}
	for _, row := range grid {
		padded := make([]bool, len(row)+margin*2)
		copy(padded[margin:], row)
		rows = append(rows, padded)
	}
	for i := 0; i < margin; i++ {
		rows = append(rows, make([]bool, len(grid[0])+margin*2))
	}

	var sb strings.Builder
	for r := 0; r < len(rows); r += 2 {
		for c := 0; c < len(rows[0]); c++ {
			top := rows[r][c]
			bottom := false
			if r+1 < len(rows) {
				bottom = rows[r+1][c]
			}
			switch {
			case top && bottom:
				sb.WriteString("█")
			case top:
				sb.WriteString("▀")
			case bottom:
				sb.WriteString("▄")
			default:
				sb.WriteString(" ")
			}
		}
		sb.WriteString("\n")
	}
	return sb.String(), nil
}

// FilterAndSortAgents applies searchQuery, status/provider/workspaceId/labels filtering, sorting, and cursor pagination.
func (s *Server) filterAndSortAgents(records []store.AgentRecord, searchQuery string, filter map[string]any, sortField string, limit int, cursor string) ([]store.AgentRecord, bool, *string) {
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
		filtered = append(filtered, r)
	}

	// Ranked search over the four names a session carries (workspace, title, branch, project),
	// replacing a plain substring test: containment cannot answer "stripe main" across two
	// different fields, and gives no relevance order to merge several hosts' pages by.
	if q != "" {
		filtered = rankAgentsBySearch(filtered, q, func(rec store.AgentRecord) map[string]any {
			return s.buildProjectPlacementForRecord(rec)
		})
	}

	// The sort specification is part of the cursor contract; normalize it once so the encoder
	// and the comparator cannot disagree.
	effectiveSort := sortField
	if effectiveSort != "created_at" && effectiveSort != "title" {
		effectiveSort = "last_activity_at"
	}
	effectiveDirection := "desc"
	if effectiveSort == "title" {
		effectiveDirection = "asc"
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

	// The cursor names the sort key and the row it belongs to, so the next page continues from
	// that row. An offset would shift whenever an agent finishes or a new one appears between
	// fetches, which shows a duplicate and hides whatever fell into the gap.
	sortSpec := []cursorSort{{Key: effectiveSort, Direction: effectiveDirection}}
	keyOf := agentSortValue(effectiveSort)

	startIdx := 0
	if cursor != "" {
		decoded, err := decodeCursor(cursor, sortSpec)
		if err != nil {
			return []store.AgentRecord{}, false, nil
		}
		for i, rec := range filtered {
			cmp := compareCursorValue(keyOf(rec), decoded.Values[effectiveSort], effectiveDirection)
			if cmp < 0 || (cmp == 0 && rec.ID <= decoded.ID) {
				continue
			}
			startIdx = i
			break
		}
		if startIdx == 0 {
			// The cursor row is no longer present (deleted, or filtered out): fall back to a
			// scan for anything sorting after it rather than silently restarting at the top.
			startIdx = len(filtered)
			for i, rec := range filtered {
				cmp := compareCursorValue(keyOf(rec), decoded.Values[effectiveSort], effectiveDirection)
				if cmp > 0 || (cmp == 0 && rec.ID > decoded.ID) {
					startIdx = i
					break
				}
			}
		}
	}
	if startIdx > 0 {
		filtered = filtered[startIdx:]
	}

	hasMore := false
	var nextCursor *string
	if limit > 0 && len(filtered) > limit {
		hasMore = true
		last := filtered[limit-1]
		nc := encodeCursor(last.ID, map[string]any{effectiveSort: keyOf(last)}, sortSpec)
		nextCursor = &nc
		filtered = filtered[:limit]
	}
	return filtered, hasMore, nextCursor
}

// agentSortValue reads the value a sort key compares on.
func agentSortValue(key string) func(store.AgentRecord) any {
	switch key {
	case "created_at":
		return func(rec store.AgentRecord) any { return rec.CreatedAt }
	case "title":
		return func(rec store.AgentRecord) any {
			if rec.Title == nil {
				return nil
			}
			return *rec.Title
		}
	default:
		return func(rec store.AgentRecord) any { return lastActivityOf(rec) }
	}
}

// providerSnapshotTag returns a stable ETag-style tag for the current provider snapshot,
// so clients can skip re-downloading an unchanged catalog via `ifNoneMatch`.
func (s *Server) providerSnapshotTag() string {
	s.mu.Lock()
	models := len(s.cachedPiModels)
	s.mu.Unlock()
	h := sha256.Sum256([]byte(s.serverID + "|" + fmt.Sprint(models) + "|" + s.version))
	return "wp_" + hex.EncodeToString(h[:8])
}

// subscriptionPollInterval is how often file and git-diff subscriptions are re-checked.
//
// The node daemon uses filesystem watchers with a 150ms debounce, which is more responsive but
// needs a native watcher per platform. Polling a cheap fingerprint keeps the behaviour without
// that dependency; 1s is well under human perception for "the file I just changed".
const subscriptionPollInterval = time.Second

// startSubscriptionPoller runs PollSubscriptionsOnce until the server closes.
func (s *Server) startSubscriptionPoller() {
	go func() {
		ticker := time.NewTicker(subscriptionPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				s.PollSubscriptionsOnce(ctx)
				cancel()
			}
		}
	}()
	s.startWorkspacePlacementPoller()
}

// workspacePlacementInterval is how often git facts are re-read for every live workspace.
// The node daemon uses five minutes: frequent enough that a branch switched in a terminal shows
// up, rare enough that a large workspace list is not spawning git processes constantly.
const workspacePlacementInterval = 5 * time.Minute

// startWorkspacePlacementPoller re-derives each workspace's kind/branch from disk on a timer.
//
// Git facts belong to the checkout, not to the record. Without this, switching branches outside
// the app leaves the sidebar showing the old branch until a full page reload, and a directory
// that became a repository stays classified as a plain directory forever.
func (s *Server) startWorkspacePlacementPoller() {
	go func() {
		ticker := time.NewTicker(workspacePlacementInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				s.reconcileAllWorkspacePlacements(ctx)
				cancel()
				// Checking for merged PRs rides the same slow tick: a forge call per workspace
				// per minute would be abusive, and the user does not need archiving to happen
				// faster than the sidebar refresh.
				if s.autoArchiveEnabled() {
					actx, acancel := context.WithTimeout(context.Background(), 120*time.Second)
					s.runAutoArchivePass(actx)
					acancel()
				}
			}
		}
	}()
}

// persistTerminalSessions writes the tab list so a restart can recreate it.
//
// Only metadata: a shell process cannot be brought back, and restoring a previous run's pid would
// attach the UI to a process that is not there.
func (s *Server) persistTerminalSessions() {
	s.mu.Lock()
	sessions := make([]terminal.PersistedTerminalSession, 0, len(s.terminals))
	for _, t := range s.terminals {
		sessions = append(sessions, terminal.PersistedTerminalSession{
			ID:          t.ID,
			Cwd:         t.Cwd,
			WorkspaceID: t.WorkspaceID,
			Name:        t.Name,
		})
	}
	s.mu.Unlock()
	_ = terminal.SavePersistedTerminals(s.homeDir, sessions)
}

// nullableReason renders an absent attention reason as null.
//
// The protocol field is nullable and the client reads null as "nothing to show"; an empty string
// would render an empty badge.
func nullableReason(reason string) any {
	if strings.TrimSpace(reason) == "" {
		return nil
	}
	return reason
}
