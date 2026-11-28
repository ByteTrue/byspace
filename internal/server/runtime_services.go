package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	diffframes "github.com/ByteTrue/byspace/internal/diff"
	"github.com/ByteTrue/byspace/internal/gitdiff"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

type fileSubscription struct {
	id          string
	sink        frameSink
	cwd         string
	path        string
	lastVersion string
	// stamp is the file's mtime+size at the last poll. Reading a file to compute its revision
	// once a second is affordable for a source file and ruinous for a 10 MB log; the stamp is a
	// stat, and only a change in it is worth a read.
	stamp string
}

type diffSubscription struct {
	id      string
	sink    frameSink
	cwd     string
	compare map[string]any
	// sub is the engine subscription behind this pane. The engine, not this poller, decides when
	// a comparison changed: it reads only the files whose identity moved.
	sub *gitdiff.Subscription
	// generation rejects callbacks from a subscription replaced under the same client ID.
	generation uint64
	// delivered is the last revision this pane received. A body is sent only when the file changed
	// since that revision; the client keeps the rest.
	delivered uint64
}

// diffKey maps a client comparison onto the engine key. Two panes on the same checkout and the
// same comparison share one computation.
func diffKey(cwd string, compare map[string]any) gitdiff.Key {
	mode, _ := compare["mode"].(string)
	baseRef, _ := compare["baseRef"].(string)
	ignoreWhitespace, _ := compare["ignoreWhitespace"].(bool)
	return gitdiff.Key{
		Cwd:              workspace.CanonicalCwd(cwd),
		Base:             baseRef,
		Committed:        strings.TrimSpace(mode) == "base",
		IgnoreWhitespace: ignoreWhitespace,
	}
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
	switch body.State {
	case "running", "working":
		normState = "working"
	case "attention", "needs-input":
		normState = "attention"
	}
	if sess.SetActivity(normState) {
		s.broadcastTerminalsChanged(sess.Cwd, sess.WorkspaceID)
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
		entry := map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"cwd":         t.Cwd,
			"workspaceId": t.WorkspaceID,
			// attentionReason distinguishes "just finished" from "idle all along", which is what
			// the sidebar's rollup shows. Nullable: absent means nothing to show.
			"activity": terminalActivityPayload(t, nowMs),
		}
		if t.Title != "" {
			entry["title"] = t.Title
		}
		list = append(list, entry)
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

// fileStamp returns the poll key for a path, or "" when the path is not a file.
//
// The subscription starts from this value rather than from empty: the poll reports a deletion only
// when the previous stamp was non-empty, so an empty start made the first disappearance look like
// "already reported" and closed panes never learned the file had gone.
func fileStamp(cwd, relPath string) string {
	info, err := os.Stat(filepath.Join(cwd, relPath))
	if err != nil || info.IsDir() {
		return ""
	}
	return fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
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
		stamp:       fileStamp(cwd, relPath),
	}
	s.mu.Unlock()
}

// UnregisterFileSubscription removes a file watcher subscription.
func (s *Server) UnregisterFileSubscription(subID string) {
	s.mu.Lock()
	delete(s.fileSubs, subID)
	s.mu.Unlock()
}

// RegisterDiffSubscription registers a live git comparison subscription for checkout_diff_update
// notifications. The pane's first answer travels in the subscription response; the engine delivers
// every later revision of that comparison.
func (s *Server) RegisterDiffSubscription(subID string, sink frameSink, cwd string, compare map[string]any) {
	if subID == "" {
		return
	}
	key := diffKey(cwd, compare)
	// The entry is installed before subscribing: a shared comparison replays its committed result
	// from inside Subscribe, and a delivery that found no entry would be dropped.
	deliveryMu := s.diffDeliveryLock(subID)
	deliveryMu.Lock()
	s.mu.Lock()
	if s.diffSubs == nil {
		s.diffSubs = make(map[string]diffSubscription)
	}
	previous := s.diffSubs[subID]
	s.diffGeneration++
	generation := s.diffGeneration
	s.diffSubs[subID] = diffSubscription{id: subID, sink: sink, cwd: cwd, compare: compare, generation: generation}
	if s.diffSent == nil {
		s.diffSent = make(map[string]map[string]uint64)
	}
	s.diffSent[subID] = make(map[string]uint64)
	s.mu.Unlock()
	deliveryMu.Unlock()

	sub := s.diffEngine.Subscribe(key, func(res gitdiff.Result) {
		s.deliverDiffUpdate(subID, sink, cwd, compare, key, generation, res)
	})

	s.mu.Lock()
	installed := false
	if cur, ok := s.diffSubs[subID]; ok && cur.sink == sink && cur.generation == generation {
		cur.sub = sub
		s.diffSubs[subID] = cur
		installed = true
	}
	s.mu.Unlock()
	if !installed {
		// Unregistered while the subscription was being created.
		sub.Unsubscribe()
	}
	if previous.sub != nil {
		previous.sub.Unsubscribe()
	}
}

// UnregisterDiffSubscription removes a git diff subscription.
func (s *Server) UnregisterDiffSubscription(subID string) {
	deliveryMu := s.diffDeliveryLock(subID)
	deliveryMu.Lock()
	s.mu.Lock()
	ds, ok := s.diffSubs[subID]
	delete(s.diffSubs, subID)
	delete(s.diffSent, subID)
	s.mu.Unlock()
	deliveryMu.Unlock()
	// Released outside the lock: releasing the last subscriber closes the comparison, and the
	// engine delivers nothing to a pane that is gone.
	if ok && ds.sub != nil {
		ds.sub.Unsubscribe()
	}
}

// deliverDiffUpdate pushes one revision of a comparison to one pane. Every revision travels as
// binary Begin/Bodies/End frames whose Bodies carry only the files this pane has not seen at the
// current revision; the client keeps the rest of the previous revision.
func (s *Server) diffDeliveryLock(subID string) *sync.Mutex {
	sum := sha256.Sum256([]byte(subID))
	return &s.diffDeliveryLocks[sum[0]]
}

func (s *Server) deliverDiffUpdate(subID string, sink frameSink, cwd string, compare map[string]any, key gitdiff.Key, generation uint64, res gitdiff.Result) {
	deliveryMu := s.diffDeliveryLock(subID)
	deliveryMu.Lock()
	defer deliveryMu.Unlock()
	s.mu.Lock()
	ds, ok := s.diffSubs[subID]
	if !ok || ds.sink != sink || ds.generation != generation || ds.delivered >= res.Revision {
		s.mu.Unlock()
		return
	}
	ds.delivered = res.Revision
	s.diffSubs[subID] = ds
	sent := s.diffSent[subID]
	s.mu.Unlock()

	var diffErr *diffframes.Error
	if res.Err != nil {
		diffErr = &diffframes.Error{Code: "UNKNOWN", Message: res.Err.Error()}
	}
	// The engine names the files whose identity moved. Everything else keeps the body this pane
	// already has; comparing revision numbers instead would resend every file on every edit.
	moved := make(map[string]bool, len(res.Changed))
	for _, path := range res.Changed {
		moved[path] = true
	}
	entries := make([]string, 0, len(res.Files))
	present := make(map[string]bool, len(res.Files))
	var changed []workspace.ParsedDiffFile
	for _, file := range res.Files {
		entries = append(entries, file.Path)
		present[file.Path] = true
		_, seen := sent[file.Path]
		if !seen || moved[file.Path] {
			changed = append(changed, file)
		}
	}
	begin, err := diffframes.EncodeBegin(subID, diffframes.BeginHeader{
		Revision: res.Revision,
		Cwd:      cwd,
		Compare:  compare,
		Resolved: diffframes.Resolved{
			BaseSha:      res.Resolved.BaseSha,
			HeadSha:      res.Resolved.HeadSha,
			MergeBaseSha: res.Resolved.MergeBaseSha,
		},
		Entries: entries,
		Error:   diffErr,
	})
	if err != nil {
		return
	}
	bodies, err := diffframes.EncodeBodies(subID, changed)
	if err != nil {
		return
	}
	end, err := diffframes.EncodeEnd(subID, diffframes.EndTrailer{
		Revision:     res.Revision,
		Omitted:      res.Omitted,
		DiffTooLarge: res.DiffTooLarge,
		Error:        diffErr,
	})
	if err != nil {
		return
	}
	ctx := context.Background()
	for _, frame := range [][]byte{begin, bodies, end} {
		if err := sink.SendBinary(ctx, frame); err != nil {
			return
		}
	}
	s.mu.Lock()
	if current := s.diffSent[subID]; current != nil {
		for path := range current {
			if !present[path] {
				delete(current, path)
			}
		}
		for _, file := range changed {
			current[file.Path] = res.Revision
		}
	}
	s.mu.Unlock()
	s.refreshDiffCheckoutFacts(key, res.Revision)
}

// refreshDiffCheckoutFacts keeps the facts derived from the same comparison honest when it moves:
// the checkout's dirty/branch push and the composer's diff stat. One revision is refreshed once,
// however many panes share it.
func (s *Server) refreshDiffCheckoutFacts(key gitdiff.Key, revision uint64) {
	s.mu.Lock()
	if s.diffRefreshed == nil {
		s.diffRefreshed = make(map[gitdiff.Key]uint64)
	}
	if s.diffRefreshed[key] >= revision {
		s.mu.Unlock()
		return
	}
	s.diffRefreshed[key] = revision
	s.mu.Unlock()
	ctx := context.Background()
	s.broadcastCheckoutStatusIfChanged(ctx, key.Cwd)
	// The composer's diff pill reads the workspace descriptor, and the descriptor is only pushed
	// when something re-sends the workspace. Watching the checkout is exactly the moment the user
	// is editing files, so it is where the stat has to be kept honest.
	s.refreshCheckoutDiffStat(ctx, key.Cwd)
}

// PollSubscriptionsOnce checks active file subscriptions and drops the ones whose pane is gone.
//
// Git comparisons are not polled here: the diff engine recomputes one on invalidation and delivers
// every revision, so a pane's cost is one git read per actual change instead of one per second.
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
	var deadDiff []diffSubscription
	for _, ds := range s.diffSubs {
		if !s.clients[ds.sink] {
			delete(s.diffSubs, ds.id)
			deadDiff = append(deadDiff, ds)
		}
	}
	s.mu.Unlock()
	for _, ds := range deadDiff {
		if ds.sub != nil {
			ds.sub.Unsubscribe()
		}
	}

	for _, fs := range fSubs {
		full := filepath.Join(fs.cwd, fs.path)
		info, statErr := os.Stat(full)
		if statErr != nil {
			// The file is gone or unreadable. Skipping here is what made a deletion silent: the pane kept showing
			// the document and the next save recreated the file without ever telling the user it had vanished.
			// Only report once per transition, which the stamp comparison covers.
			if fs.stamp == "" {
				continue
			}
			s.mu.Lock()
			if cur, ok := s.fileSubs[fs.id]; ok {
				cur.stamp = ""
				s.fileSubs[fs.id] = cur
			}
			s.mu.Unlock()
			_ = sendSessionMsg(ctx, fs.sink, "fs.file.update", map[string]any{
				"subscriptionId": fs.id,
				"version":        workspace.StatFileVersion(fs.cwd, fs.path),
			})
			continue
		}
		stamp := fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
		if stamp == fs.stamp {
			// Unchanged since the last poll; no read needed.
			continue
		}
		fc, err := workspace.ReadFile(fs.cwd, fs.path)
		if err != nil {
			// The file was deleted, became a directory, or lost its permissions. The pane still needs to know:
			// without an update it keeps showing a document that no longer exists, and the user's next save
			// silently recreates it instead of being told what happened.
			version := workspace.StatFileVersion(fs.cwd, fs.path)
			if version.Revision == fs.lastVersion && version.Status != "missing" {
				continue
			}
			s.mu.Lock()
			if cur, ok := s.fileSubs[fs.id]; ok {
				cur.lastVersion = version.Revision
				cur.stamp = stamp
				s.fileSubs[fs.id] = cur
			}
			s.mu.Unlock()
			_ = sendSessionMsg(ctx, fs.sink, "fs.file.update", map[string]any{
				"subscriptionId": fs.id,
				"version":        version,
			})
			continue
		}
		if fc.Revision == fs.lastVersion {
			// Same revision despite a new stamp (a touched file, or a write that was undone):
			// remember the stamp so the next poll does not read it again.
			s.mu.Lock()
			if cur, ok := s.fileSubs[fs.id]; ok {
				cur.stamp = stamp
				s.fileSubs[fs.id] = cur
			}
			s.mu.Unlock()
			continue
		}
		s.mu.Lock()
		if cur, ok := s.fileSubs[fs.id]; ok {
			cur.lastVersion = fc.Revision
			cur.stamp = stamp
			s.fileSubs[fs.id] = cur
		}
		s.mu.Unlock()
		// `version` is the FileVersion union (status/cwd/path/size/modifiedAt), not a bare revision string. Sending
		// the string made every update fail validation, so no file pane ever learned that its file had changed on
		// disk — the "changed on disk" callout and its reload/overwrite actions were unreachable.
		_ = sendSessionMsg(ctx, fs.sink, "fs.file.update", map[string]any{
			"subscriptionId": fs.id,
			"version": workspace.FileVersion{
				Status:     "ready",
				Cwd:        fs.cwd,
				Path:       fs.path,
				Size:       fc.Size,
				ModifiedAt: fc.ModifiedAt,
				Revision:   fc.Revision,
			},
		})
	}
}

// broadcastCheckoutStatusIfChanged pushes checkout status when its dirty/branch facts move.
//
// Called from the file-subscription poller and from the diff engine's delivery, so it only runs
// for checkouts some pane is watching. Pushing for every live workspace on a timer costs one
// `git status` per workspace per tick.
func (s *Server) broadcastCheckoutStatusIfChanged(ctx context.Context, cwd string) {
	st := workspace.GetCheckoutStatus(ctx, cwd, "")
	dirty := st.IsDirty != nil && *st.IsDirty
	branch := ""
	if st.CurrentBranch != nil {
		branch = *st.CurrentBranch
	}
	cwd = workspace.CanonicalCwd(cwd)
	fingerprint := branch + "|" + fmt.Sprint(dirty) + "|" + fmt.Sprint(st.IsGit)

	s.mu.Lock()
	if s.checkoutStatusFingerprints == nil {
		s.checkoutStatusFingerprints = make(map[string]string)
	}
	previous, seen := s.checkoutStatusFingerprints[cwd]
	s.checkoutStatusFingerprints[cwd] = fingerprint
	s.mu.Unlock()
	// The workspace descriptor carries the same facts, and the app reads the command center's branch
	// from it. Refreshing the cache here keeps one git read feeding both pushes.
	s.storeCheckoutGitRuntimeFromStatus(cwd, st)
	if seen && previous == fingerprint {
		return
	}
	s.broadcastSessionMsg("checkout_status_update", st)
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

// filePollInterval is how often an open file subscription re-stats its path. Checkout facts and
// diffs are event-driven; this tick is only for fs.file.update, whose version is a file revision
// rather than a git comparison.
const filePollInterval = time.Second

// startFilePoller runs PollSubscriptionsOnce until the server closes.
func (s *Server) startFilePoller() {
	go func() {
		ticker := time.NewTicker(filePollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case <-ticker.C:
				// A panic in one poll must not end the loop: the goroutine would die silently, the daemon
				// would keep serving, and every subscription would stop updating with nothing to show for
				// it. Node guards this with a liveness canary; Go polls on a timer, so the equivalent guard
				// is to survive the tick.
				s.runPollTick()
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
				// Guarded for the same reason as the fast poll: a panic here would end the goroutine and
				// workspace git facts would stop updating, silently.
				s.runPlacementTick()
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

// restorePersistedTerminals recreates the terminal tabs recorded by a previous run.
//
// Each restored terminal is a fresh shell under the original id: the process and its scrollback
// cannot be recovered, but keeping the id means the client's saved layout references still
// resolve instead of leaving empty panels.
func (s *Server) restorePersistedTerminals() {
	sessions := terminal.LoadPersistedTerminals(s.homeDir)
	if len(sessions) == 0 {
		return
	}

	restored := make([]terminal.PersistedTerminalSession, 0, len(sessions))
	for _, record := range sessions {
		// A directory that no longer exists cannot host a shell; keeping the tab would give the
		// user a terminal that fails to start when they click it.
		if info, err := os.Stat(record.Cwd); err != nil || !info.IsDir() {
			continue
		}
		created, err := terminal.StartSession(terminal.StartOptions{
			ID:          record.ID,
			Name:        record.Name,
			Cwd:         record.Cwd,
			WorkspaceID: record.WorkspaceID,
			Command:     record.Command,
			Args:        record.Args,
			OnActivityChange: func(_state, _attentionReason string) {
				s.broadcastTerminalsChanged(record.Cwd, record.WorkspaceID)
			},
		})
		if err != nil {
			continue
		}
		s.registerTerminalSession(created)
		restored = append(restored, record)
	}

	// Rewrite the file with what actually came back, so a terminal that failed to start is not
	// retried on every restart forever.
	_ = terminal.SavePersistedTerminals(s.homeDir, restored)
	if len(restored) > 0 {
		fmt.Fprintf(os.Stderr, "restored %d terminal tab(s)\n", len(restored))
	}
}

// registerTerminalSession inserts a session and its id under one lock.
//
// Every path that allocates a slot must use this (ensureTerminalSlot honors a slot the client
// chose and registers its id itself). Restore used to pick slots from 1 while create used
// len(s.terminals), so the first tab created after a restart overwrote the last restored session
// — and with the id map in place, input for that restored tab then reached the new shell. One
// allocator for every allocated slot makes the slot and the id agree by construction.
func (s *Server) registerTerminalSession(sess *terminal.Session) uint8 {
	s.mu.Lock()
	defer s.mu.Unlock()
	slot := s.freeTerminalSlotLocked()
	s.terminals[slot] = sess
	s.terminalSlotsByID[sess.ID] = slot
	return slot
}

// freeTerminalSlotLocked returns the first free slot. The caller must hold s.mu.
func (s *Server) freeTerminalSlotLocked() uint8 {
	for slot := 0; slot < 256; slot++ {
		if _, taken := s.terminals[uint8(slot)]; !taken {
			return uint8(slot)
		}
	}
	// Slots are a single byte; a 257th simultaneous terminal reuses 0 rather than vanishing.
	return 0
}

// runPollTick runs one subscription poll, surviving a panic.
//
// The recover is the whole point: without it a nil map or a closed channel deep inside the poll ends the
// goroutine, and the symptom is subscriptions that quietly stop — no error, no log, nothing to search for.
// Recovering logs instead, so the failure is at least visible in daemon.log.
func (s *Server) runPollTick() {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "subscription poll panicked: %v\n%s\n", recovered, debug.Stack())
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s.PollSubscriptionsOnce(ctx)
}

// runPlacementTick re-reads workspace git facts and archives merged worktrees, surviving a panic.
//
// One recover per tick rather than per step: the two steps share the same failure surface (a workspace record
// read, a git call), and a panic in the first would otherwise skip the second for the rest of the process's
// life without any indication.
func (s *Server) runPlacementTick() {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "workspace placement poll panicked: %v\n%s\n", recovered, debug.Stack())
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	s.reconcileAllWorkspacePlacements(ctx)
	cancel()

	// A branch switched or committed to from a terminal moves the checkout's PR lookup; this is
	// where the daemon notices it for checkouts no diff pane is watching.
	sctx, scancel := context.WithTimeout(context.Background(), 2*time.Minute)
	s.syncPRStatusTargets(sctx)
	scancel()

	// Checking for merged PRs rides the same slow tick: a forge call per workspace per minute would be
	// abusive, and the user does not need archiving to happen faster than the sidebar refresh.
	if s.autoArchiveEnabled() {
		actx, acancel := context.WithTimeout(context.Background(), 120*time.Second)
		s.runAutoArchivePass(actx)
		acancel()
	}
}

// pushProviderSnapshot rebuilds the provider catalog and broadcasts it. Every open settings sheet
// renders from it, so a catalog change has to reach them without a manual refresh; `only` narrows
// the push to the cards a caller touched. The push omits requestId because it answers no request.
//
// The rebuilt catalog also replaces the cached one, so a sheet that reconnects right after gets the
// same entries the push carried instead of re-probing every provider CLI.
func (s *Server) pushProviderSnapshot(ctx context.Context, cfg map[string]any, only []string, cwd string) bool {
	catalog, current := s.rebuildProviderCatalog(ctx, cfg, cwd)
	if !current {
		// A newer build or a providers edit overtook this one while it probed: broadcasting it
		// would put back a provider the user just removed, or take away one just added.
		return false
	}
	entries := catalog.entries
	if len(only) > 0 {
		entries = filterSnapshotEntries(entries, only)
	}
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	payload := map[string]any{
		"generatedAt":     nowStr,
		"entries":         entries,
		"snapshotHash":    providerSnapshotHash(entries),
		"fetchedAt":       providerFetchedAt(entries, nowStr),
		"compactSnapshot": providers.BuildCompactSnapshot(entries),
	}
	// `cwd` scopes the push: the client keys its cached snapshot by scope, and a narrowed refresh
	// in one workspace must not overwrite the host catalog. It is optional, not nullable — a null
	// makes the client drop the whole update.
	if key := providerCatalogKey(cwd); key != "" {
		payload["cwd"] = key
	}
	s.broadcastSessionMsg("providers_snapshot_update", payload)
	return true
}

// patchTouchesProviders reports whether a config patch can change the provider catalog. A removal
// counts even when the patch carries no providers map, which is the shape the settings page sends
// when the user deletes a provider.
func patchTouchesProviders(patch map[string]any) bool {
	_, hasProviders := patch["providers"]
	_, hasRemovals := patch["removeProviders"]
	_, hasGeneration := patch["metadataGeneration"]
	return hasProviders || hasRemovals || hasGeneration
}

func providersFromConfig(cfg map[string]any) map[string]any {
	providers, _ := cfg["providers"].(map[string]any)
	return providers
}
