package gitdiff

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// gitRepo is a committed checkout with a.txt and b.txt, for the comparisons below.
func gitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	git("init", "-b", "main")
	git("config", "user.email", "e2e@byspace.test")
	git("config", "user.name", "BySpace E2E")
	git("config", "commit.gpgsign", "false")
	writeRepoFile(t, dir, "a.txt", "one\n")
	writeRepoFile(t, dir, "b.txt", "two\n")
	git("add", ".")
	git("commit", "-m", "initial")
	return dir
}

func writeRepoFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, rel), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

// comparison reads one comparison the way the engine's default computation would.
func comparison(t *testing.T, dir string, cache map[string]cachedFile) (Result, map[string]cachedFile) {
	t.Helper()
	res, next := computeGit(context.Background(), Key{Cwd: dir}, cache)
	if res.Err != nil {
		t.Fatalf("compare: %v", res.Err)
	}
	return res, next
}

func TestCompareSharesOneComputationBetweenSubscribers(t *testing.T) {
	engine := New()
	defer engine.Close()

	var mu sync.Mutex
	computations := 0
	engine.compute = func(_ context.Context, key Key, _ map[string]cachedFile) (Result, map[string]cachedFile) {
		mu.Lock()
		computations++
		mu.Unlock()
		return Result{Files: []workspace.ParsedDiffFile{{Path: key.Cwd}}}, map[string]cachedFile{}
	}

	first := make(chan Result, 4)
	second := make(chan Result, 4)
	one := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { first <- result })
	defer one.Unsubscribe()
	two := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { second <- result })
	defer two.Unsubscribe()

	// The first subscriber is reason enough to compute; the second joins that computation.
	a, b := waitRevisions(t, first, second)
	if a.Revision != b.Revision || a.Revision != 1 {
		t.Fatalf("revisions = %d and %d, want both at 1", a.Revision, b.Revision)
	}
	mu.Lock()
	got := computations
	mu.Unlock()
	if got != 1 {
		t.Fatalf("computations = %d, want 1 shared computation", got)
	}

	engine.Invalidate(Key{Cwd: "one"})
	waitRevisions(t, first, second)
	mu.Lock()
	got = computations
	mu.Unlock()
	if got != 2 {
		t.Fatalf("computations = %d, want one per change, not one per subscriber", got)
	}
}

// waitRevisions waits for one delivery on each channel.
func waitRevisions(t *testing.T, channels ...chan Result) (Result, Result) {
	t.Helper()
	results := make([]Result, len(channels))
	for i, ch := range channels {
		select {
		case results[i] = <-ch:
		case <-time.After(5 * time.Second):
			t.Fatalf("no delivery on channel %d", i)
		}
	}
	return results[0], results[1]
}

func TestBurstOfChangesComputesOnce(t *testing.T) {
	engine := New()
	defer engine.Close()
	engine.coalesce = 20 * time.Millisecond

	var mu sync.Mutex
	computations := 0
	engine.compute = func(context.Context, Key, map[string]cachedFile) (Result, map[string]cachedFile) {
		mu.Lock()
		computations++
		mu.Unlock()
		return Result{}, map[string]cachedFile{}
	}

	delivered := make(chan Result, 8)
	sub := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { delivered <- result })
	defer sub.Unsubscribe()

	for i := 0; i < 5; i++ {
		engine.Invalidate(Key{Cwd: "one"})
	}
	select {
	case <-delivered:
	case <-time.After(5 * time.Second):
		t.Fatal("the burst never produced a result")
	}
	mu.Lock()
	got := computations
	mu.Unlock()
	if got != 1 {
		t.Fatalf("computations = %d, want one for a burst inside one window", got)
	}
}

func TestChangeDuringComputationDiscardsTheStaleResult(t *testing.T) {
	engine := New()
	defer engine.Close()
	engine.coalesce = time.Millisecond

	started := make(chan string, 2)
	release := make(chan struct{})
	var mu sync.Mutex
	computations := 0
	engine.compute = func(_ context.Context, _ Key, _ map[string]cachedFile) (Result, map[string]cachedFile) {
		mu.Lock()
		computations++
		current := computations
		mu.Unlock()
		label := "first"
		if current > 1 {
			label = "second"
		}
		started <- label
		if label == "first" {
			<-release
		}
		return Result{Changed: []string{label}}, map[string]cachedFile{}
	}

	delivered := make(chan Result, 8)
	sub := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { delivered <- result })
	defer sub.Unsubscribe()

	engine.Invalidate(Key{Cwd: "one"})
	select {
	case label := <-started:
		if label != "first" {
			t.Fatalf("first computation ran as %q", label)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the first computation never started")
	}

	// A change lands while the computation is in flight: its result describes a checkout that no
	// longer exists, so it must never reach a subscriber.
	engine.Invalidate(Key{Cwd: "one"})
	close(release)

	var revisions []Result
	deadline := time.After(5 * time.Second)
	for len(revisions) < 2 {
		select {
		case result := <-delivered:
			revisions = append(revisions, result)
		case <-deadline:
			if len(revisions) == 0 {
				t.Fatal("the second computation never delivered")
			}
			goto assert
		}
	}
assert:
	if len(revisions) == 0 {
		t.Fatal("no deliveries")
	}
	for _, result := range revisions {
		if reflect.DeepEqual(result.Changed, []string{"first"}) {
			t.Fatalf("the stale computation was delivered: %+v", result)
		}
	}
	if len(revisions) != 1 || revisions[0].Changed[0] != "second" {
		t.Fatalf("deliveries = %+v, want exactly the second computation", revisions)
	}
}

func TestLateSubscriberIsReplayedTheCommittedResult(t *testing.T) {
	engine := New()
	defer engine.Close()

	next := Result{Files: []workspace.ParsedDiffFile{{Path: "a.txt"}}}
	engine.compute = func(context.Context, Key, map[string]cachedFile) (Result, map[string]cachedFile) {
		return next, map[string]cachedFile{}
	}

	first := make(chan Result, 4)
	sub := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { first <- result })
	defer sub.Unsubscribe()
	engine.Invalidate(Key{Cwd: "one"})
	select {
	case <-first:
	case <-time.After(5 * time.Second):
		t.Fatal("the first subscriber never got the result")
	}

	replayed := make(chan Result, 1)
	late := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { replayed <- result })
	defer late.Unsubscribe()
	select {
	case result := <-replayed:
		if !reflect.DeepEqual(result.Files, next.Files) || result.Revision != 1 {
			t.Fatalf("replay = %+v, want the committed revision", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a late subscriber was not replayed the committed result")
	}
}

func TestComparisonErrorKeepsTheSubscriptionOpen(t *testing.T) {
	engine := New()
	defer engine.Close()

	broken := true
	engine.compute = func(context.Context, Key, map[string]cachedFile) (Result, map[string]cachedFile) {
		if broken {
			return Result{Err: os.ErrNotExist}, map[string]cachedFile{}
		}
		return Result{Files: []workspace.ParsedDiffFile{{Path: "a.txt"}}}, map[string]cachedFile{}
	}

	delivered := make(chan Result, 4)
	sub := engine.Subscribe(Key{Cwd: "one"}, func(result Result) { delivered <- result })
	defer sub.Unsubscribe()

	engine.Invalidate(Key{Cwd: "one"})
	select {
	case result := <-delivered:
		if result.Err == nil {
			t.Fatalf("result = %+v, want the comparison error", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the error was not delivered")
	}

	broken = false
	engine.Invalidate(Key{Cwd: "one"})
	select {
	case result := <-delivered:
		if result.Err != nil || len(result.Files) != 1 {
			t.Fatalf("result after the repair = %+v, want files", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a repaired comparison never delivered")
	}
}

func TestBrokenBaseKeepsTheSubscriptionOpen(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\ncommitted\n")
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-m", "second"}} {
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	engine := New()
	defer engine.Close()
	key := Key{Cwd: dir, Base: "later", Committed: true}
	delivered := make(chan Result, 4)
	sub := engine.Subscribe(key, func(result Result) { delivered <- result })
	defer sub.Unsubscribe()

	// A base ref that does not exist yet is reported, not swallowed: the panel shows the error
	// and the subscription stays open for the branch to appear.
	engine.Invalidate(key)
	select {
	case result := <-delivered:
		if result.Err == nil {
			t.Fatalf("result = %+v, want the missing base reported", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the missing base was not reported")
	}

	if out, err := exec.Command("git", "-C", dir, "branch", "later", "HEAD~1").CombinedOutput(); err != nil {
		t.Fatalf("git branch: %v\n%s", err, out)
	}
	engine.Invalidate(key)
	select {
	case result := <-delivered:
		if result.Err != nil {
			t.Fatalf("result after the base appeared = %v", result.Err)
		}
		if len(result.Files) != 1 || result.Files[0].Path != "a.txt" {
			t.Fatalf("files = %+v, want a.txt", result.Files)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the repaired base never delivered")
	}
}

func TestContentIdenticalWriteReusesTheCachedBody(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")

	first, cache := comparison(t, dir, nil)
	if len(first.Changed) != 1 || first.Changed[0] != "a.txt" {
		t.Fatalf("first change list = %v, want [a.txt]", first.Changed)
	}

	// Same bytes, new mtime: git sees no change, so the identity must not either.
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	second, _ := comparison(t, dir, cache)
	if len(second.Changed) != 0 {
		t.Fatalf("change list after an identical write = %v, want none", second.Changed)
	}
	if !reflect.DeepEqual(second.Files, first.Files) {
		t.Fatalf("files changed without a change: %+v vs %+v", second.Files, first.Files)
	}
}

func TestAttributesChangeRereadsOnlyTheAffectedFiles(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	writeRepoFile(t, dir, "b.txt", "two\nchanged\n")

	_, cache := comparison(t, dir, nil)

	// A committed attribute file avoids the change list counting the file itself as untracked.
	writeRepoFile(t, dir, ".gitattributes", "b.txt -diff\n")
	if out, err := exec.Command("git", "-C", dir, "add", ".gitattributes").CombinedOutput(); err != nil {
		t.Fatalf("git add: %v\n%s", err, out)
	}
	if out, err := exec.Command("git", "-C", dir, "commit", "-m", "attributes").CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}

	second, _ := comparison(t, dir, cache)
	sort.Strings(second.Changed)
	// The attribute file itself is committed, so only the file whose attributes moved is re-read.
	want := []string{"b.txt"}
	if !reflect.DeepEqual(second.Changed, want) {
		t.Fatalf("change list after the attribute edit = %v, want %v", second.Changed, want)
	}
}

func TestConfigurationChangeRereadsEveryCachedBody(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	_, cache := comparison(t, dir, nil)

	// Config decides how a file is interpreted (filters, eol, binary detection); a change to it
	// invalidates every cached body, because no path's identity can promise its rendering.
	if out, err := exec.Command("git", "-C", dir, "config", "core.autocrlf", "input").CombinedOutput(); err != nil {
		t.Fatalf("git config: %v\n%s", err, out)
	}
	second, _ := comparison(t, dir, cache)
	if len(second.Changed) != 1 || second.Changed[0] != "a.txt" {
		t.Fatalf("change list after a config edit = %v, want [a.txt]", second.Changed)
	}
}

func TestEditedFileIsReread(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\nfirst\n")
	_, cache := comparison(t, dir, nil)

	// The blob is the content signal: without it, an edit at an unchanged path, mode and status
	// keeps the old body on screen.
	writeRepoFile(t, dir, "a.txt", "one\nsecond\n")
	second, _ := comparison(t, dir, cache)
	if len(second.Changed) != 1 || second.Changed[0] != "a.txt" {
		t.Fatalf("change list after an edit = %v, want [a.txt]", second.Changed)
	}
}

func TestBaseComparisonFollowsNewCommits(t *testing.T) {
	dir := gitRepo(t)
	commit := func(message string) {
		t.Helper()
		for _, args := range [][]string{{"add", "-A"}, {"commit", "-m", message}} {
			if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
				t.Fatalf("git %v: %v\n%s", args, err, out)
			}
		}
	}
	writeRepoFile(t, dir, "a.txt", "one\nfirst\n")
	commit("first")
	base := "HEAD~1"

	key := Key{Cwd: dir, Base: base, Committed: true}
	first, next := computeGit(context.Background(), key, nil)
	if first.Err != nil {
		t.Fatalf("compare: %v", first.Err)
	}
	writeRepoFile(t, dir, "a.txt", "one\nsecond\n")
	commit("second")

	// Both sides of a commit comparison move when a new commit lands; an identity built only from
	// the path, mode and status would serve the previous commit's body.
	second, _ := computeGit(context.Background(), key, next)
	if second.Err != nil {
		t.Fatalf("compare: %v", second.Err)
	}
	if len(second.Changed) != 1 || second.Changed[0] != "a.txt" {
		t.Fatalf("change list after a new commit = %v, want [a.txt]", second.Changed)
	}
	if body := bodyOf(second, "a.txt"); !strings.Contains(body, "second") {
		t.Fatalf("body = %q, want the new commit's content", body)
	}
}

// bodyOf joins one file's hunk lines, so a test can look for content the way the panel shows it.
func bodyOf(result Result, path string) string {
	var lines []string
	for _, file := range result.Files {
		if file.Path != path {
			continue
		}
		for _, hunk := range file.Hunks {
			for _, line := range hunk.Lines {
				lines = append(lines, line.Content)
			}
		}
	}
	return strings.Join(lines, "\n")
}

func TestUntrackedFileContentChangeIsDetected(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "new.txt", "one\n")
	first, cache := comparison(t, dir, nil)
	if len(first.Changed) != 1 || first.Changed[0] != "new.txt" {
		t.Fatalf("first change list = %v, want [new.txt]", first.Changed)
	}

	// git has no blob for an untracked file, so its content is the only signal it changed.
	writeRepoFile(t, dir, "new.txt", "one\n")
	second, cache := comparison(t, dir, cache)
	if len(second.Changed) != 0 {
		t.Fatalf("change list after an identical rewrite = %v, want none", second.Changed)
	}
	writeRepoFile(t, dir, "new.txt", "two\n")
	third, _ := comparison(t, dir, cache)
	if len(third.Changed) != 1 || third.Changed[0] != "new.txt" {
		t.Fatalf("change list after an untracked rewrite = %v, want [new.txt]", third.Changed)
	}
}

func TestModeOnlyChangeIsNotMissed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the executable bit is not a Windows file mode")
	}
	dir := gitRepo(t)
	// A checkout can have core.fileMode off; this test needs git to report the bit it is given.
	if out, err := exec.Command("git", "-C", dir, "config", "core.fileMode", "true").CombinedOutput(); err != nil {
		t.Fatalf("git config: %v\n%s", err, out)
	}
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	if err := os.Chmod(filepath.Join(dir, "a.txt"), 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	_, cache := comparison(t, dir, nil)

	// Executable to plain keeps both blobs and the status: only the mode moved, and the body
	// carries the "old mode"/"new mode" lines for it.
	if err := os.Chmod(filepath.Join(dir, "a.txt"), 0o644); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	second, _ := comparison(t, dir, cache)
	if len(second.Changed) != 1 || second.Changed[0] != "a.txt" {
		t.Fatalf("change list after a mode-only change = %v, want [a.txt]", second.Changed)
	}
}

func TestDeletedAndRecreatedFileKeepsItsIdentity(t *testing.T) {
	dir := gitRepo(t)
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	first, cache := comparison(t, dir, nil)

	if err := os.Remove(filepath.Join(dir, "a.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	second, _ := comparison(t, dir, cache)
	if len(second.Changed) != 0 {
		t.Fatalf("change list after recreating identical content = %v, want none", second.Changed)
	}
	if !reflect.DeepEqual(second.Files, first.Files) {
		t.Fatalf("files changed for identical content: %+v vs %+v", second.Files, first.Files)
	}
}

func TestSymlinkedFileIsReadAsALink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a privilege the test runner does not have")
	}
	dir := gitRepo(t)
	writeRepoFile(t, dir, "target.txt", "target\n")
	writeRepoFile(t, dir, "a.txt", "one\nchanged\n")
	_, cache := comparison(t, dir, nil)

	if err := os.Remove(filepath.Join(dir, "a.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := os.Symlink("target.txt", filepath.Join(dir, "a.txt")); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	second, _ := comparison(t, dir, cache)
	sort.Strings(second.Changed)
	want := []string{"a.txt", "target.txt"}
	if !reflect.DeepEqual(second.Changed, want) {
		t.Fatalf("change list after replacing the file with a symlink = %v, want %v", second.Changed, want)
	}
}

func TestBudgetsTruncateRatherThanFail(t *testing.T) {
	big := workspace.ParsedDiffFile{
		Path: "big.txt",
		Hunks: []workspace.DiffHunk{{Lines: []workspace.DiffLine{
			{Type: "add", Content: strings.Repeat("x", MaxTotalBytes)},
		}}},
	}
	kept, omitted, tooLarge := applyBudget([]workspace.ParsedDiffFile{{Path: "a.txt"}, big})
	if !tooLarge || omitted != 1 || len(kept) != 1 || kept[0].Path != "a.txt" {
		t.Fatalf("budget result = %v, %d omitted, tooLarge=%v", kept, omitted, tooLarge)
	}

	many := make([]workspace.ParsedDiffFile, MaxFiles+1)
	for i := range many {
		many[i] = workspace.ParsedDiffFile{Path: "f"}
	}
	kept, omitted, tooLarge = applyBudget(many)
	if !tooLarge || omitted != 1 || len(kept) != MaxFiles {
		t.Fatalf("file budget result = %d kept, %d omitted, tooLarge=%v", len(kept), omitted, tooLarge)
	}
}
