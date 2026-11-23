// Package gitdiff computes a checkout comparison once per comparison key.
//
// The daemon used to run the whole `git diff` for every open pane every second: two panes on one
// checkout paid twice for the same answer, and an unchanged file was read as often as a changed
// one. A comparison is a target here — one computation shared by every subscriber, carrying a
// revision and a per-file identity so only the files that moved are read again. Observation feeds
// the invalidation; the engine itself watches nothing.
package gitdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

const (
	// CoalesceWindow is how long a target waits after a change before recomputing, so a burst of
	// writes costs one comparison instead of one per write.
	CoalesceWindow = 150 * time.Millisecond

	// MaxFiles and MaxTotalBytes bound one result. A comparison past them is delivered truncated
	// with DiffTooLarge set rather than growing without limit: the client renders every file it
	// receives.
	MaxFiles      = 10_000
	MaxTotalBytes = 8 << 20

	// maxUntrackedBytes matches GetWorkingDiff's cap on an untracked file.
	maxUntrackedBytes = 256 * 1024

	// pathBatch is how many paths one git call names. The paths travel as arguments, and a command
	// line past the platform limit fails the whole comparison.
	pathBatch = 100
)

// Key identifies one comparison. The resolved commits are not part of it: the same key keeps its
// revision across a ref move, and each Result names the commits it was taken from.
type Key struct {
	Cwd string
	// Base is the ref the commits are compared against. Ignored unless Committed.
	Base string
	// Committed asks for the branch's own commits (`git diff <base>...HEAD`) instead of the
	// working tree. An empty Base then means the checkout's default base, resolved on every
	// computation because a fetch or a new branch can move it.
	Committed        bool
	IgnoreWhitespace bool
}

// Resolved names the commits a result was taken from.
type Resolved struct {
	BaseSha      string
	HeadSha      string
	MergeBaseSha string
}

// Result is one committed revision of a comparison.
type Result struct {
	Revision uint64
	Resolved Resolved
	Files    []workspace.ParsedDiffFile
	// Changed lists the paths whose body this revision read again. A client that kept the previous
	// revision only needs those.
	Changed []string
	// Omitted counts the files the budgets left out of Files.
	Omitted      int
	DiffTooLarge bool
	// Err reports a comparison that could not be taken. The subscription stays open: a base ref
	// that does not resolve yet is a repair away from delivering files.
	Err error
}

// Engine holds the live comparisons. One engine serves the whole daemon.
type Engine struct {
	mu       sync.Mutex
	targets  map[Key]*target
	coalesce time.Duration
	ctx      context.Context
	cancel   context.CancelFunc

	// compute is the comparison itself; tests replace it to count computations without git.
	compute func(ctx context.Context, key Key, cache map[string]cachedFile) (Result, map[string]cachedFile)
}

// New returns an engine that owns its comparisons until Close.
func New() *Engine {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{targets: map[Key]*target{}, coalesce: CoalesceWindow, ctx: ctx, cancel: cancel}
	e.compute = computeGit
	return e
}

// Close stops every target. A computation still running discards its result.
func (e *Engine) Close() {
	e.cancel()
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, t := range e.targets {
		if t.timer != nil {
			t.timer.Stop()
			t.timer = nil
		}
	}
	e.targets = map[Key]*target{}
}

// Subscription is one listener on one comparison.
type Subscription struct {
	engine   *Engine
	key      Key
	deliver  func(Result)
	released bool
}

// Subscribe registers deliver for key and replays the committed result, if there is one, so a late
// subscriber does not wait for the next change.
func (e *Engine) Subscribe(key Key, deliver func(Result)) *Subscription {
	sub := &Subscription{engine: e, key: key, deliver: deliver}
	e.mu.Lock()
	t := e.targets[key]
	if t == nil {
		t = &target{engine: e, key: key, subs: map[*Subscription]struct{}{}, cache: map[string]cachedFile{}}
		e.targets[key] = t
	}
	t.subs[sub] = struct{}{}
	committed := t.committed
	if committed == nil && !t.running && t.timer == nil {
		// Nobody has computed this comparison yet: the first subscriber is the reason to.
		t.timer = time.AfterFunc(e.coalesce, t.flush)
	}
	e.mu.Unlock()
	if committed != nil {
		deliver(*committed)
	}
	return sub
}

// Unsubscribe drops this listener; the last one takes the target with it.
func (s *Subscription) Unsubscribe() {
	e := s.engine
	e.mu.Lock()
	defer e.mu.Unlock()
	if s.released {
		return
	}
	s.released = true
	t := e.targets[s.key]
	if t == nil {
		return
	}
	delete(t.subs, s)
	if len(t.subs) > 0 {
		return
	}
	if t.timer != nil {
		t.timer.Stop()
		t.timer = nil
	}
	delete(e.targets, s.key)
}

// Invalidate marks one comparison dirty.
func (e *Engine) Invalidate(key Key) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if t := e.targets[key]; t != nil {
		t.invalidateLocked(e.coalesce)
	}
}

// InvalidateCwd marks every comparison on one checkout dirty.
func (e *Engine) InvalidateCwd(cwd string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	canonical := workspace.CanonicalCwd(cwd)
	for key, t := range e.targets {
		if key.Cwd == canonical {
			t.invalidateLocked(e.coalesce)
		}
	}
}

// cachedFile is one file's body at a known identity.
type cachedFile struct {
	identity string
	file     workspace.ParsedDiffFile
	bytes    int
}

// target is one comparison and its subscribers. Every field is guarded by the engine lock.
type target struct {
	engine *Engine
	key    Key
	subs   map[*Subscription]struct{}
	cache  map[string]cachedFile

	revision  uint64
	committed *Result

	// generation moves on every invalidation. A computation carries the generation it started
	// with and commits only if that is still the current one: a result computed against a
	// checkout that changed underneath describes a state the user never saw.
	generation uint64
	running    bool
	timer      *time.Timer
}

func (t *target) invalidateLocked(window time.Duration) {
	t.generation++
	if t.running || t.timer != nil {
		// A running computation sees the moved generation and reschedules; a pending timer picks
		// the new generation up when it fires.
		return
	}
	t.timer = time.AfterFunc(window, t.flush)
}

// flush recomputes and delivers, unless a newer generation has made the work pointless.
func (t *target) flush() {
	e := t.engine
	e.mu.Lock()
	t.timer = nil
	if t.running {
		e.mu.Unlock()
		return
	}
	t.running = true
	generation := t.generation
	cache := t.cache
	e.mu.Unlock()

	result, next := e.compute(e.ctx, t.key, cache)

	e.mu.Lock()
	t.running = false
	if generation != t.generation {
		if t.timer == nil {
			t.timer = time.AfterFunc(e.coalesce, t.flush)
		}
		e.mu.Unlock()
		return
	}
	t.cache = next
	t.revision++
	result.Revision = t.revision
	t.committed = &result
	subs := make([]*Subscription, 0, len(t.subs))
	for sub := range t.subs {
		subs = append(subs, sub)
	}
	e.mu.Unlock()
	for _, sub := range subs {
		sub.deliver(result)
	}
}

// rawEntry is one `git diff --raw` record.
type rawEntry struct {
	oldMode, newMode string
	oldSha, newSha   string
	status           string
	path, oldPath    string
}

// computeGit reads the comparison from git.
func computeGit(ctx context.Context, key Key, cache map[string]cachedFile) (Result, map[string]cachedFile) {
	var res Result
	cwd := key.Cwd

	headSha, err := workspace.Git(ctx, cwd, "rev-parse", "HEAD")
	if err != nil {
		res.Err = fmt.Errorf("resolve HEAD: %w", err)
		return res, cache
	}
	diffTarget := "HEAD"
	res.Resolved = Resolved{BaseSha: headSha, HeadSha: headSha, MergeBaseSha: headSha}
	if key.Committed {
		base := strings.TrimSpace(key.Base)
		if base == "" {
			base = workspace.ResolveDiffBaseRef(ctx, cwd)
		}
		if base == "" {
			// No base to compare against: an empty comparison, not the whole repository against
			// the empty tree.
			res.Files = []workspace.ParsedDiffFile{}
			return res, cache
		}
		baseSha, err := workspace.Git(ctx, cwd, "rev-parse", base)
		if err != nil {
			res.Err = fmt.Errorf("resolve %s: %w", base, err)
			return res, cache
		}
		mergeBase, err := workspace.Git(ctx, cwd, "merge-base", base, "HEAD")
		if err != nil {
			res.Err = fmt.Errorf("merge base of %s: %w", base, err)
			return res, cache
		}
		res.Resolved.BaseSha = baseSha
		res.Resolved.MergeBaseSha = mergeBase
		diffTarget = base + "...HEAD"
	}

	// Config and attributes decide how git reads a file (filters, eol, binary detection), so they
	// are part of every file's identity. Without them a .gitattributes edit would leave cached
	// bodies that the repo no longer renders that way.
	config, err := workspace.Git(ctx, cwd, "config", "--null", "--list")
	if err != nil {
		res.Err = fmt.Errorf("read config: %w", err)
		return res, cache
	}
	configHash := shaOf(config)

	raw, err := workspace.Git(ctx, cwd, "diff", "--raw", "-z", "-M", diffTarget)
	if err != nil {
		res.Err = fmt.Errorf("list changes: %w", err)
		return res, cache
	}
	entries, err := parseRawZ(raw)
	if err != nil {
		res.Err = err
		return res, cache
	}

	var untracked []string
	if !key.Committed {
		out, err := workspace.Git(ctx, cwd, "ls-files", "--others", "--exclude-standard", "-z")
		if err != nil {
			res.Err = fmt.Errorf("list untracked files: %w", err)
			return res, cache
		}
		untracked = splitZ(out)
	}

	// The worktree side of a raw diff is reported with all-zero object ids, so the content
	// signal has to come from git itself: without it an edit at an unchanged path, mode and
	// status keeps the cached body forever.
	var worktreePaths []string
	for i := range entries {
		if isZeroSha(entries[i].newSha) {
			worktreePaths = append(worktreePaths, entries[i].path)
		}
	}
	worktreePaths = append(worktreePaths, untracked...)
	blobs := worktreeBlobs(ctx, cwd, worktreePaths)
	for i := range entries {
		if isZeroSha(entries[i].newSha) {
			if blob, ok := blobs[entries[i].path]; ok {
				entries[i].newSha = blob
			}
		}
	}

	paths := make([]string, 0, len(entries)+len(untracked))
	for _, entry := range entries {
		paths = append(paths, entry.path)
	}
	paths = append(paths, untracked...)
	attrs, err := attributeValues(ctx, cwd, paths)
	if err != nil {
		res.Err = fmt.Errorf("read attributes: %w", err)
		return res, cache
	}

	next := make(map[string]cachedFile, len(paths))
	files := make([]workspace.ParsedDiffFile, 0, len(paths))
	var reread []rawEntry
	for _, entry := range entries {
		identity := shaOf(configHash, attrs[entry.path], entry.oldMode, entry.newMode,
			entry.oldSha, entry.newSha, entry.status, entry.path, entry.oldPath)
		if cached, ok := cache[entry.path]; ok && cached.identity == identity {
			files = append(files, cached.file)
			next[entry.path] = cached
			continue
		}
		reread = append(reread, entry)
	}

	bodies, err := readHunkBodies(ctx, key, diffTarget, reread)
	if err != nil {
		res.Err = err
		return res, cache
	}
	for _, entry := range reread {
		file, ok := bodies[entry.path]
		if !ok {
			// A pathspec diff omits a file whose body did not change — a mode-only change is the
			// case — so the record comes from the raw listing instead.
			file = workspace.ParsedDiffFile{Path: entry.path, Status: "ok"}
		}
		if entry.oldPath != "" {
			file.OldPath = entry.oldPath
		}
		if entry.status[0] == 'R' || entry.status[0] == 'C' {
			if len(file.Hunks) == 0 {
				// A rename arrives as a header-only section. Diffing the destination on its own
				// shows the file's content under its new name, which is what the panel renders.
				renamed, readErr := readHunkBodies(ctx, key, diffTarget, []rawEntry{entry})
				if readErr == nil {
					if body, ok := renamed[entry.path]; ok && len(body.Hunks) > 0 {
						body.OldPath = entry.oldPath
						file = body
					}
				}
			}
		}
		identity := shaOf(configHash, attrs[entry.path], entry.oldMode, entry.newMode,
			entry.oldSha, entry.newSha, entry.status, entry.path, entry.oldPath)
		next[entry.path] = cachedFile{identity: identity, file: file, bytes: bodyBytes(file)}
		files = append(files, file)
		res.Changed = append(res.Changed, entry.path)
	}

	for _, rel := range untracked {
		absPath := filepath.Join(cwd, rel)
		rawBytes, readErr := os.ReadFile(absPath)
		if readErr != nil || len(rawBytes) > maxUntrackedBytes || bytes.IndexByte(rawBytes, 0) != -1 {
			continue
		}
		content := blobs[rel]
		if content == "" {
			content = shaOf(string(rawBytes))
		}
		identity := shaOf(configHash, attrs[rel], "untracked", content, rel)
		if cached, ok := cache[rel]; ok && cached.identity == identity {
			files = append(files, cached.file)
			next[rel] = cached
			continue
		}
		file := untrackedFile(rel, rawBytes)
		next[rel] = cachedFile{identity: identity, file: file, bytes: bodyBytes(file)}
		files = append(files, file)
		res.Changed = append(res.Changed, rel)
	}

	files, omitted, tooLarge := applyBudget(files)
	res.Files = files
	res.Omitted = omitted
	res.DiffTooLarge = tooLarge
	return res, next
}

// parseRawZ reads `git diff --raw -z` records:
// `:<old-mode> <new-mode> <old-sha> <new-sha> <status>\0<path>\0`, with a second path after the
// first for a rename or copy.
func parseRawZ(out string) ([]rawEntry, error) {
	fields := strings.Split(out, "\x00")
	entries := make([]rawEntry, 0, len(fields)/2)
	for i := 0; i < len(fields); i++ {
		meta := fields[i]
		if strings.TrimSpace(meta) == "" {
			continue
		}
		if !strings.HasPrefix(meta, ":") {
			return nil, fmt.Errorf("parse changes: unexpected %q", meta)
		}
		parts := strings.Fields(meta[1:])
		if len(parts) != 5 {
			return nil, fmt.Errorf("parse changes: unexpected metadata %q", meta)
		}
		entry := rawEntry{oldMode: parts[0], newMode: parts[1], oldSha: parts[2], newSha: parts[3], status: parts[4]}
		if i+1 >= len(fields) {
			break
		}
		i++
		entry.path = fields[i]
		if entry.status[0] == 'R' || entry.status[0] == 'C' {
			// A rename prints the source first and the destination second.
			if i+1 >= len(fields) {
				break
			}
			i++
			entry.oldPath = entry.path
			entry.path = fields[i]
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// attributeValues reads the `check-attr --all` answer for each path, in batches that fit a
// command line.
func attributeValues(ctx context.Context, cwd string, paths []string) (map[string]string, error) {
	values := make(map[string]string, len(paths))
	for start := 0; start < len(paths); start += pathBatch {
		end := start + pathBatch
		if end > len(paths) {
			end = len(paths)
		}
		args := append([]string{"check-attr", "--all", "-z", "--"}, paths[start:end]...)
		out, err := workspace.Git(ctx, cwd, args...)
		if err != nil {
			return nil, err
		}
		fields := splitZ(out)
		for i := 0; i+2 < len(fields); i += 3 {
			values[fields[i]] += fields[i+1] + "=" + fields[i+2] + "\x00"
		}
	}
	return values, nil
}

// readHunkBodies diffs the given paths and indexes the bodies by path.
func readHunkBodies(ctx context.Context, key Key, diffTarget string, entries []rawEntry) (map[string]workspace.ParsedDiffFile, error) {
	bodies := make(map[string]workspace.ParsedDiffFile, len(entries))
	for start := 0; start < len(entries); start += pathBatch {
		end := start + pathBatch
		if end > len(entries) {
			end = len(entries)
		}
		args := []string{"diff", "--no-color"}
		if key.IgnoreWhitespace {
			args = append(args, "-w")
		}
		args = append(args, diffTarget, "--")
		for _, entry := range entries[start:end] {
			args = append(args, entry.path)
		}
		out, err := workspace.Git(ctx, key.Cwd, args...)
		if err != nil {
			return nil, fmt.Errorf("diff: %w", err)
		}
		for _, file := range workspace.ParseUnifiedDiff(out) {
			bodies[file.Path] = file
		}
	}
	return bodies, nil
}

// untrackedFile builds the new-file diff an untracked file renders as, the same shape
// GetWorkingDiff produces.
func untrackedFile(rel string, raw []byte) workspace.ParsedDiffFile {
	contentLines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	lines := make([]workspace.DiffLine, 0, len(contentLines)+1)
	lines = append(lines, workspace.DiffLine{
		Type:    "header",
		Content: "@@ -0,0 +1," + strconv.Itoa(len(contentLines)) + " @@",
	})
	for _, line := range contentLines {
		lines = append(lines, workspace.DiffLine{Type: "add", Content: line})
	}
	return workspace.ParsedDiffFile{
		Path:      rel,
		IsNew:     true,
		Additions: len(contentLines),
		Hunks: []workspace.DiffHunk{{
			OldStart: 0,
			OldCount: 0,
			NewStart: 1,
			NewCount: len(contentLines),
			Lines:    lines,
		}},
		Status: "ok",
	}
}

// applyBudget drops files past the result budgets, reporting what was left out. It keeps the
// leading files rather than a sample: the client's list is ordered, and a partial answer that
// starts at the top is the one a reader can still use.
func applyBudget(files []workspace.ParsedDiffFile) ([]workspace.ParsedDiffFile, int, bool) {
	total := 0
	kept := files[:0]
	omitted := 0
	tooLarge := false
	for _, file := range files {
		size := bodyBytes(file)
		if len(kept) >= MaxFiles || total+size > MaxTotalBytes {
			omitted++
			tooLarge = true
			continue
		}
		total += size
		kept = append(kept, file)
	}
	return kept, omitted, tooLarge
}

// bodyBytes is what a file costs on the wire, near enough to compare against MaxTotalBytes.
func bodyBytes(file workspace.ParsedDiffFile) int {
	size := len(file.Path) + len(file.OldPath)
	for _, hunk := range file.Hunks {
		for _, line := range hunk.Lines {
			size += len(line.Content)
		}
	}
	return size
}

// splitZ splits NUL-separated git output, dropping the empty tail.
func splitZ(out string) []string {
	parts := strings.Split(out, "\x00")
	kept := parts[:0]
	for _, part := range parts {
		if part != "" {
			kept = append(kept, part)
		}
	}
	return kept
}

// isZeroSha reports the object id git uses for a side it did not read.
func isZeroSha(sha string) bool {
	return sha != "" && strings.Trim(sha, "0") == ""
}

// worktreeBlobs answers the blob id git would store for each working-tree path. One process
// covers the whole comparison; a batch aborted by an unreadable file (a deletion is the usual
// case) falls back to one call per path, so one missing file cannot cost the rest their identity.
func worktreeBlobs(ctx context.Context, cwd string, paths []string) map[string]string {
	blobs := make(map[string]string, len(paths))
	if len(paths) == 0 {
		return blobs
	}
	out, err := workspace.GitWithInput(ctx, cwd, strings.Join(paths, "\n")+"\n", "hash-object", "--stdin-paths")
	if hashes := strings.Fields(out); err == nil && len(hashes) == len(paths) {
		for i, path := range paths {
			blobs[path] = hashes[i]
		}
		return blobs
	}
	for _, path := range paths {
		if blob, blobErr := workspace.Git(ctx, cwd, "hash-object", "--", path); blobErr == nil {
			blobs[path] = strings.TrimSpace(blob)
		}
	}
	return blobs
}

// shaOf hashes the identity parts. Every input is length-prefixed so a path containing the
// separator cannot pretend to be another part.
func shaOf(parts ...string) string {
	sum := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(sum, "%d:%s;", len(part), part)
	}
	return hex.EncodeToString(sum.Sum(nil))
}
