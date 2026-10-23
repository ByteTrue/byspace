package server

import (
	"context"
	"strings"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// checkoutDiffStat reads the last computed diff stat for a checkout.
//
// Cached rather than computed on demand: `fetch_workspaces` describes every active workspace in
// one response, and a merge-base plus a shortstat per workspace would put several git processes
// behind a single listing. The subscription poller and the explicit refresh keep the cache warm.
func (s *Server) checkoutDiffStat(cwd string) *workspace.CheckoutDiffStat {
	key := strings.TrimSpace(cwd)
	if key == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.checkoutDiffStats[key]
}

// refreshCheckoutDiffStat recomputes the diff stat for one checkout and re-broadcasts its
// workspace when it moved.
//
// The composer's diff pill reads `diffStat` off the workspace descriptor, which the app caches
// and only updates from pushes. Recomputing without broadcasting changes nothing visible, and
// never recomputing at all is why the pill never appeared.
func (s *Server) refreshCheckoutDiffStat(ctx context.Context, cwd string) {
	key := strings.TrimSpace(cwd)
	if key == "" {
		return
	}
	stat := workspace.GetCheckoutDiffStat(ctx, key)

	s.mu.Lock()
	if s.checkoutDiffStats == nil {
		s.checkoutDiffStats = make(map[string]*workspace.CheckoutDiffStat)
	}
	previous := s.checkoutDiffStats[key]
	s.checkoutDiffStats[key] = stat
	s.mu.Unlock()

	if sameDiffStat(previous, stat) {
		return
	}
	s.broadcastWorkspaceForCwd(key)
}

// sameDiffStat compares two stats. A nil stat and a zero stat are different answers — nil means
// "nothing to report", zero means "reported nothing changed" — but neither is worth a push over
// the other when both are absent.
func sameDiffStat(left, right *workspace.CheckoutDiffStat) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Additions == right.Additions && left.Deletions == right.Deletions
}

// broadcastWorkspaceForCwd re-sends the workspace that owns cwd, if any.
func (s *Server) broadcastWorkspaceForCwd(cwd string) {
	workspaces, err := s.store.ListWorkspaces()
	if err != nil {
		return
	}
	var match *store.WorkspaceRecord
	for i := range workspaces {
		if workspaces[i].ArchivedAt != nil {
			continue
		}
		if strings.TrimRight(workspaces[i].Cwd, "/") == strings.TrimRight(cwd, "/") {
			match = &workspaces[i]
			break
		}
	}
	if match == nil {
		return
	}
	projects, err := s.store.ListProjects()
	if err != nil {
		return
	}
	for _, project := range projects {
		if project.ProjectID != match.ProjectID || project.ArchivedAt != nil {
			continue
		}
		s.broadcastWorkspaceUpsert(*match, project)
		return
	}
}
