package server

import (
	"context"
	"fmt"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

// What a git metadata change forces the daemon to re-read.
//
// The poller this replaces compared a fingerprint of HEAD and the branch ref every two seconds and
// refreshed everything when it moved. That is both too coarse — a commit re-reads the working diff
// it cannot have changed — and too narrow: the fingerprint only named the refs it knew about,
// which is how a push left a stale diff stat. A classified event names the facts that can have
// changed, and nothing else is re-read.
type gitInvalidation int

const (
	// invalidateWorking means the checkout's working comparison and dirty state.
	invalidateWorking gitInvalidation = iota
	// invalidateBranch means the branch and commit the checkout points at.
	invalidateBranch
	// invalidateBase means the ref the comparison is taken from.
	invalidateBase
	// invalidateUpstream means the remote ref the checkout tracks.
	invalidateUpstream
)

// gitInvalidationDebounce waits for a burst to end before re-reading. One commit rewrites several
// files under .git (HEAD, the ref, the index), and each of them would otherwise run the same git
// commands.
const gitInvalidationDebounce = 150 * time.Millisecond

// gitInvalidationQueue coalesces changes per checkout between the watcher goroutines and the
// refresher.
//
// The watcher must not block on git, and dropping an event would leave the checkout stale until the
// next one, so the queue keeps a set of pending kinds per cwd and a single wake byte rather than a
// fixed-size channel.
type gitInvalidationQueue struct {
	mu      sync.Mutex
	pending map[string]*pendingGitChange
	wake    chan struct{}
}

// pendingGitChange is what one checkout must re-read, and the refs whose object ids decide whether
// the ref part is real. all asks the probe to look at every ref it has seen for the checkout, which
// is what a packed-refs or config rewrite needs.
type pendingGitChange struct {
	kinds map[gitInvalidation]struct{}
	refs  map[string]struct{}
	all   bool
	probe bool
}

func newGitInvalidationQueue() *gitInvalidationQueue {
	return &gitInvalidationQueue{
		pending: map[string]*pendingGitChange{},
		wake:    make(chan struct{}, 1),
	}
}

// mark records what one checkout must re-read. It never blocks.
func (q *gitInvalidationQueue) mark(cwd string, kinds []gitInvalidation, refs []string, all bool) {
	key := strings.TrimSpace(cwd)
	if key == "" || len(kinds) == 0 {
		return
	}
	q.mu.Lock()
	change := q.pending[key]
	if change == nil {
		change = &pendingGitChange{kinds: map[gitInvalidation]struct{}{}, refs: map[string]struct{}{}}
		q.pending[key] = change
	}
	for _, kind := range kinds {
		change.kinds[kind] = struct{}{}
	}
	for _, ref := range refs {
		change.refs[ref] = struct{}{}
	}
	change.all = change.all || all
	change.probe = change.probe || all || len(refs) > 0
	q.mu.Unlock()
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// take empties the queue and returns the union of what each checkout needs.
func (q *gitInvalidationQueue) take() map[string]*pendingGitChange {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.pending) == 0 {
		return nil
	}
	out := q.pending
	q.pending = map[string]*pendingGitChange{}
	return out
}

// startObservation opens the platform watcher and starts the invalidation dispatcher.
//
// A platform without a backend leaves s.observation nil; polling is then the only path, which is
// what the daemon had before this existed.
func (s *Server) startObservation() {
	// The e2e suite sets this to prove a spec that should exercise observation fails without it:
	// the head poll is gone, so a checkout with no watcher and no open diff pane never refreshes.
	if os.Getenv("BYSPACE_DISABLE_FILE_OBSERVATION") == "" {
		observation, err := filewatch.Open()
		if err == nil {
			s.observation = newObservationService(observation)
		} else {
			fmt.Fprintf(os.Stderr, "file observation unavailable, polling only: %v\n", err)
		}
	} else {
		fmt.Fprintln(os.Stderr, "file observation disabled by BYSPACE_DISABLE_FILE_OBSERVATION")
	}
	go s.runGitInvalidations()
}

// handleGitChange is the git-metadata callback. It runs on the watcher goroutine, so it only
// records the work.
func (s *Server) handleGitChange(cwd string, effect gitmeta.Effect, _ filewatch.Event) {
	refs, all := observedRefs(effect)
	s.gitInvalidations.mark(cwd, invalidationsFor(effect), refs, all)
}

// observedRefs names the refs whose object ids decide whether a change is real. HEAD is always
// probed: it is the commit the checkout shows, and a branch switch rewrites it before anything
// else.
func observedRefs(effect gitmeta.Effect) ([]string, bool) {
	switch effect.Kind {
	case gitmeta.KindRef:
		if effect.Namespace == "local" {
			return []string{"refs/heads/" + effect.Ref}, false
		}
		return []string{"refs/remotes/" + effect.Ref}, false
	case gitmeta.KindOwner, gitmeta.KindAll:
		if effect.RefreshBase {
			return nil, true
		}
	}
	return nil, false
}

// invalidationsFor maps a classified change to the facts it can have invalidated.
func invalidationsFor(effect gitmeta.Effect) []gitInvalidation {
	switch effect.Kind {
	case gitmeta.KindRef:
		if effect.Namespace == "local" {
			return []gitInvalidation{invalidateBranch}
		}
		// A moved remote ref can move the comparison base and the ahead/behind count, and it
		// never touches the working tree.
		return []gitInvalidation{invalidateUpstream, invalidateBase}
	case gitmeta.KindOwner, gitmeta.KindAll:
		if effect.RefreshBase {
			return []gitInvalidation{invalidateBranch, invalidateBase}
		}
		return []gitInvalidation{invalidateWorking}
	default:
		return nil
	}
}

// runGitInvalidations drains the queue until the server closes.
func (s *Server) runGitInvalidations() {
	for {
		select {
		case <-s.pollStop:
			return
		case <-s.gitInvalidations.wake:
		}
		if !s.waitForGitQuiet() {
			return
		}
		s.flushGitInvalidations()
	}
}

// waitForGitQuiet waits for a burst of changes to end, reporting false when the server stops.
func (s *Server) waitForGitQuiet() bool {
	timer := time.NewTimer(gitInvalidationDebounce)
	defer timer.Stop()
	for {
		select {
		case <-s.pollStop:
			return false
		case <-s.gitInvalidations.wake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(gitInvalidationDebounce)
		case <-timer.C:
			return true
		}
	}
}

func (s *Server) flushGitInvalidations() {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "git observation panicked: %v\n%s\n", recovered, debug.Stack())
		}
	}()
	for cwd, change := range s.gitInvalidations.take() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		s.applyPendingGitChange(ctx, cwd, change)
		cancel()
	}
}

// applyPendingGitChange probes the refs a change named and drops the ref-derived work when none of
// them moved.
//
// A ref file is rewritten for reasons that leave the commit alone — a pack, a lock dance, a
// fetch that found nothing — and re-reading the branch, the base and the stat for those is the
// polling behaviour this replaces. A probe that fails is not evidence of anything, so the work
// runs rather than leaving the checkout stale.
func (s *Server) applyPendingGitChange(ctx context.Context, cwd string, change *pendingGitChange) {
	kinds := make([]gitInvalidation, 0, len(change.kinds))
	for kind := range change.kinds {
		kinds = append(kinds, kind)
	}
	if change.probe {
		refs := make([]string, 0, len(change.refs))
		for ref := range change.refs {
			refs = append(refs, ref)
		}
		moved, err := s.gitRefs.probe(ctx, cwd, refs, change.all)
		if err == nil && len(moved) == 0 {
			kinds = withoutRefInvalidations(kinds)
		}
	}
	s.applyGitInvalidations(ctx, cwd, kinds)
}

// withoutRefInvalidations keeps the working-tree work of a change whose refs did not move.
func withoutRefInvalidations(kinds []gitInvalidation) []gitInvalidation {
	kept := kinds[:0]
	for _, kind := range kinds {
		if kind == invalidateWorking {
			kept = append(kept, kind)
		}
	}
	return kept
}

// applyGitInvalidations re-reads the facts the changed metadata can affect.
func (s *Server) applyGitInvalidations(ctx context.Context, cwd string, kinds []gitInvalidation) {
	for _, kind := range kinds {
		// Every one of these can move the pane's answer: a working-tree write, a commit, a
		// checkout, a rewrite of the base. The engine coalesces them into one recomputation.
		s.diffEngine.InvalidateCwd(cwd)
		switch kind {
		case invalidateWorking:
			s.broadcastCheckoutStatusIfChanged(ctx, cwd)
			s.refreshCheckoutDiffStat(ctx, cwd)
		case invalidateBranch:
			s.refreshWorkspacePlacementAtCwd(ctx, cwd)
			s.broadcastCheckoutStatusIfChanged(ctx, cwd)
			s.refreshCheckoutDiffStat(ctx, cwd)
			s.notePRStatusCheckoutChanged(cwd)
		case invalidateBase:
			s.refreshCheckoutDiffStat(ctx, cwd)
		case invalidateUpstream:
			s.refreshCheckoutDiffStat(ctx, cwd)
			s.broadcastCheckoutStatusIfChanged(ctx, cwd)
		}
	}
}
