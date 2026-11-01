package server

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// backgroundGitFetchInterval is Node's BACKGROUND_GIT_FETCH_INTERVAL_MS from
// workspace-git-service.ts.
//
// Why a poller and not just "refresh when someone looks": remote branches move while the app is
// open, and the alternatives are worse. A fetch on every read costs a network round trip per pane
// open; no fetch at all leaves the branch picker and the ahead/behind counters describing a remote
// that may be hours old. Three minutes is Node's answer and this is the same answer.
const backgroundGitFetchInterval = 180 * time.Second

// startBackgroundGitFetch refreshes every open project's remote refs on a timer.
//
// One fetch per repository, not per workspace: worktrees share the repository's refs, so fetching
// at the project root updates the branch lists of every workspace cut from it. Sequential on
// purpose — a burst of parallel `git fetch` against the same host is how a rate limit happens.
func (s *Server) startBackgroundGitFetch() {
	go func() {
		// First pass runs one interval in, not at boot: the daemon may be starting because the app
		// reopened after a laptop woke on a phone hotspot, and a fetch per repository at that moment
		// competes with the work the user is trying to get to.
		ticker := time.NewTicker(backgroundGitFetchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case <-ticker.C:
				s.runBackgroundGitFetchOnce()
			}
		}
	}()
}

// runBackgroundGitFetchOnce fetches every open project repository once.
func (s *Server) runBackgroundGitFetchOnce() {
	// The fetch itself can block for the network timeout; it must not hold the server lock or an
	// unpushed workspace list would freeze the UI for the length of a stalled connection.
	repos := s.backgroundGitFetchTargets()
	for _, repo := range repos {
		select {
		case <-s.pollStop:
			return
		default:
		}
		ctx, cancel := context.WithTimeout(context.Background(), workspace.GitNetworkTimeout)
		_, _, err := workspace.FetchRemote(ctx, repo)
		cancel()
		if err != nil {
			// Logged once per repository per cycle instead of per workspace: the same unreachable
			// remote failing five times in a row is one fact, not five.
			fmt.Fprintf(os.Stderr, "git fetch: %s: %v\n", repo, err)
		}
	}
}

// backgroundGitFetchTargets is the deduped list of repository roots worth fetching.
func (s *Server) backgroundGitFetchTargets() []string {
	projects, err := s.store.ListProjects()
	if err != nil {
		return nil
	}
	seen := make(map[string]struct{}, len(projects))
	targets := make([]string, 0, len(projects))
	for _, project := range projects {
		if project.ArchivedAt != nil || project.Kind != "git" {
			continue
		}
		root := strings.TrimSpace(project.RootPath)
		if root == "" {
			continue
		}
		if _, dup := seen[root]; dup {
			continue
		}
		seen[root] = struct{}{}
		targets = append(targets, root)
	}
	return targets
}
