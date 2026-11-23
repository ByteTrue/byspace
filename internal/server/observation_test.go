package server

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/workspace"
	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@e", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@e")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// eventLog collects callback output so assertions do not race the watcher.
type eventLog struct {
	mu     sync.Mutex
	events []filewatch.Event
	git    []gitmeta.Effect
}

func (l *eventLog) file(event filewatch.Event) {
	l.mu.Lock()
	l.events = append(l.events, event)
	l.mu.Unlock()
}

func (l *eventLog) meta(effect gitmeta.Effect, event filewatch.Event) {
	l.mu.Lock()
	l.events = append(l.events, event)
	l.git = append(l.git, effect)
	l.mu.Unlock()
}

func (l *eventLog) snapshot() ([]filewatch.Event, []gitmeta.Effect) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]filewatch.Event(nil), l.events...), append([]gitmeta.Effect(nil), l.git...)
}

// The working tree is watched once for every consumer. Dirtiness, status, the working diff and the
// file explorer all subscribe to the same checkout, and a watcher each would spend one descriptor
// per directory each.
func TestObservationSharesWorkingTreeWatch(t *testing.T) {
	fake := filewatch.NewFake()
	service := newObservationService(fake)
	defer service.close()
	root := t.TempDir()
	first, second := &eventLog{}, &eventLog{}

	releaseFirst, err := service.watchWorkingTree(root, first.file)
	if err != nil {
		t.Fatalf("first watch: %v", err)
	}
	releaseSecond, err := service.watchWorkingTree(root, second.file)
	if err != nil {
		t.Fatalf("second watch: %v", err)
	}
	if got := fake.Diagnostics().Subscriptions; got != 1 {
		t.Fatalf("subscriptions = %d, want 1 shared by both consumers", got)
	}

	fake.Create(filepath.Join(root, "a.txt"))
	if events, _ := first.snapshot(); len(events) != 1 || events[0].Kind != filewatch.Created {
		t.Fatalf("first consumer saw %v, want one created event", events)
	}
	if events, _ := second.snapshot(); len(events) != 1 {
		t.Fatalf("second consumer saw %v, want the same event", events)
	}

	releaseFirst()
	fake.Create(filepath.Join(root, "b.txt"))
	if events, _ := first.snapshot(); len(events) != 1 {
		t.Fatalf("released consumer still received %v", events)
	}
	if events, _ := second.snapshot(); len(events) != 2 {
		t.Fatalf("remaining consumer saw %v, want the second create", events)
	}

	releaseSecond()
	releaseSecond()
	if got := fake.Diagnostics().Subscriptions; got != 0 {
		t.Fatalf("subscriptions = %d after the last release, want 0", got)
	}
}

// A git directory is mostly noise: object packs, reflogs and lock files change constantly and none
// of it is visible in the UI. Classification happens at the watch, so a consumer is never woken
// for a pack write.
func TestObservationClassifiesGitMetadata(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	fake := filewatch.NewFake()
	service := newObservationService(fake)
	defer service.close()
	log := &eventLog{}

	release, err := service.watchGit(repo, log.meta)
	if err != nil {
		t.Fatalf("watchGit: %v", err)
	}
	defer release()
	if got := fake.Diagnostics().Subscriptions; got != 1 {
		t.Fatalf("subscriptions = %d, want one shared directory for a main worktree", got)
	}
	gitDir := filepath.Join(repo, ".git")

	fake.Write(filepath.Join(gitDir, "refs", "heads", "feature"))
	fake.Write(filepath.Join(gitDir, "HEAD"))
	fake.Write(filepath.Join(gitDir, "objects", "pack", "pack-1.pack"))
	fake.Write(filepath.Join(gitDir, "index.lock"))

	events, effects := log.snapshot()
	if len(events) != 2 {
		t.Fatalf("received %d events (%v), want the branch ref and HEAD only", len(events), events)
	}
	if effects[0].Kind != gitmeta.KindRef || effects[0].Namespace != "local" || effects[0].Ref != "feature" {
		t.Fatalf("branch ref classified as %+v", effects[0])
	}
	if effects[1].Kind != gitmeta.KindOwner || !effects[1].RefreshBase {
		t.Fatalf("HEAD classified as %+v, want an owner refresh that recomputes the base", effects[1])
	}
}

// A linked worktree has two git directories and both are needed: its own holds index and HEAD, the
// repository's holds the refs. The per-worktree subtree is excluded from the shared watch so no
// directory is watched twice.
func TestObservationWatchesBothGitDirsOfLinkedWorktree(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	linked := filepath.Join(t.TempDir(), "linked")
	gitIn(t, repo, "worktree", "add", "-q", "-b", "feature", linked)
	worktreeDir, commonDir, err := workspace.ResolveGitDirs(context.Background(), linked)
	if err != nil {
		t.Fatalf("ResolveGitDirs: %v", err)
	}

	fake := filewatch.NewFake()
	service := newObservationService(fake)
	defer service.close()
	log := &eventLog{}

	release, err := service.watchGit(linked, log.meta)
	if err != nil {
		t.Fatalf("watchGit: %v", err)
	}
	if got := fake.Diagnostics().Subscriptions; got != 2 {
		t.Fatalf("subscriptions = %d, want one per git directory", got)
	}

	fake.Write(filepath.Join(worktreeDir, "index"))
	fake.Write(filepath.Join(commonDir, "refs", "heads", "feature"))

	events, effects := log.snapshot()
	if len(events) != 2 {
		t.Fatalf("received %d events (%v), want index and the branch ref", len(events), events)
	}
	if effects[0].Kind != gitmeta.KindOwner {
		t.Fatalf("worktree index classified as %+v", effects[0])
	}
	if effects[1].Kind != gitmeta.KindRef || effects[1].Ref != "feature" {
		t.Fatalf("branch ref classified as %+v", effects[1])
	}

	release()
	if got := fake.Diagnostics().Subscriptions; got != 0 {
		t.Fatalf("subscriptions = %d after release, want both released", got)
	}
}
