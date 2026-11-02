package server

import (
	"context"
	"fmt"
	"os"
	"runtime/debug"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// Following each checkout's branch and commit while a client is connected.
//
// Node's workspace-git-service watches every observed checkout's HEAD and refs with filesystem
// watchers, so a branch switched or a commit made in a terminal reaches the sidebar (branch name,
// diff stat, PR) within a second. Go polls instead (decisions/004), and without this it only
// noticed on the five-minute placement rescan or while a Changes pane was open. The poll reads the
// HEAD and branch ref files, which is cheap enough for every checkout every two seconds; git runs
// only for a checkout whose reading moved.

const (
	headWatchInterval = 2 * time.Second
	// headWatchListInterval is how often the list of checkouts is re-read. Workspaces the daemon
	// creates already carry their facts, so a new one waiting this long misses nothing.
	headWatchListInterval = 30 * time.Second
)

// startHeadWatch polls checkout HEADs until the server closes.
func (s *Server) startHeadWatch() {
	go func() {
		ticker := time.NewTicker(headWatchInterval)
		defer ticker.Stop()
		watch := &headWatch{fingerprints: map[string]string{}}
		for {
			select {
			case <-s.pollStop:
				return
			case <-ticker.C:
				s.runHeadWatchTick(watch)
			}
		}
	}()
}

// headWatch is the poll's state, owned by its goroutine.
type headWatch struct {
	checkouts    []string
	listedAt     time.Time
	fingerprints map[string]string
}

func (s *Server) runHeadWatchTick(watch *headWatch) {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "head watch panicked: %v\n%s\n", recovered, debug.Stack())
		}
	}()
	if !s.hasClients() {
		return
	}
	if now := time.Now(); watch.checkouts == nil || now.Sub(watch.listedAt) >= headWatchListInterval {
		watch.checkouts = s.prStatusCheckouts()
		watch.listedAt = now
	}
	for _, cwd := range s.movedHeads(watch) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		s.followCheckoutHead(ctx, cwd)
		cancel()
	}
}

// movedHeads reads every checkout's fingerprint and returns the ones that moved since the last
// reading. A checkout seen for the first time has nothing to compare with.
func (s *Server) movedHeads(watch *headWatch) []string {
	var moved []string
	live := make(map[string]bool, len(watch.checkouts))
	for _, cwd := range watch.checkouts {
		live[cwd] = true
		fingerprint := workspace.HeadFingerprint(cwd)
		previous, seen := watch.fingerprints[cwd]
		watch.fingerprints[cwd] = fingerprint
		if seen && fingerprint != "" && fingerprint != previous {
			moved = append(moved, cwd)
		}
	}
	for cwd := range watch.fingerprints {
		if !live[cwd] {
			delete(watch.fingerprints, cwd)
		}
	}
	return moved
}

// followCheckoutHead refreshes what a checkout's branch and commit decide: the workspace's branch,
// the git runtime and checkout status, the diff stat, and the PR.
func (s *Server) followCheckoutHead(ctx context.Context, cwd string) {
	s.refreshWorkspacePlacementAtCwd(ctx, cwd)
	s.broadcastCheckoutStatusIfChanged(ctx, cwd)
	s.refreshCheckoutDiffStat(ctx, cwd)
	s.notePRStatusCheckoutChanged(cwd)
}
