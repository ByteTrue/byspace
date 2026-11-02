package server

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// The PR status on every workspace a client can see, ported from the archived Node daemon's
// workspace-git-service (the forge snapshot and its PR status poll) and session.ts (githubRuntime on
// the workspace descriptor). The sidebar's PR badge reads it; the PR panel asks for its own copy
// through checkout_pr_status_request, resolved the same way.
//
// Node polls the workspaces a client observes. Here that is every live checkout while at least one
// client is connected: the client lists all of them.

type prStatusEntry struct {
	key     string
	forge   string
	release func()
	// runtime is the descriptor's githubRuntime; nil until the first answer.
	runtime map[string]any
	// succeeded reports that runtime came from a successful poll: a later failure keeps it.
	succeeded bool
}

type prStatusState struct {
	mu      sync.Mutex
	poller  *workspace.PRStatusPoller
	entries map[string]*prStatusEntry // by cwd
	// observing is whether a client was connected at the last sync.
	observing bool
	// syncing serializes target syncs; pending cwds wait for the next one.
	syncMu   sync.Mutex
	debounce map[string]time.Time
}

const prStatusCwdSyncDebounce = 10 * time.Second

func newPRStatusState() *prStatusState {
	return &prStatusState{
		poller:   workspace.NewPRStatusPoller(),
		entries:  map[string]*prStatusEntry{},
		debounce: map[string]time.Time{},
	}
}

func (s *Server) closePRStatus() {
	if s.prStatus == nil {
		return
	}
	s.prStatus.poller.Close()
}

func (s *Server) hasClients() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients) > 0
}

// prStatusRuntime is a checkout's githubRuntime and forge for its workspace descriptors.
func (s *Server) prStatusRuntime(cwd string) (map[string]any, string) {
	if s.prStatus == nil {
		return nil, ""
	}
	s.prStatus.mu.Lock()
	defer s.prStatus.mu.Unlock()
	entry := s.prStatus.entries[strings.TrimSpace(cwd)]
	if entry == nil || entry.runtime == nil {
		return nil, ""
	}
	return entry.runtime, entry.forge
}

// syncPRStatusTargets polls every live checkout while a client is connected, and nothing otherwise.
func (s *Server) syncPRStatusTargets(ctx context.Context) {
	if s.prStatus == nil {
		return
	}
	s.prStatus.syncMu.Lock()
	defer s.prStatus.syncMu.Unlock()

	wanted := map[string]bool{}
	if s.hasClients() {
		for _, cwd := range s.prStatusCheckouts() {
			wanted[cwd] = true
		}
	}
	s.prStatus.mu.Lock()
	var stale []string
	for cwd := range s.prStatus.entries {
		if !wanted[cwd] {
			stale = append(stale, cwd)
		}
	}
	s.prStatus.mu.Unlock()
	for _, cwd := range stale {
		s.dropPRStatusTarget(cwd)
	}

	// A few checkouts at a time: each lookup reads git config and HEAD.
	slots := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for cwd := range wanted {
		wg.Add(1)
		go func(cwd string) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			s.syncPRStatusTarget(ctx, cwd)
		}(cwd)
	}
	wg.Wait()
}

// prStatusCheckouts lists the directories of live git workspaces.
func (s *Server) prStatusCheckouts() []string {
	workspaces, err := s.store.ListWorkspaces()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, ws := range workspaces {
		cwd := strings.TrimSpace(ws.Cwd)
		if ws.ArchivedAt != nil || cwd == "" || seen[cwd] || ws.Kind == "directory" || isHomeWorkspace(ws) {
			continue
		}
		if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
			continue
		}
		seen[cwd] = true
		out = append(out, cwd)
	}
	return out
}

func isHomeWorkspace(ws store.WorkspaceRecord) bool {
	for _, label := range ws.Labels {
		if label == store.HomeWorkspaceLabel {
			return true
		}
	}
	return false
}

// syncPRStatusTarget points a checkout's poll at its current branch and commit.
func (s *Server) syncPRStatusTarget(ctx context.Context, cwd string) {
	var target *workspace.PRPollTarget
	if workspace.OriginRemoteURL(ctx, cwd) != "" {
		if lookup := workspace.ResolvePRLookupTarget(ctx, cwd); lookup != nil {
			target = &workspace.PRPollTarget{Cwd: cwd, Forge: workspace.DetectForge(ctx, cwd), Lookup: *lookup}
		}
	}
	if target == nil {
		s.dropPRStatusTarget(cwd)
		return
	}
	key := prStatusTargetKey(*target)
	s.prStatus.mu.Lock()
	existing := s.prStatus.entries[cwd]
	if existing != nil && existing.key == key {
		s.prStatus.mu.Unlock()
		return
	}
	entry := &prStatusEntry{key: key, forge: target.Forge}
	if existing != nil {
		// The branch or commit moved: keep showing the old answer until the new one lands.
		entry.runtime, entry.succeeded = existing.runtime, existing.succeeded
	}
	s.prStatus.entries[cwd] = entry
	s.prStatus.mu.Unlock()
	if existing != nil && existing.release != nil {
		existing.release()
	}

	release := s.prStatus.poller.Retain(*target, workspace.PRStatusListener{
		OnStatus: func(status map[string]any) { s.notePRStatus(cwd, entry, status, nil) },
		OnError:  func(err error) { s.notePRStatus(cwd, entry, nil, err) },
	})
	s.prStatus.mu.Lock()
	if s.prStatus.entries[cwd] == entry {
		entry.release = release
		s.prStatus.mu.Unlock()
		return
	}
	s.prStatus.mu.Unlock()
	release()
}

func prStatusTargetKey(target workspace.PRPollTarget) string {
	return strings.Join([]string{target.Forge, target.Lookup.HeadRef, target.Lookup.HeadSha, target.Lookup.HeadRepositoryOwner}, "\x00")
}

func (s *Server) dropPRStatusTarget(cwd string) {
	s.prStatus.mu.Lock()
	entry := s.prStatus.entries[cwd]
	delete(s.prStatus.entries, cwd)
	s.prStatus.mu.Unlock()
	if entry == nil {
		return
	}
	if entry.release != nil {
		entry.release()
	}
	if entry.runtime != nil {
		s.broadcastWorkspaceForCwd(cwd)
	}
}

// notePRStatus records a poll's answer and re-sends the checkout's workspaces when it changed.
//
// A failed poll keeps the last good answer, as Node's poll does; before any success the failure is
// what the descriptor reports.
func (s *Server) notePRStatus(cwd string, entry *prStatusEntry, status map[string]any, pollErr error) {
	s.prStatus.mu.Lock()
	if s.prStatus.entries[cwd] != entry {
		s.prStatus.mu.Unlock()
		return
	}
	var next map[string]any
	switch {
	case pollErr == nil:
		next = map[string]any{"featuresEnabled": true, "pullRequest": nullablePR(status), "error": nil}
		entry.succeeded = true
	case entry.succeeded || workspace.IsPRPollPaused(pollErr):
		s.prStatus.mu.Unlock()
		return
	default:
		next = map[string]any{
			"featuresEnabled": !forgeUnavailable(pollErr),
			"pullRequest":     nil,
			"error":           map[string]any{"message": pollErr.Error()},
		}
	}
	changed := !sameJSON(entry.runtime, next)
	entry.runtime = next
	s.prStatus.mu.Unlock()
	if changed {
		s.broadcastWorkspaceForCwd(cwd)
	}
}

func nullablePR(status map[string]any) any {
	if status == nil {
		return nil
	}
	return status
}

// forgeUnavailable reports a failure that means the forge cannot be used at all: no CLI, or not
// signed in.
func forgeUnavailable(err error) bool {
	var cliErr *workspace.GitHubCLIError
	if errors.As(err, &cliErr) {
		return true
	}
	lowered := strings.ToLower(err.Error())
	return strings.Contains(lowered, "not authenticated") || strings.Contains(lowered, "not logged in") ||
		strings.Contains(lowered, "auth login") || strings.Contains(lowered, "not installed")
}

func sameJSON(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

// notePRStatusCheckoutChanged follows a checkout the app just changed (a commit, a push, a branch
// switch, a PR created or merged): re-read its branch and commit, and poll its PR now.
func (s *Server) notePRStatusCheckoutChanged(cwd string) {
	cwd = strings.TrimSpace(cwd)
	if s.prStatus == nil || cwd == "" || !s.hasClients() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.prStatus.syncMu.Lock()
		s.syncPRStatusTarget(ctx, cwd)
		s.prStatus.syncMu.Unlock()
		s.prStatus.poller.PollNow(cwd)
	}()
}

// notePRStatusWorkspaceTouched re-reads a checkout's lookup target after its workspace changed,
// at most once per debounce window: workspace updates arrive on every agent status change.
func (s *Server) notePRStatusWorkspaceTouched(cwd string, archived bool) {
	cwd = strings.TrimSpace(cwd)
	if s.prStatus == nil || cwd == "" || !s.hasClients() {
		return
	}
	// An archived workspace that was the checkout's last: stop at once rather than after the
	// debounce.
	if archived {
		go func() {
			if !s.isLivePRStatusCheckout(cwd) {
				s.dropPRStatusTarget(cwd)
			}
		}()
		return
	}
	s.prStatus.mu.Lock()
	last := s.prStatus.debounce[cwd]
	now := time.Now()
	if now.Sub(last) < prStatusCwdSyncDebounce {
		s.prStatus.mu.Unlock()
		return
	}
	s.prStatus.debounce[cwd] = now
	s.prStatus.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.prStatus.syncMu.Lock()
		defer s.prStatus.syncMu.Unlock()
		if s.isLivePRStatusCheckout(cwd) {
			s.syncPRStatusTarget(ctx, cwd)
		}
	}()
}

func (s *Server) isLivePRStatusCheckout(cwd string) bool {
	for _, candidate := range s.prStatusCheckouts() {
		if candidate == cwd {
			return true
		}
	}
	return false
}

// notePRStatusClientsChanged starts polling when the first client connects and stops when the last
// one leaves.
func (s *Server) notePRStatusClientsChanged() {
	if s.prStatus == nil {
		return
	}
	observing := s.hasClients()
	s.prStatus.mu.Lock()
	changed := s.prStatus.observing != observing
	s.prStatus.observing = observing
	s.prStatus.mu.Unlock()
	if !changed {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.syncPRStatusTargets(ctx)
	}()
}
