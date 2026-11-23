package server

import (
	"fmt"
	"os"
	"runtime/debug"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
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
	srv     *Server
	watches map[string]func()
}

func newCheckoutObserver(srv *Server) *checkoutObserver {
	return &checkoutObserver{srv: srv, watches: map[string]func(){}}
}

// startCheckoutObservation follows every live checkout until the server closes.
func (s *Server) startCheckoutObservation() {
	s.checkoutSetWake = make(chan struct{}, 1)
	go newCheckoutObserver(s).run()
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
		}
	}
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
