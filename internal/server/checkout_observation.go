package server

import (
	"context"
	"fmt"
	"os"
	"runtime/debug"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

// Following live checkouts.
//
// Node's workspace-git-service watched every observed checkout's working tree and git directory,
// so a branch switched or a commit made in a terminal reached the sidebar within a second. The Go
// daemon polled instead (decisions/004): a HEAD fingerprint every two seconds, and a full diff per
// open Changes pane every second. This follows the checkouts the daemon serves instead: the
// working tree feeds dirtiness and the working comparison, the git directory feeds the branch,
// base and upstream facts through gitmeta.

// checkoutObservationInterval is how often the set of watched checkouts is re-read. A checkout the
// daemon creates already carries its facts, so a new one waiting this long misses nothing.
const checkoutObservationInterval = 30 * time.Second

// checkoutObserver holds one watch per live checkout. The map belongs to the reconciling
// goroutine; nothing else touches it.
type checkoutObserver struct {
	srv      *Server
	watches  map[string]func()
	releases chan checkoutReleaseRequest
}

type checkoutReleaseRequest struct {
	workspaceID string
	done        chan struct{}
}

func newCheckoutObserver(srv *Server) *checkoutObserver {
	return &checkoutObserver{srv: srv, watches: map[string]func(){}, releases: make(chan checkoutReleaseRequest)}
}

// startCheckoutObservation follows every live checkout until the server closes.
func (s *Server) startCheckoutObservation() {
	s.checkoutSetWake = make(chan struct{}, 1)
	s.checkoutObserver = newCheckoutObserver(s)
	go s.checkoutObserver.run()
}

// releaseArchivedWorkspaceObservation waits until the observer has dropped this checkout's native
// watches. Archiving the records first prevents the next reconciliation from adding them back.
func (s *Server) releaseArchivedWorkspaceObservation(ctx context.Context, workspaceID string) {
	if s.checkoutObserver == nil {
		return
	}
	request := checkoutReleaseRequest{workspaceID: workspaceID, done: make(chan struct{})}
	select {
	case s.checkoutObserver.releases <- request:
	case <-ctx.Done():
		return
	case <-s.pollStop:
		return
	}
	select {
	case <-request.done:
	case <-ctx.Done():
	case <-s.pollStop:
	}
}

// noteCheckoutSetChanged asks the observer to re-read the checkouts it follows instead of waiting
// for the next pass. A checkout the daemon just started serving must be watched immediately: its
// first edit is exactly when the user expects the sidebar to move.
func (s *Server) noteCheckoutSetChanged() {
	if s.checkoutSetWake == nil {
		return
	}
	select {
	case s.checkoutSetWake <- struct{}{}:
	default:
	}
}

func (o *checkoutObserver) run() {
	ticker := time.NewTicker(checkoutObservationInterval)
	defer ticker.Stop()
	for {
		o.reconcile()
		select {
		case <-o.srv.pollStop:
			o.releaseAll()
			return
		case <-ticker.C:
			o.pollDegraded()
		case <-o.srv.checkoutSetWake:
		case request := <-o.releases:
			o.releaseWorkspace(request.workspaceID)
			close(request.done)
		}
	}
}

// releaseWorkspace drops the observer's consumer for an archived checkout. An active sibling on
// the same path still needs it, so in that case there is nothing to release.
func (o *checkoutObserver) releaseWorkspace(workspaceID string) {
	rec, ok := o.srv.workspaceRecord(workspaceID)
	if !ok {
		return
	}
	records, err := o.srv.store.ListWorkspaces()
	if err != nil || checkoutStillReferenced(records, rec.Cwd) {
		return
	}
	cwd := workspace.CanonicalCwd(rec.Cwd)
	if release, watched := o.watches[cwd]; watched {
		release()
		delete(o.watches, cwd)
	}
}

// checkoutStillReferenced is exact by design: a nested workspace does not consume its parent's
// checkout observation, although it still blocks deleting the parent worktree.
func checkoutStillReferenced(records []store.WorkspaceRecord, path string) bool {
	for _, rec := range records {
		if rec.ArchivedAt != nil {
			continue
		}
		if pathutil.AreEquivalent(rec.Cwd, path) {
			return true
		}
	}
	return false
}

// reconcile subscribes to checkouts that gained a client and releases the ones that lost theirs.
func (o *checkoutObserver) reconcile() {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "checkout observation panicked: %v\n%s\n", recovered, debug.Stack())
		}
	}()
	if o.srv.observation == nil {
		return
	}
	live := map[string]bool{}
	if o.srv.hasClients() {
		for _, cwd := range o.srv.prStatusCheckouts() {
			live[cwd] = true
		}
	}
	for cwd, release := range o.watches {
		if live[cwd] {
			continue
		}
		release()
		delete(o.watches, cwd)
	}
	for cwd := range live {
		if _, watched := o.watches[cwd]; watched {
			continue
		}
		release, err := o.srv.watchCheckoutChanges(cwd)
		if err != nil {
			fmt.Fprintf(os.Stderr, "checkout observation unavailable for %s: %v\n", cwd, err)
			continue
		}
		o.watches[cwd] = release
	}
}

// pollDegraded re-reads checkouts whose watcher is degraded. A degraded subscription may have
// missed events, so this tick is its only source of change until the backend re-establishes the
// watch.
func (o *checkoutObserver) pollDegraded() {
	if o.srv.observation == nil || len(o.watches) == 0 {
		return
	}
	if degraded, _ := o.srv.observation.health()["degraded"].(int); degraded == 0 {
		return
	}
	for cwd := range o.watches {
		o.srv.markWorkingTreeChange(cwd)
	}
}

func (o *checkoutObserver) releaseAll() {
	for cwd, release := range o.watches {
		release()
		delete(o.watches, cwd)
	}
}

// watchCheckoutChanges subscribes to one checkout's working tree and git directories.
func (s *Server) watchCheckoutChanges(cwd string) (func(), error) {
	// The watcher reports the checkout in the OS's spelling; every later comparison with the
	// client's path goes through this one form.
	cwd = workspace.CanonicalCwd(cwd)
	if s.observation == nil {
		return nil, fmt.Errorf("checkout observation: no watcher backend")
	}
	releaseTree, err := s.observation.watchWorkingTree(cwd, func(filewatch.Event) {
		s.markWorkingTreeChange(cwd)
	})
	if err != nil {
		return nil, err
	}
	releaseGit, err := s.observation.watchGit(cwd, func(effect gitmeta.Effect, event filewatch.Event) {
		s.handleGitChange(cwd, effect, event)
	})
	if err != nil {
		releaseTree()
		return nil, err
	}
	return func() {
		releaseGit()
		releaseTree()
	}, nil
}

// markWorkingTreeChange records that a checkout's files changed. The watcher cannot say whether
// that was an edit, a stage or a commit, so the invalidation pass re-reads the facts and compares.
func (s *Server) markWorkingTreeChange(cwd string) {
	if s.gitInvalidations == nil {
		return
	}
	s.gitInvalidations.mark(cwd, []gitInvalidation{invalidateWorking}, nil, false)
}
