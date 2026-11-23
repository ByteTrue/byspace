package server

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/workspace"
	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

// Watching a checkout: the working tree for what the user edits, the git directory for what git
// decides.
//
// One watch exists per directory, shared by every consumer. The working tree alone feeds dirtiness,
// checkout status, the working diff and the file explorer; a watcher per feature would spend one
// descriptor per directory per feature, and a large workspace exhausts that budget. Consumers hold
// a reference and the watch goes away with the last one.

const (
	// observationGitTimeout bounds the git call that locates a checkout's directories. It runs
	// once per checkout, never on a watcher goroutine.
	observationGitTimeout = 10 * time.Second
)

var errObservationClosed = errors.New("server: observation service is closed")

type observationService struct {
	obs filewatch.Observation

	mu     sync.Mutex
	roots  map[string]*observedRoot
	dirs   map[string]gitDirs
	closed bool
}

// gitDirs is a checkout's own git directory and the shared one. They are the same for a main
// worktree and differ for a linked one.
type gitDirs struct {
	worktree string
	common   string
}

func newObservationService(obs filewatch.Observation) *observationService {
	return &observationService{
		obs:   obs,
		roots: map[string]*observedRoot{},
		dirs:  map[string]gitDirs{},
	}
}

// observationConsumer is one subscriber. onFile receives working-tree events, onGit classified
// git-directory events. Callbacks run on the watcher goroutine and must not block.
type observationConsumer struct {
	onFile func(filewatch.Event)
	onGit  func(gitmeta.Effect, filewatch.Event)
	// owner marks the checkout whose .git the shared directory is. An owner-scoped change there
	// belongs to that checkout alone; every other worktree of the repository shares only the
	// all-scoped files.
	owner bool
}

// observedRoot is one watched directory and the consumers sharing it.
type observedRoot struct {
	key  string
	path string
	// scope is empty for a working tree and set for a git directory, where it decides how a
	// changed path is classified.
	scope     gitmeta.Scope
	ready     chan struct{}
	err       error
	mu        sync.Mutex
	sub       filewatch.Subscription
	consumers map[*observationConsumer]struct{}
}

func (r *observedRoot) add(consumer *observationConsumer) {
	r.mu.Lock()
	r.consumers[consumer] = struct{}{}
	r.mu.Unlock()
}

// handle fans one event out to the current consumers.
//
// The list is copied before the callbacks run: a consumer may release itself from its callback,
// and holding the lock across the call would deadlock it.
func (r *observedRoot) handle(event filewatch.Event) {
	var effect gitmeta.Effect
	if r.scope != "" {
		relative, err := filepath.Rel(r.path, event.Path)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return
		}
		effect = gitmeta.Classify(r.scope, filepath.ToSlash(relative))
		if effect.Kind == gitmeta.KindIgnore {
			return
		}
	}
	r.mu.Lock()
	consumers := make([]*observationConsumer, 0, len(r.consumers))
	for consumer := range r.consumers {
		consumers = append(consumers, consumer)
	}
	r.mu.Unlock()
	for _, consumer := range consumers {
		// Index and HEAD in a shared directory belong to the main worktree; a linked worktree
		// keeps its own under .git/worktrees/<name> and is told about this one only when every
		// worktree must re-read.
		if effect.Kind == gitmeta.KindOwner && r.scope == gitmeta.ScopeCommon && !consumer.owner {
			continue
		}
		if consumer.onGit != nil {
			consumer.onGit(effect, event)
		} else if consumer.onFile != nil {
			consumer.onFile(event)
		}
	}
}

// watchWorkingTree subscribes to changes under a checkout's working tree. The returned release is
// idempotent and safe to call from the callback.
func (o *observationService) watchWorkingTree(cwd string, onFile func(filewatch.Event)) (func(), error) {
	root := filepath.Clean(cwd)
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("server: working tree %q is not absolute", cwd)
	}
	// The git directory sits inside the working tree. It is watched separately and classified,
	// so reporting it here too would run every git event twice — once as a file edit.
	var excluded []string
	if dirs, err := o.gitDirsFor(root); err == nil {
		excluded = append(excluded, dirs.worktree)
		if dirs.common != dirs.worktree {
			excluded = append(excluded, dirs.common)
		}
	}
	consumer := &observationConsumer{onFile: onFile}
	watched, err := o.attach("worktree:"+root, root, "", excluded, consumer)
	if err != nil {
		return nil, err
	}
	return func() { o.release([]*observedRoot{watched}, consumer) }, nil
}

// watchGit subscribes to the git metadata a checkout reads. A linked worktree has two watched
// directories — its own and the repository's — so both are shared independently and released
// together.
func (o *observationService) watchGit(cwd string, onGit func(gitmeta.Effect, filewatch.Event)) (func(), error) {
	dirs, err := o.gitDirsFor(cwd)
	if err != nil {
		return nil, err
	}
	consumer := &observationConsumer{onGit: onGit, owner: dirs.worktree == dirs.common}
	var watched []*observedRoot
	if dirs.worktree == dirs.common {
		root, err := o.attach("git:"+dirs.common, dirs.common, gitmeta.ScopeCommon, gitExclusions(dirs.common), consumer)
		if err != nil {
			return nil, err
		}
		watched = append(watched, root)
	} else {
		// The per-worktree directory lives under the common one. Excluding it there keeps the
		// kernel from doubling every watch in it; the worktree root covers those files.
		common, err := o.attach("git:"+dirs.common, dirs.common, gitmeta.ScopeCommon, gitExclusions(dirs.common), consumer)
		if err != nil {
			return nil, err
		}
		watched = append(watched, common)
		worktree, err := o.attach("git:"+dirs.worktree, dirs.worktree, gitmeta.ScopeWorktree, nil, consumer)
		if err != nil {
			o.release(watched, consumer)
			return nil, err
		}
		watched = append(watched, worktree)
	}
	return func() { o.release(watched, consumer) }, nil
}

// gitExclusions is what a shared git directory never needs to report: the pruned noise (objects,
// logs, hooks) and the per-worktree admin directories, each watched by its own checkout.
func gitExclusions(common string) []string {
	pruned := gitmeta.PrunedPaths(gitmeta.ScopeCommon)
	excluded := make([]string, 0, len(pruned)+1)
	for _, relative := range pruned {
		excluded = append(excluded, filepath.Join(common, relative))
	}
	return append(excluded, filepath.Join(common, "worktrees"))
}

// gitDirsFor resolves a checkout's git directories once. The answer cannot change while the
// checkout exists: moving a worktree rewrites .git but keeps the same administrative path.
func (o *observationService) gitDirsFor(cwd string) (gitDirs, error) {
	key := strings.TrimSpace(cwd)
	o.mu.Lock()
	cached, ok := o.dirs[key]
	closed := o.closed
	o.mu.Unlock()
	if closed {
		return gitDirs{}, errObservationClosed
	}
	if ok {
		return cached, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), observationGitTimeout)
	defer cancel()
	worktree, common, err := workspace.ResolveGitDirs(ctx, key)
	if err != nil {
		return gitDirs{}, err
	}
	dirs := gitDirs{worktree: worktree, common: common}
	o.mu.Lock()
	if !o.closed {
		o.dirs[key] = dirs
	}
	o.mu.Unlock()
	return dirs, nil
}

// attach adds a consumer to a root's watch, creating the watch when it is the first one.
//
// Creation happens outside the lock so a large initial scan does not block other checkouts;
// concurrent attach calls wait on the root's ready channel instead of opening a second
// subscription to the same directory.
func (o *observationService) attach(key, path string, scope gitmeta.Scope, excluded []string, consumer *observationConsumer) (*observedRoot, error) {
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return nil, errObservationClosed
	}
	if existing := o.roots[key]; existing != nil {
		o.mu.Unlock()
		<-existing.ready
		if existing.err != nil {
			return nil, existing.err
		}
		existing.add(consumer)
		return existing, nil
	}
	root := &observedRoot{
		key:       key,
		path:      path,
		scope:     scope,
		ready:     make(chan struct{}),
		consumers: map[*observationConsumer]struct{}{consumer: {}},
	}
	o.roots[key] = root
	o.mu.Unlock()

	sub, err := o.obs.Subscribe(path, filewatch.Options{Excluded: excluded}, root.handle)
	root.mu.Lock()
	root.sub = sub
	root.err = err
	root.mu.Unlock()
	close(root.ready)
	if err != nil {
		o.mu.Lock()
		if o.roots[key] == root {
			delete(o.roots, key)
		}
		o.mu.Unlock()
		return nil, err
	}
	return root, nil
}

// release drops a consumer from each root and tears down the ones left without subscribers.
func (o *observationService) release(roots []*observedRoot, consumer *observationConsumer) {
	for _, root := range roots {
		root.mu.Lock()
		if _, ok := root.consumers[consumer]; !ok {
			root.mu.Unlock()
			continue
		}
		delete(root.consumers, consumer)
		last := len(root.consumers) == 0
		sub := root.sub
		root.mu.Unlock()
		if !last {
			continue
		}
		o.mu.Lock()
		if o.roots[root.key] == root {
			delete(o.roots, root.key)
		}
		o.mu.Unlock()
		if sub != nil {
			sub.Release()
		}
	}
}

// health reports the watcher counters for the runtime metrics line. A nil service means the
// platform has no backend, which is a different answer from a healthy service with zero watches.
func (o *observationService) health() map[string]any {
	if o == nil {
		return nil
	}
	diagnostics := o.obs.Diagnostics()
	return map[string]any{
		"subscriptions": diagnostics.Subscriptions,
		"tracked":       diagnostics.Tracked,
		"pending":       diagnostics.Pending,
		"degraded":      diagnostics.Degraded,
		"failures":      diagnostics.Failures,
	}
}

// close releases every watch. In-flight subscribers see errObservationClosed.
func (o *observationService) close() {
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return
	}
	o.closed = true
	roots := make([]*observedRoot, 0, len(o.roots))
	for _, root := range o.roots {
		roots = append(roots, root)
	}
	o.roots = map[string]*observedRoot{}
	o.mu.Unlock()

	for _, root := range roots {
		<-root.ready
		root.mu.Lock()
		sub := root.sub
		root.consumers = map[*observationConsumer]struct{}{}
		root.mu.Unlock()
		if sub != nil {
			sub.Release()
		}
	}
}
