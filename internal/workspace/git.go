package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// git prints %(upstream:track) as "ahead 3, behind 2", either half omitted when it is zero.
var (
	aheadTrackPattern  = regexp.MustCompile(`ahead (\d+)`)
	behindTrackPattern = regexp.MustCompile(`behind (\d+)`)
)

type CheckoutStatus struct {
	Cwd           string  `json:"cwd"`
	IsGit         bool    `json:"isGit"`
	RepoRoot      *string `json:"repoRoot"`
	CurrentBranch *string `json:"currentBranch"`
	IsDirty       *bool   `json:"isDirty"`
	BaseRef       *string `json:"baseRef"`
	// UpstreamRef is the full ref currentBranch tracks, as git reports it for `<branch>@{upstream}`:
	// "refs/remotes/origin/main", "refs/remotes/upstream/main" on a fork, or a "refs/heads/..." ref
	// for a branch tracking a local branch. Null when there is no upstream.
	//
	// The new-workspace picker uses it verbatim to decide where a fresh worktree starts. Composing
	// the ref from "origin/" + branch is wrong twice over: the remote is not always origin, and the
	// upstream branch can be named differently. Without it the picker fell back to the local ref and
	// carried unpushed commits into every new worktree.
	UpstreamRef            *string `json:"upstreamRef"`
	AheadBehind            any     `json:"aheadBehind"`
	AheadOfOrigin          *int    `json:"aheadOfOrigin"`
	BehindOfOrigin         *int    `json:"behindOfOrigin"`
	HasRemote              bool    `json:"hasRemote"`
	RemoteURL              *string `json:"remoteUrl"`
	IsBySpaceOwnedWorktree bool    `json:"isBySpaceOwnedWorktree"`
	Error                  any     `json:"error"`
	// No omitempty: the protocol requires requestId as a string, and an omitted key is undefined.
	// A broadcast has no request to name, so it carries the empty string — which the schema accepts.
	RequestID string `json:"requestId"`
}

type CommitFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // "added" | "modified" | "deleted" | "renamed"
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type Commit struct {
	Sha        string       `json:"sha"`
	ShortSha   string       `json:"shortSha"`
	Subject    string       `json:"subject"`
	AuthorName string       `json:"authorName"`
	AuthorDate string       `json:"authorDate"`
	IsOnRemote bool         `json:"isOnRemote"`
	IsOnBase   bool         `json:"isOnBase"`
	Files      []CommitFile `json:"files"`
}

// MaxDiffLineChars bounds the content of one diff line.
//
// A minified bundle or a one-line JSON file is a single line of hundreds of thousands of
// characters. Highlighting it blocks the renderer, and the user cannot read one line that long
// anyway — the client shows the truncated line with a marker rather than freezing.
//
// Ported from MAX_DIFF_HIGHLIGHT_LINE_CHARS in diff-highlighter.ts.
const MaxDiffLineChars = 10000

type DiffLine struct {
	Type    string `json:"type"` // "add" | "remove" | "context" | "header"
	Content string `json:"content"`
}

type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldCount int        `json:"oldCount"`
	NewStart int        `json:"newStart"`
	NewCount int        `json:"newCount"`
	Lines    []DiffLine `json:"lines"`
}

type ParsedDiffFile struct {
	Path string `json:"path"`
	// OldPath is set only for renames and copies, and is what the client needs to revert one:
	// `git checkout -- <new>` alone leaves the old path deleted.
	OldPath   string     `json:"oldPath,omitempty"`
	IsNew     bool       `json:"isNew"`
	IsDeleted bool       `json:"isDeleted"`
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	Hunks     []DiffHunk `json:"hunks"`
	Status    string     `json:"status,omitempty"`
}

type WorktreeEntry struct {
	WorktreePath string `json:"worktreePath"`
	Branch       string `json:"branch"`
	HeadSha      string `json:"headSha"`
}

// gitLocalTimeout bounds commands that only read local state.
const gitLocalTimeout = 10 * time.Second

// gitNetworkTimeout bounds commands that talk to a remote.
//
// A single timeout for everything made `git pull`/`fetch` fail after 5s on any real network —
// and reported it as an opaque context deadline. The node daemon allows 120s for a fetch.
const gitNetworkTimeout = 120 * time.Second

// gitNetworkCommands need the longer budget and must never block on a credential prompt.
var gitNetworkCommands = map[string]bool{
	"pull":      true,
	"fetch":     true,
	"push":      true,
	"clone":     true,
	"ls-remote": true,
}

func runGit(ctx context.Context, cwd string, args ...string) (string, error) {
	timeout := gitLocalTimeout
	if len(args) > 0 && gitNetworkCommands[args[0]] {
		timeout = gitNetworkTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// Bounded: the daemon polls every subscribed workspace each second, and an unbounded burst
	// of git processes makes the machine stutter and queues the user's own git commands behind
	// ours.
	release, acquireErr := acquireGitSlot(cctx)
	if acquireErr != nil {
		return "", acquireErr
	}
	defer release()
	cmd := exec.CommandContext(cctx, "git", args...)
	cmd.Dir = cwd
	// GIT_TERMINAL_PROMPT=0: a fetch against a repository that needs credentials would
	// otherwise sit waiting for a prompt nobody can answer, until the timeout fires.
	cmd.Env = append(cmd.Environ(),
		"GIT_OPTIONAL_LOCKS=0",
		"LC_ALL=C",
		"GIT_TERMINAL_PROMPT=0",
		// Never let git fall back to an interactive pager in a daemon context.
		"GIT_PAGER=cat",
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	startedAt := time.Now()
	err := cmd.Run()
	traceGitCommand(cwd, args, startedAt, time.Since(startedAt), out.String(), err)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out.String()), nil
}

// traceGitCommand appends one JSON line per git invocation when BYSPACE_GIT_TRACE_FILE is set.
//
// The daemon runs git on a timer, several at a time, and a workspace that feels slow gives no clue
// which of them is responsible. This is the same escape hatch the node daemon has, so a support
// session that already knows how to read the trace keeps working.
//
// Failures here are swallowed on purpose: tracing must never change what the command returns.
func traceGitCommand(cwd string, args []string, startedAt time.Time, elapsed time.Duration, stdout string, err error) {
	path := strings.TrimSpace(os.Getenv("BYSPACE_GIT_TRACE_FILE"))
	if path == "" {
		return
	}
	entry := map[string]any{
		"cwd":         cwd,
		"args":        args,
		"startedAtMs": startedAt.UnixMilli(),
		"durationMs":  elapsed.Milliseconds(),
		"ok":          err == nil,
		"stdoutBytes": len(stdout),
	}
	if err != nil {
		entry["error"] = err.Error()
	}
	line, marshalErr := json.Marshal(entry)
	if marshalErr != nil {
		return
	}
	traceMu.Lock()
	defer traceMu.Unlock()
	f, openErr := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if openErr != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

var traceMu sync.Mutex

// GetCheckoutStatus inspects the git repository at cwd and builds a CheckoutStatus payload.
func GetCheckoutStatus(ctx context.Context, cwd, requestID string) CheckoutStatus {
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		absCwd = cwd
	}
	if strings.HasSuffix(filepath.Clean(absCwd), string(filepath.Separator)+"chief") {
		return CheckoutStatus{
			Cwd:       cwd,
			IsGit:     false,
			HasRemote: false,
			RequestID: requestID,
		}
	}
	topLevel, err := runGit(ctx, absCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return CheckoutStatus{
			Cwd:       cwd,
			IsGit:     false,
			HasRemote: false,
			RequestID: requestID,
		}
	}

	branch, _ := runGit(ctx, absCwd, "symbolic-ref", "--quiet", "--short", "HEAD")
	var branchPtr *string
	if branch != "" {
		branchPtr = &branch
	}

	porcelain, _ := runGit(ctx, absCwd, "status", "--porcelain")
	dirty := porcelain != ""

	// The diff pane decides which comparison to show from this pair: `ahead > 0` on a clean tree is
	// what makes the "See committed changes" link appear, and its absence left the uncommitted view
	// stuck on "No changes to display" with no way out. Measured against the base branch the panel
	// compares with, not against the upstream, which is a different question.
	var baseRefPtr *string
	var aheadBehind any
	if dirty {
		// A dirty tree has uncommitted work, so the uncommitted view is never empty and the
		// comparison stays put until the user asks otherwise; no base comparison is needed.
		aheadBehind = nil
	} else if base := ResolveDiffBaseRef(ctx, absCwd); base != "" {
		baseRefPtr = &base
		if branch != "" && base != branch {
			if out, behindErr := runGit(ctx, absCwd, "rev-list", "--left-right", "--count", base+"..."+branch); behindErr == nil {
				if fields := strings.Fields(out); len(fields) == 2 {
					behind, behindErr := strconv.Atoi(fields[0])
					ahead, aheadErr := strconv.Atoi(fields[1])
					if behindErr == nil && aheadErr == nil {
						aheadBehind = map[string]int{"ahead": ahead, "behind": behind}
					}
				}
			}
		}
	}

	remoteURL := OriginRemoteURL(ctx, absCwd)
	hasRemote := remoteURL != ""
	var remotePtr *string
	if hasRemote {
		remotePtr = &remoteURL
	}

	// The upstream is read from git rather than composed: on a fork the remote is "upstream", and
	// the tracking branch is not always named after the local one.
	var upstreamRefPtr *string
	var aheadOfOriginPtr, behindOfOriginPtr *int
	if branch != "" {
		if ref, ahead, behind, ok := upstreamStatus(ctx, absCwd, branch); ok {
			upstreamRefPtr = &ref
			aheadOfOriginPtr = &ahead
			behindOfOriginPtr = &behind
		}
	}

	return CheckoutStatus{
		Cwd:                    cwd,
		IsGit:                  true,
		RepoRoot:               &topLevel,
		CurrentBranch:          branchPtr,
		IsDirty:                &dirty,
		BaseRef:                baseRefPtr,
		UpstreamRef:            upstreamRefPtr,
		AheadBehind:            aheadBehind,
		AheadOfOrigin:          aheadOfOriginPtr,
		BehindOfOrigin:         behindOfOriginPtr,
		HasRemote:              hasRemote,
		RemoteURL:              remotePtr,
		IsBySpaceOwnedWorktree: false,
		RequestID:              requestID,
	}
}

// upstreamStatus reports the branch's upstream ref and how far the branch has diverged from it.
//
// The divergence is what the archive confirmation reads: "1 unpushed commit" is the difference
// between deleting a worktree and deleting work. git already tracks both halves — the tracking ref
// via %(upstream) and the counts via %(upstream:track) — so they are read together in one call
// instead of a second rev-list.
//
// A branch with no configured upstream falls back to origin/<branch> when that ref exists, because
// a freshly created worktree usually has one and no tracking config. A branch whose upstream is gone
// reports nothing: 0/0 would read as "in sync" for a branch that cannot be pushed at all.
func upstreamStatus(ctx context.Context, cwd, branch string) (string, int, int, bool) {
	out, err := runGit(ctx, cwd, "for-each-ref", "--format=%(upstream)%00%(upstream:track,nobracket)",
		"refs/heads/"+branch)
	if err != nil {
		return "", 0, 0, false
	}
	ref, track, _ := strings.Cut(strings.TrimSpace(out), "\x00")
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return sameNameOriginStatus(ctx, cwd, branch)
	}
	if track == "gone" {
		return "", 0, 0, false
	}
	return ref, trackAhead(track), trackBehind(track), true
}

// sameNameOriginStatus measures a branch against origin/<branch> when git has no upstream configured
// for it.
func sameNameOriginStatus(ctx context.Context, cwd, branch string) (string, int, int, bool) {
	ref := "refs/remotes/origin/" + branch
	if _, err := runGit(ctx, cwd, "show-ref", "--verify", "--quiet", ref); err != nil {
		return "", 0, 0, false
	}
	out, err := runGit(ctx, cwd, "rev-list", "--left-right", "--count", ref+"...refs/heads/"+branch)
	if err != nil {
		return "", 0, 0, false
	}
	fields := strings.Fields(out)
	if len(fields) != 2 {
		return "", 0, 0, false
	}
	// Left is the remote side (behind), right is the local side (ahead).
	behind, behindErr := strconv.Atoi(fields[0])
	ahead, aheadErr := strconv.Atoi(fields[1])
	if behindErr != nil || aheadErr != nil {
		return "", 0, 0, false
	}
	return ref, ahead, behind, true
}

// trackAhead reads "ahead 3" out of git's %(upstream:track) text.
func trackAhead(track string) int {
	if m := aheadTrackPattern.FindStringSubmatch(track); len(m) == 2 {
		if value, err := strconv.Atoi(m[1]); err == nil {
			return value
		}
	}
	return 0
}

// trackBehind reads "behind 3" out of git's %(upstream:track) text.
func trackBehind(track string) int {
	if m := behindTrackPattern.FindStringSubmatch(track); len(m) == 2 {
		if value, err := strconv.Atoi(m[1]); err == nil {
			return value
		}
	}
	return 0
}

// commitLogFormat is the record format ListCommits asks git for.
//
// The record separator and the field separator have to be characters git will never print in a
// subject, or a commit message containing a tab would shift every later field.
const (
	commitLogFormat     = "%x1e%H%x00%h%x00%an%x00%aI%x00%s"
	commitBaseLogLimit  = 10
	commitFieldSep      = "\x00"
	commitRecordSep     = "\x1e"
	commitRawStatusMark = ":"
)

// ListCommits lists the commits the panel shows: the branch's own work first, then the base's recent history.
//
// Ported from listCheckoutCommits. Three things matter and none is "just run git log":
//
//   - When the branch being viewed IS the comparison base, there is nothing ahead of it. Node still lists the base's
//     recent commits, marked `isOnBase`, so the panel shows history instead of an empty box. `baseRef` is null in that
//     case — the client renders "no commits ahead" from it, and naming a base that is the current branch would be wrong.
//   - Otherwise the branch's commits come from `<merge-base>..HEAD`, so commits the base gained after this branch
//     started are not counted as work done here.
//   - Every commit carries its file list. The panel fetches one file diff per entry, so a commit with no files renders
//     an empty diff view — which looks like a broken panel rather than a commit that touched nothing.
func ListCommits(ctx context.Context, cwd string, limit int) (*string, []Commit, error) {
	if limit <= 0 {
		limit = 30
	}
	currentBranch, err := runGit(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	branch := strings.TrimSpace(currentBranch)
	if err != nil || branch == "" || branch == "HEAD" {
		// Detached HEAD or not a repository: there is no branch to compare, and saying so is the honest answer.
		return nil, []Commit{}, nil
	}

	base := ResolveDiffBaseRef(ctx, cwd)
	baseName := strings.TrimPrefix(base, "origin/")
	unpushed := unpushedCommitShas(ctx, cwd)

	ahead := make([]Commit, 0, 32)
	var comparisonBase *string
	if base != "" && baseName != branch {
		if ancestor, mergeErr := runGit(ctx, cwd, "merge-base", base, "HEAD"); mergeErr == nil {
			if trimmed := strings.TrimSpace(ancestor); trimmed != "" {
				out, logErr := runGit(ctx, cwd, "log", "-n", strconv.Itoa(limit),
					"--diff-merges=first-parent", "--format="+commitLogFormat, "--raw", "--numstat", "-M",
					trimmed+"..HEAD")
				if logErr != nil {
					return nil, []Commit{}, logErr
				}
				ahead = parseCommits(out, unpushed, false)
				resolved := base
				comparisonBase = &resolved
			}
		}
	}

	// The base's recent history, marked `isOnBase`. Without it a branch with no commits of its own shows nothing at
	// all, which reads as a failure rather than as "this branch has nothing on top of its base".
	baseRevision := "HEAD"
	if comparisonBase != nil {
		if ancestor, mergeErr := runGit(ctx, cwd, "merge-base", *comparisonBase, "HEAD"); mergeErr == nil {
			if trimmed := strings.TrimSpace(ancestor); trimmed != "" {
				baseRevision = trimmed
			}
		}
	}
	baseOut, baseErr := runGit(ctx, cwd, "log", "-n", strconv.Itoa(commitBaseLogLimit),
		"--diff-merges=first-parent", "--format="+commitLogFormat, "--raw", "--numstat", "-M", baseRevision)
	if baseErr != nil {
		return comparisonBase, ahead, nil
	}
	commits := append(ahead, parseCommits(baseOut, unpushed, true)...)
	return comparisonBase, commits, nil
}

// parseCommits reads the `git log --raw --numstat -M` stream used by ListCommits.
//
// isOnBase says whether the commits came from the base's history: the panel groups them separately, and a commit that is
// both here and on the base would otherwise be presented as this branch's work.
func parseCommits(out string, unpushed map[string]bool, isOnBase bool) []Commit {
	commits := make([]Commit, 0, 32)
	for _, record := range strings.Split(out, commitRecordSep) {
		if strings.TrimSpace(record) == "" {
			continue
		}
		lines := strings.Split(record, "\n")
		fields := strings.Split(lines[0], commitFieldSep)
		if len(fields) < 5 {
			continue
		}
		sha := strings.TrimSpace(fields[0])
		if sha == "" {
			continue
		}
		commits = append(commits, Commit{
			Sha:        sha,
			ShortSha:   strings.TrimSpace(fields[1]),
			AuthorName: fields[2],
			AuthorDate: strings.TrimSpace(fields[3]),
			Subject:    fields[4],
			IsOnRemote: !unpushed[sha],
			IsOnBase:   isOnBase,
			Files:      parseCommitFiles(lines[1:]),
		})
	}
	return commits
}

// parseCommitFiles merges the `--raw` status lines and `--numstat` counts of one commit.
//
// git prints both blocks for the same paths, so the statuses are keyed first and the counts are
// attached per path; a file that only appears in one block still has to survive.
func parseCommitFiles(lines []string) []CommitFile {
	statuses := make(map[string]string)
	order := make([]string, 0, len(lines))
	files := make(map[string]*CommitFile)
	upsert := func(path string) *CommitFile {
		if existing, ok := files[path]; ok {
			return existing
		}
		entry := &CommitFile{Path: path}
		files[path] = entry
		order = append(order, path)
		return entry
	}
	for _, line := range lines {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, commitRawStatusMark) {
			if path, status := parseRawStatusLine(line); path != "" {
				statuses[path] = status
				upsert(path)
			}
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		path := normalizeNumstatPath(strings.Join(parts[2:], "\t"))
		if path == "" {
			continue
		}
		entry := upsert(path)
		// "-" marks a binary file: git cannot count lines in it, and 0/0 is the same thing the
		// client renders for a binary placeholder.
		if parts[0] == "-" || parts[1] == "-" {
			continue
		}
		if additions, err := strconv.Atoi(parts[0]); err == nil {
			entry.Additions = additions
		}
		if deletions, err := strconv.Atoi(parts[1]); err == nil {
			entry.Deletions = deletions
		}
	}
	result := make([]CommitFile, 0, len(order))
	for _, path := range order {
		entry := files[path]
		entry.Status = statuses[path]
		result = append(result, *entry)
	}
	return result
}

// parseRawStatusLine reads one `--raw` line: `:<mode> <mode> <sha> <sha> <STATUS>\t<path>`.
//
// A rename or copy adds a second tab-separated path, and it is the destination the client opens,
// so that is the one this reports.
func parseRawStatusLine(line string) (path, status string) {
	tabParts := strings.Split(line, "\t")
	meta := tabParts[0]
	statusToken := meta[strings.LastIndex(meta, " ")+1:]
	letter := statusToken[:1]
	switch letter {
	case "A", "C":
		status = "added"
	case "M", "T":
		status = "modified"
	case "D":
		status = "deleted"
	case "R":
		status = "renamed"
	default:
		return "", ""
	}
	if letter == "R" || letter == "C" {
		return tabParts[len(tabParts)-1], status
	}
	if len(tabParts) < 2 {
		return "", ""
	}
	return tabParts[1], status
}

// normalizeNumstatPath resolves the `--numstat` path field, which abbreviates renames as
// `dir/{old => new}.txt` or `old => new`.
//
// Without this the file list carries a path that does not exist, and the panel's per-file diff
// request comes back empty.
func normalizeNumstatPath(pathField string) string {
	if start := strings.Index(pathField, "{"); start >= 0 {
		if end := strings.Index(pathField[start:], "}"); end >= 0 {
			end += start
			inner := pathField[start+1 : end]
			if arrow := strings.Index(inner, " => "); arrow >= 0 {
				prefix := pathField[:start]
				renamed := inner[arrow+4:]
				suffix := pathField[end+1:]
				return prefix + renamed + suffix
			}
		}
	}
	if arrow := strings.Index(pathField, " => "); arrow >= 0 {
		return pathField[arrow+4:]
	}
	return pathField
}

// unpushedCommitShas is the set of commits on HEAD that no remote ref contains.
//
// Empty when there is no remote: nothing is known to be pushed, so every commit reports as local-only instead of
// claiming to be on a remote that does not exist.
func unpushedCommitShas(ctx context.Context, cwd string) map[string]bool {
	out, err := runGit(ctx, cwd, "rev-list", "HEAD", "--not", "--remotes")
	if err != nil || strings.TrimSpace(out) == "" {
		return map[string]bool{}
	}
	shas := make(map[string]bool, 32)
	for _, line := range strings.Split(out, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			shas[trimmed] = true
		}
	}
	return shas
}

// CreateWorktree creates a new git worktree with branch `slug` under worktreesBaseDir.
func CreateWorktree(ctx context.Context, repoCwd, worktreesBaseDir, slug, baseRef string) (string, string, error) {
	// Validate before a single git call: the slug becomes a path component and the ref becomes
	// a positional argument that git still parses for options.
	if err := AssertSafeWorktreeSlug(slug); err != nil {
		return "", "", err
	}
	if strings.TrimSpace(baseRef) != "" {
		if err := AssertSafeGitRef(baseRef, "base ref"); err != nil {
			return "", "", err
		}
	}
	topLevel, err := runGit(ctx, repoCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return "", "", err
	}
	cleanSlug := strings.TrimSpace(slug)
	if cleanSlug == "" {
		cleanSlug = "wt-" + strconv.FormatInt(time.Now().Unix(), 36)
	}
	wtPath := filepath.Join(worktreesBaseDir, filepath.Base(topLevel), cleanSlug)
	args := []string{"worktree", "add", "-b", cleanSlug, wtPath}
	if strings.TrimSpace(baseRef) != "" {
		args = append(args, baseRef)
	}
	if _, err := runGit(ctx, topLevel, args...); err != nil {
		return "", "", err
	}
	return wtPath, cleanSlug, nil
}

// ListWorktrees parses `git worktree list --porcelain` for repoCwd.
func ListWorktrees(ctx context.Context, repoCwd string) ([]WorktreeEntry, error) {
	out, err := runGit(ctx, repoCwd, "worktree", "list", "--porcelain")
	if err != nil {
		return []WorktreeEntry{}, err
	}
	var list []WorktreeEntry
	var cur WorktreeEntry
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if cur.WorktreePath != "" {
				list = append(list, cur)
				cur = WorktreeEntry{}
			}
			continue
		}
		if p, ok := strings.CutPrefix(line, "worktree "); ok {
			cur.WorktreePath = p
		} else if h, ok := strings.CutPrefix(line, "HEAD "); ok {
			cur.HeadSha = h
		} else if b, ok := strings.CutPrefix(line, "branch refs/heads/"); ok {
			cur.Branch = b
		}
	}
	if cur.WorktreePath != "" {
		list = append(list, cur)
	}
	if list == nil {
		list = []WorktreeEntry{}
	}
	return list, nil
}

var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// ParseUnifiedDiff parses a git unified diff output into structured ParsedDiffFile entries with hunks and lines.
//
// A rename is reported by git as a header-only section (`rename from` / `rename to`) with no hunks, and
// `extractDiffFilePath` returns the NEW path. That is why the caller gets `OldPath` filled in: without it
// the client cannot revert the rename, and the header counted 0 added lines for a file that is entirely
// new content under its new name.
func ParseUnifiedDiff(diffText string) []ParsedDiffFile {
	if strings.TrimSpace(diffText) == "" {
		return []ParsedDiffFile{}
	}
	rawSections := strings.Split("\n"+diffText, "\ndiff --git ")
	files := make([]ParsedDiffFile, 0, len(rawSections))

	for _, sec := range rawSections[1:] {
		lines := strings.Split(sec, "\n")
		if len(lines) == 0 {
			continue
		}
		isNew := strings.Contains(sec, "\nnew file mode") || strings.Contains(sec, "\n--- /dev/null")
		isDeleted := strings.Contains(sec, "\ndeleted file mode") || strings.Contains(sec, "\n+++ /dev/null")
		filePath := extractDiffFilePath(lines)
		oldPath := extractRenameSource(lines)

		hunks := make([]DiffHunk, 0)
		var curHunk *DiffHunk
		additions := 0
		deletions := 0

		for _, line := range lines[1:] {
			if strings.HasPrefix(line, "index ") ||
				strings.HasPrefix(line, "--- ") ||
				strings.HasPrefix(line, "+++ ") ||
				strings.HasPrefix(line, "new file mode") ||
				strings.HasPrefix(line, "deleted file mode") {
				continue
			}
			if m := hunkHeaderRe.FindStringSubmatch(line); m != nil {
				if curHunk != nil {
					hunks = append(hunks, *curHunk)
				}
				oldStart, _ := strconv.Atoi(m[1])
				oldCount := 1
				if m[2] != "" {
					oldCount, _ = strconv.Atoi(m[2])
				}
				newStart, _ := strconv.Atoi(m[3])
				newCount := 1
				if m[4] != "" {
					newCount, _ = strconv.Atoi(m[4])
				}
				curHunk = &DiffHunk{
					OldStart: oldStart,
					OldCount: oldCount,
					NewStart: newStart,
					NewCount: newCount,
					Lines: []DiffLine{
						{Type: "header", Content: m[0]},
					},
				}
				continue
			}
			if curHunk == nil {
				continue
			}
			if strings.HasPrefix(line, "+") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "add", Content: clampDiffLine(line[1:])})
				additions++
			} else if strings.HasPrefix(line, "-") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "remove", Content: clampDiffLine(line[1:])})
				deletions++
			} else if strings.HasPrefix(line, " ") {
				curHunk.Lines = append(curHunk.Lines, DiffLine{Type: "context", Content: clampDiffLine(line[1:])})
			}
		}
		if curHunk != nil {
			hunks = append(hunks, *curHunk)
		}

		files = append(files, ParsedDiffFile{
			Path:      filePath,
			OldPath:   oldPath,
			IsNew:     isNew,
			IsDeleted: isDeleted,
			Additions: additions,
			Deletions: deletions,
			Hunks:     hunks,
			Status:    "ok",
		})
	}
	return files
}

// extractRenameSource reads the source path out of a `rename from` / `copy from` header line.
//
// Git reports a rename as a header-only section with no hunks, so a caller that only looks at the
// patch body sees an empty file and reports zero changed lines.
func extractRenameSource(lines []string) string {
	for _, line := range lines {
		if after, ok := strings.CutPrefix(line, "rename from "); ok {
			return strings.TrimSpace(after)
		}
		if after, ok := strings.CutPrefix(line, "copy from "); ok {
			return strings.TrimSpace(after)
		}
	}
	return ""
}

func extractDiffFilePath(lines []string) string {
	first := lines[0]
	if idx := strings.Index(first, " b/"); idx != -1 && strings.HasPrefix(first, "a/") {
		return first[idx+3:]
	}
	for _, l := range lines {
		if after, ok := strings.CutPrefix(l, "+++ b/"); ok {
			return strings.TrimSpace(after)
		}
		if after, ok := strings.CutPrefix(l, "--- a/"); ok {
			return strings.TrimSpace(after)
		}
	}
	parts := strings.Fields(first)
	if len(parts) >= 2 {
		return strings.TrimPrefix(parts[len(parts)-1], "b/")
	}
	return "unknown"
}

// GetWorkingDiff computes modified and untracked files with full unified diff hunks against HEAD.
func GetWorkingDiff(ctx context.Context, cwd string) ([]ParsedDiffFile, error) {
	patch, err := runGit(ctx, cwd, "diff", "--no-color", "HEAD")
	if err != nil {
		patch, _ = runGit(ctx, cwd, "diff", "--no-color")
	}
	files := ParseUnifiedDiff(patch)

	// A rename arrives as a header-only section, so the patch body is empty and the counted lines are
	// zero. Diffing the new path on its own makes git report it as a new file, which is what the node
	// daemon showed: the file's whole content as added lines, plus the source path to revert it.
	for i := range files {
		if files[i].OldPath == "" || len(files[i].Hunks) > 0 {
			continue
		}
		perPath, perPathErr := runGit(ctx, cwd, "diff", "--no-color", "HEAD", "--", files[i].Path)
		if perPathErr != nil {
			continue
		}
		parsed := ParseUnifiedDiff(perPath)
		if len(parsed) == 0 {
			continue
		}
		files[i].Additions = parsed[0].Additions
		files[i].Deletions = parsed[0].Deletions
		files[i].Hunks = parsed[0].Hunks
	}

	seen := make(map[string]bool, len(files))
	for _, f := range files {
		seen[f.Path] = true
		if f.OldPath != "" {
			seen[f.OldPath] = true
		}
	}

	untrackedOut, err := runGit(ctx, cwd, "ls-files", "--others", "--exclude-standard")
	if err == nil && untrackedOut != "" {
		for _, rel := range strings.Split(untrackedOut, "\n") {
			rel = strings.TrimSpace(rel)
			if rel == "" || seen[rel] {
				continue
			}
			absPath := filepath.Join(cwd, rel)
			raw, readErr := os.ReadFile(absPath)
			if readErr != nil || len(raw) > 256*1024 || bytes.IndexByte(raw, 0) != -1 {
				continue
			}
			contentLines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
			diffLines := make([]DiffLine, 0, len(contentLines)+1)
			diffLines = append(diffLines, DiffLine{
				Type:    "header",
				Content: "@@ -0,0 +1," + strconv.Itoa(len(contentLines)) + " @@",
			})
			for _, cl := range contentLines {
				diffLines = append(diffLines, DiffLine{Type: "add", Content: cl})
			}
			files = append(files, ParsedDiffFile{
				Path:      rel,
				IsNew:     true,
				Additions: len(contentLines),
				Deletions: 0,
				Hunks: []DiffHunk{
					{
						OldStart: 0,
						OldCount: 0,
						NewStart: 1,
						NewCount: len(contentLines),
						Lines:    diffLines,
					},
				},
				Status: "ok",
			})
		}
	}
	if files == nil {
		files = []ParsedDiffFile{}
	}
	return files, nil
}

// GetCommitFileDiff returns the parsed unified diff for a single file in a specific commit.
func GetCommitFileDiff(ctx context.Context, cwd, sha, relPath string) (*ParsedDiffFile, error) {
	patch, err := runGit(ctx, cwd, "show", "--no-color", "--format=", sha, "--", relPath)
	if err != nil || strings.TrimSpace(patch) == "" {
		return nil, err
	}
	parsed := ParseUnifiedDiff(patch)
	if len(parsed) == 0 {
		return nil, nil
	}
	return &parsed[0], nil
}

// CommitAll stages all changes and commits them with the given message.
func CommitAll(ctx context.Context, cwd, message string) error {
	if _, err := runGit(ctx, cwd, "add", "-A"); err != nil {
		return err
	}
	_, err := runGit(ctx, cwd, "commit", "-m", message)
	return err
}

// DiscardChanges resets tracked modifications and removes untracked files.
func DiscardChanges(ctx context.Context, cwd string) error {
	if _, err := runGit(ctx, cwd, "reset", "--hard", "HEAD"); err != nil {
		return err
	}
	_, err := runGit(ctx, cwd, "clean", "-fd")
	return err
}

// SwitchBranch checks out an existing or new git branch.
func SwitchBranch(ctx context.Context, cwd, branch string, create bool) error {
	// Client-supplied: `git checkout -- <path>` and `-b`-style options both come from this
	// position, so a value starting with '-' must never reach git.
	if err := AssertSafeGitRef(branch, "branch"); err != nil {
		return err
	}
	// A new branch also has to satisfy the protocol's own rules, or the client will not accept
	// the name it just created.
	if create {
		if err := ValidateBranchSlug(branch); err != nil {
			return err
		}
	}
	if create {
		_, err := runGit(ctx, cwd, "checkout", "-b", branch)
		return err
	}
	_, err := runGit(ctx, cwd, "checkout", branch)
	return err
}

// RenameBranch renames the current branch to newName.
func RenameBranch(ctx context.Context, cwd, newName string) (string, error) {
	if err := AssertSafeGitRef(newName, "branch name"); err != nil {
		return "", err
	}
	if _, err := runGit(ctx, cwd, "branch", "-m", newName); err != nil {
		return "", err
	}
	cur, _ := runGit(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	return cur, nil
}

// ValidateBranch checks whether refName resolves to a valid git ref.
func ValidateBranch(ctx context.Context, cwd, refName string) (bool, string, bool) {
	resolved, err := runGit(ctx, cwd, "rev-parse", "--verify", refName)
	if err != nil || resolved == "" {
		return false, "", false
	}
	isRemote := strings.HasPrefix(refName, "origin/") || strings.HasPrefix(refName, "refs/remotes/")
	return true, resolved, isRemote
}

// ListBranches returns local branch names for cwd.
func ListBranches(ctx context.Context, cwd string) []string {
	branches := make([]string, 0, 32)
	for name := range localBranchOIDs(ctx, cwd) {
		branches = append(branches, name)
	}
	// Remote-only branches belong in the list: a picker that hides them cannot check out a branch a
	// teammate pushed, which is the main reason to open it on a fresh clone.
	for name := range remoteBranchOIDs(ctx, cwd) {
		if _, hasLocal := localBranchOIDs(ctx, cwd)[name]; hasLocal {
			continue
		}
		branches = append(branches, name)
	}
	sort.Strings(branches)
	return branches
}

// gitRef is one ref with the date the picker sorts by.
type gitRef struct {
	Name          string
	CommitterDate int64
	OID           string
}

// listGitRefs reads name/committerdate/oid for a ref prefix.
//
// Sorted by author date in git's own order? No: sorted here by committer date descending, which is what makes the
// picker show recently used branches first. `--sort=-committerdate` would do it in git, but the same three fields are
// read twice (local and remote) and mixing sorted output with map insertion would be harder to reason about.
func listGitRefs(ctx context.Context, cwd, prefix string) []gitRef {
	out, err := runGit(ctx, cwd, "for-each-ref", "--format=%(refname)\t%(committerdate:unix)\t%(objectname)", prefix)
	if err != nil || strings.TrimSpace(out) == "" {
		return nil
	}
	refs := make([]gitRef, 0, 32)
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) != 3 || fields[0] == "" || fields[2] == "" {
			continue
		}
		date := int64(0)
		if parsed, convErr := strconv.ParseInt(fields[1], 10, 64); convErr == nil {
			date = parsed
		}
		refs = append(refs, gitRef{Name: fields[0], CommitterDate: date, OID: fields[2]})
	}
	return refs
}

// localBranchOIDs maps a short local branch name to its oid.
func localBranchOIDs(ctx context.Context, cwd string) map[string]string {
	out := make(map[string]string, 16)
	for _, ref := range listGitRefs(ctx, cwd, "refs/heads") {
		if name := normalizeBranchSuggestionName(ref.Name); name != "" {
			out[name] = ref.OID
		}
	}
	return out
}

// remoteBranchOIDs maps a short branch name to its origin oid.
//
// Only `origin`: a second remote would produce two entries for the same name with no way to tell them apart in the
// picker, and origin is the one BySpace pushes to.
func remoteBranchOIDs(ctx context.Context, cwd string) map[string]string {
	out := make(map[string]string, 16)
	for _, ref := range listGitRefs(ctx, cwd, "refs/remotes/origin") {
		if name := normalizeBranchSuggestionName(ref.Name); name != "" {
			out[name] = ref.OID
		}
	}
	return out
}

// normalizeBranchSuggestionName strips the ref prefixes a picker does not show.
//
// Returns "" for entries that are not branch names: `HEAD` and a bare `origin` are ref bookkeeping, and listing them
// as branches offers a checkout that would fail.
func normalizeBranchSuggestionName(raw string) string {
	name := strings.TrimSpace(raw)
	name = strings.TrimPrefix(name, "refs/heads/")
	name = strings.TrimPrefix(name, "refs/remotes/")
	name = strings.TrimPrefix(name, "origin/")
	if name == "" || name == "HEAD" || name == "origin" {
		return ""
	}
	return name
}

// BranchSuggestion is one row in the branch picker.
type BranchSuggestion struct {
	Name          string `json:"name"`
	HasLocal      bool   `json:"hasLocal"`
	HasRemote     bool   `json:"hasRemote"`
	CommitterDate int64  `json:"committerDate"`
	LocalAhead    *int   `json:"localAhead,omitempty"`
	LocalBehind   *int   `json:"localBehind,omitempty"`
}

// ListBranchSuggestions lists branches with where they exist and how far apart the two sides are.
//
// Ported from listBranchSuggestions. The picker labels a row "Local", "Remote" or "Local • Remote" from
// hasLocal/hasRemote; Go sent neither, so every row looked local-only and a branch that existed only on origin could
// not be seen at all — it was not in the list.
func ListBranchSuggestions(ctx context.Context, cwd, query string, limit int) []BranchSuggestion {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))

	local := localBranchOIDs(ctx, cwd)
	remote := remoteBranchOIDs(ctx, cwd)

	names := make([]string, 0, len(local)+len(remote))
	seen := make(map[string]bool, len(local)+len(remote))
	for name := range local {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	for name := range remote {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}

	if normalizedQuery != "" {
		filtered := names[:0]
		for _, name := range names {
			if strings.Contains(strings.ToLower(name), normalizedQuery) {
				filtered = append(filtered, name)
			}
		}
		names = filtered
	}

	// Prefix matches first, then most recent committer date, then name — the order a person scanning a list expects.
	dates := make(map[string]int64, len(names))
	for _, ref := range listGitRefs(ctx, cwd, "refs/heads") {
		if name := normalizeBranchSuggestionName(ref.Name); name != "" {
			dates[name] = maxInt64(dates[name], ref.CommitterDate)
		}
	}
	for _, ref := range listGitRefs(ctx, cwd, "refs/remotes/origin") {
		if name := normalizeBranchSuggestionName(ref.Name); name != "" {
			dates[name] = maxInt64(dates[name], ref.CommitterDate)
		}
	}
	sort.SliceStable(names, func(i, j int) bool {
		left, right := names[i], names[j]
		if normalizedQuery != "" {
			leftPrefix := strings.HasPrefix(strings.ToLower(left), normalizedQuery)
			rightPrefix := strings.HasPrefix(strings.ToLower(right), normalizedQuery)
			if leftPrefix != rightPrefix {
				return leftPrefix
			}
		}
		if dates[left] != dates[right] {
			return dates[left] > dates[right]
		}
		return left < right
	})
	if len(names) > limit {
		names = names[:limit]
	}

	suggestions := make([]BranchSuggestion, 0, len(names))
	for _, name := range names {
		localOID, hasLocal := local[name]
		remoteOID, hasRemote := remote[name]
		suggestion := BranchSuggestion{
			Name:      name,
			HasLocal:  hasLocal,
			HasRemote: hasRemote,
		}
		suggestion.CommitterDate = dates[name]
		// Ahead/behind only means something when both sides exist. Identical oids are 0/0 without asking git.
		if hasLocal && hasRemote {
			if localOID == remoteOID {
				zero := 0
				suggestion.LocalAhead = &zero
				zeroAgain := 0
				suggestion.LocalBehind = &zeroAgain
			} else if ahead, behind, ok := branchAheadBehind(ctx, cwd, name); ok {
				suggestion.LocalAhead = &ahead
				suggestion.LocalBehind = &behind
			}
		}
		suggestions = append(suggestions, suggestion)
	}
	return suggestions
}

// branchAheadBehind counts the commits the two sides differ by.
//
// Reported as unknown on failure rather than 0/0: a divergence the daemon could not measure must not read as "in sync".
func branchAheadBehind(ctx context.Context, cwd, name string) (int, int, bool) {
	out, err := runGit(ctx, cwd, "rev-list", "--left-right", "--count",
		"refs/heads/"+name+"...refs/remotes/origin/"+name)
	if err != nil {
		return 0, 0, false
	}
	fields := strings.Fields(out)
	if len(fields) != 2 {
		return 0, 0, false
	}
	ahead, aheadErr := strconv.Atoi(fields[0])
	behind, behindErr := strconv.Atoi(fields[1])
	if aheadErr != nil || behindErr != nil {
		return 0, 0, false
	}
	return ahead, behind, true
}

// maxInt64 returns the larger value.
func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

// Push runs `git push`.
func Push(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "push")
	return err
}

// Pull runs `git pull`.
func Pull(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "pull")
	return err
}

// Merge runs `git merge <ref>`.
func Merge(ctx context.Context, cwd, ref string) error {
	if err := AssertSafeGitRef(ref, "merge ref"); err != nil {
		return err
	}
	if strings.TrimSpace(ref) == "" {
		ref = "main"
	}
	_, err := runGit(ctx, cwd, "merge", ref)
	return err
}

type StashEntry struct {
	Index     int     `json:"index"`
	Message   string  `json:"message"`
	Branch    *string `json:"branch"`
	IsBySpace bool    `json:"isBySpace"`
}

// StashList returns git stash entries.
func StashList(ctx context.Context, cwd string) []StashEntry {
	out, err := runGit(ctx, cwd, "stash", "list", "--format=%gd\x1f%gs")
	if err != nil || out == "" {
		return []StashEntry{}
	}
	lines := strings.Split(out, "\n")
	entries := make([]StashEntry, 0, len(lines))
	for idx, line := range lines {
		parts := strings.SplitN(line, "\x1f", 2)
		msg := line
		if len(parts) == 2 {
			msg = parts[1]
		}
		entries = append(entries, StashEntry{
			Index:     idx,
			Message:   msg,
			Branch:    nil,
			IsBySpace: strings.Contains(msg, "byspace"),
		})
	}
	return entries
}

// StashSave runs `git stash push -u -m <message>`.
func StashSave(ctx context.Context, cwd, message string) error {
	if strings.TrimSpace(message) == "" {
		message = "byspace stash"
	}
	_, err := runGit(ctx, cwd, "stash", "push", "-u", "-m", message)
	return err
}

// StashPop runs `git stash pop`.
func StashPop(ctx context.Context, cwd string) error {
	_, err := runGit(ctx, cwd, "stash", "pop")
	return err
}

// StashPopIndex pops a specific stash entry (`git stash pop stash@{n}`); index 0 = latest.
func StashPopIndex(ctx context.Context, cwd string, index int) error {
	if index <= 0 {
		return StashPop(ctx, cwd)
	}
	_, err := runGit(ctx, cwd, "stash", "pop", "stash@{"+strconv.Itoa(index)+"}")
	return err
}

// DiscardPaths reverts the given tracked paths and removes them if they were untracked.
//
// The order matters: a path can be staged, modified and untracked at the same time, and each
// state needs a different command. Unstaging first makes every remaining difference a worktree
// difference, so the follow-up classification only has to decide between "restore from the index"
// and "delete the file".
//
// Ported from `discardChanges` in archive/packages/server/src/utils/checkout-git.ts:3449. The
// earlier version ran `checkout -- <paths>` on everything, which left untracked files in place
// (`clean` never ran because `checkout` failed on a path git does not know) and left a staged
// rename fully staged, so "revert" appeared to do nothing.
func DiscardPaths(ctx context.Context, cwd string, paths []string) error {
	if len(paths) == 0 {
		return DiscardChanges(ctx, cwd)
	}

	resetArgs := append([]string{"--literal-pathspecs", "reset", "-q", "HEAD", "--"}, paths...)
	if _, err := runGit(ctx, cwd, resetArgs...); err != nil {
		// An unborn HEAD has no commit to reset to, so drop the paths from the index directly.
		rmArgs := append([]string{"--literal-pathspecs", "rm", "--cached", "-r", "-q", "--ignore-unmatch", "--"}, paths...)
		if _, rmErr := runGit(ctx, cwd, rmArgs...); rmErr != nil {
			return err
		}
	}

	statusArgs := append([]string{"--literal-pathspecs", "status", "--porcelain=v1", "-z", "--"}, paths...)
	status, err := runGit(ctx, cwd, statusArgs...)
	if err != nil {
		return err
	}
	tracked, untracked := classifyDiscardPaths(status)
	if len(tracked) > 0 {
		args := append([]string{"--literal-pathspecs", "checkout", "-q", "--"}, tracked...)
		if _, err := runGit(ctx, cwd, args...); err != nil {
			return err
		}
	}
	if len(untracked) > 0 {
		args := append([]string{"--literal-pathspecs", "clean", "-fd", "-q", "--"}, untracked...)
		if _, err := runGit(ctx, cwd, args...); err != nil {
			return err
		}
	}
	return nil
}

// classifyDiscardPaths splits `git status --porcelain=v1 -z` output into tracked and untracked
// paths. Rename and copy entries carry their source path as the next NUL token, which has to be
// skipped or the source is treated as a second, bogus path.
//
// The status text arrives trimmed, so a leading " D" entry lost its leading space and read as "D ".
// Only the single separator space after the two status characters is stripped, never whitespace that
// belongs to the path itself.
func classifyDiscardPaths(status string) (tracked []string, untracked []string) {
	tokens := strings.Split(status, "\x00")
	for i := 0; i < len(tokens); i++ {
		token := tokens[i]
		if len(token) < 3 {
			continue
		}
		state := token[:2]
		path := strings.TrimPrefix(token[2:], " ")
		if path == "" {
			continue
		}
		if state[0] == 'R' || state[0] == 'C' {
			// The source path follows in its own NUL token; the caller's pathspec already covers it.
			i++
			continue
		}
		if strings.TrimSpace(state) == "??" {
			untracked = append(untracked, path)
			continue
		}
		tracked = append(tracked, path)
	}
	return tracked, untracked
}

// CommitWithOptions commits staged changes, optionally staging everything first.
func CommitWithOptions(ctx context.Context, cwd, message string, addAll bool) error {
	if addAll {
		if _, err := runGit(ctx, cwd, "add", "-A"); err != nil {
			return err
		}
	}
	_, err := runGit(ctx, cwd, "commit", "-m", message)
	return err
}

// MergeStrategy merges a ref using the requested strategy ("merge" | "squash" | "rebase").
func MergeStrategy(ctx context.Context, cwd, ref, strategy string) error {
	if strings.TrimSpace(ref) == "" {
		ref = "main"
	}
	if err := AssertSafeGitRef(ref, "merge ref"); err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "squash":
		_, err := runGit(ctx, cwd, "merge", "--squash", ref)
		return err
	case "rebase":
		_, err := runGit(ctx, cwd, "rebase", ref)
		return err
	default:
		_, err := runGit(ctx, cwd, "merge", ref)
		return err
	}
}

// RemoveWorktreeFromDisk runs `git worktree remove --force <path>` against the owning repo.
func RemoveWorktreeFromDisk(ctx context.Context, worktreePath string) error {
	if strings.TrimSpace(worktreePath) == "" {
		return nil
	}
	parent := filepath.Dir(worktreePath)
	for dir := parent; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			_, rmErr := runGit(ctx, dir, "worktree", "remove", "--force", worktreePath)
			return rmErr
		}
	}
	return os.RemoveAll(worktreePath)
}

// DeleteOwnedWorktree removes a BySpace-owned worktree directory from disk.
//
// The repository is named explicitly rather than discovered by walking up from the worktree: a
// BySpace worktree lives at <home>/worktrees/<repo-hash>/<slug>, so nothing above it holds a
// `.git`, and walking up would fall through to a plain RemoveAll that leaves the repository's
// worktree admin directory behind. `worktree prune` then forgets the entry, so a later
// `create` can reuse the branch.
//
// A directory that is already gone counts as success: the caller asked for it to be absent.
func DeleteOwnedWorktree(ctx context.Context, repoRoot, worktreePath string) error {
	if strings.TrimSpace(worktreePath) == "" {
		return nil
	}
	if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
		return nil
	}
	if strings.TrimSpace(repoRoot) != "" {
		if _, err := runGit(ctx, repoRoot, "worktree", "remove", "--force", "--force", worktreePath); err == nil {
			_, _ = runGit(ctx, repoRoot, "worktree", "prune")
			return nil
		}
	}
	return os.RemoveAll(worktreePath)
}

// PruneWorktrees drops worktree admin entries whose directory no longer exists.
//
// An interrupted archive (or a directory the user deleted by hand) leaves `git worktree`
// believing the path is still checked out, which makes the next `worktree add` for that branch
// or path fail. Pruning is idempotent and harmless when there is nothing stale.
func PruneWorktrees(ctx context.Context, repoRoot string) error {
	if strings.TrimSpace(repoRoot) == "" {
		return nil
	}
	_, err := runGit(ctx, repoRoot, "worktree", "prune")
	return err
}

// WorktreeMainRepoRoot reports the repository a worktree was checked out from, or "" when it
// cannot be determined. Best-effort on purpose: a half-archived worktree has no admin directory
// left to read, and the caller only uses this to name the repository for cleanup.
func WorktreeMainRepoRoot(ctx context.Context, worktreePath string) string {
	commonDir, err := runGit(ctx, worktreePath, "rev-parse", "--git-common-dir")
	if err != nil {
		return ""
	}
	commonDir = strings.TrimSpace(commonDir)
	if commonDir == "" {
		return ""
	}
	if !filepath.IsAbs(commonDir) {
		commonDir = filepath.Join(worktreePath, commonDir)
	}
	commonDir = filepath.Clean(commonDir)
	if filepath.Base(commonDir) == ".git" {
		return filepath.Dir(commonDir)
	}
	return commonDir
}

// safeGitRefPattern is the same allow-list the node daemon applies before interpolating a
// user-supplied ref into a git argument list.
var safeGitRefPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

// AssertSafeGitRef rejects a ref that could be read as a git option or reach outside the
// repository.
//
// `git worktree add ... <baseRef>` takes the ref positionally, but git still parses anything
// starting with `-` as an option: `--upload-pack=curl evil|sh` would execute on fetch, and
// `-b`-style values can rewrite which branch is created. The pattern plus the `..`/`@{` checks
// match worktree-session.ts assertSafeGitRef.
func AssertSafeGitRef(ref, label string) error {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return fmt.Errorf("invalid %s: empty", label)
	}
	if !safeGitRefPattern.MatchString(trimmed) {
		return fmt.Errorf("invalid %s: %q contains characters outside [A-Za-z0-9._/-]", label, ref)
	}
	if strings.HasPrefix(trimmed, "-") {
		return fmt.Errorf("invalid %s: %q must not start with '-'", label, ref)
	}
	if strings.Contains(trimmed, "..") || strings.Contains(trimmed, "@{") {
		return fmt.Errorf("invalid %s: %q contains a forbidden sequence", label, ref)
	}
	return nil
}

// AssertSafeWorktreeSlug rejects a slug that would escape the worktrees directory.
//
// The slug becomes a path component (`<base>/<repo>/<slug>`), so a value containing a separator
// or `..` writes outside the byspace-owned tree.
func AssertSafeWorktreeSlug(slug string) error {
	trimmed := strings.TrimSpace(slug)
	if trimmed == "" {
		return nil // caller substitutes a generated name
	}
	if trimmed == "." || trimmed == ".." || strings.ContainsAny(trimmed, "/\\") {
		return fmt.Errorf("invalid worktree slug: %q", slug)
	}
	if strings.HasPrefix(trimmed, "-") {
		return fmt.Errorf("invalid worktree slug: %q must not start with '-'", slug)
	}
	return nil
}

// worktreeLayout resolves the target directory and validates the slug.
func worktreeLayout(ctx context.Context, repoCwd, worktreesBaseDir, slug string) (topLevel, wtPath, cleanSlug string, err error) {
	if slugErr := AssertSafeWorktreeSlug(slug); slugErr != nil {
		return "", "", "", slugErr
	}
	topLevel, err = runGit(ctx, repoCwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return "", "", "", err
	}
	cleanSlug = strings.TrimSpace(slug)
	if cleanSlug == "" {
		cleanSlug = "wt-" + strconv.FormatInt(time.Now().Unix(), 36)
	}
	wtPath = filepath.Join(worktreesBaseDir, filepath.Base(topLevel), cleanSlug)
	return topLevel, wtPath, cleanSlug, nil
}

// checkoutExistingBranch adds a worktree tracking an existing branch.
//
// `git worktree add -b` would fail here (the branch exists), so the branch is checked out
// directly. `-B` is deliberately not used: overwriting an existing local branch would discard
// work in a repository the user may have several worktrees on.
func checkoutExistingBranch(ctx context.Context, repoCwd, worktreesBaseDir, slug, branch string) (string, string, error) {
	if err := AssertSafeGitRef(branch, "branch"); err != nil {
		return "", "", err
	}
	topLevel, wtPath, cleanSlug, err := worktreeLayout(ctx, repoCwd, worktreesBaseDir, slug)
	if err != nil {
		return "", "", err
	}
	// Prefer a remote-tracking branch when it exists, which is what "check out this branch"
	// usually means for a branch the user has not fetched before.
	target := branch
	if _, err := runGit(ctx, topLevel, "rev-parse", "--verify", "refs/heads/"+branch); err != nil {
		if _, remoteErr := runGit(ctx, topLevel, "rev-parse", "--verify", "refs/remotes/origin/"+branch); remoteErr == nil {
			target = "origin/" + branch
		}
	}
	if _, err := runGit(ctx, topLevel, "worktree", "add", wtPath, target); err != nil {
		return "", "", err
	}
	return wtPath, cleanSlug, nil
}

// checkoutChangeRequest fetches and checks out a pull/merge request's head.
//
// Ported from the `checkout-change-request` branch of worktree-session.ts. `gh pr checkout` is
// not used because it mutates the current worktree; the daemon needs an independent one.
//
// The local branch is named after the request's head branch, not after the worktree slug: the slug
// is a generated directory name, so naming the branch after it produced `flaky-stingray` where the
// user asked for the PR's own branch. A `-1`/`-2` suffix keeps it unique when the branch already
// exists locally.
func checkoutChangeRequest(ctx context.Context, repoCwd, worktreesBaseDir, slug string, intent WorktreeIntent) (string, string, error) {
	if err := AssertSafeGitRef(intent.HeadRef, "change request head ref"); err != nil {
		return "", "", err
	}
	topLevel, wtPath, _, err := worktreeLayout(ctx, repoCwd, worktreesBaseDir, slug)
	if err != nil {
		return "", "", err
	}

	candidate := strings.TrimSpace(intent.HeadRef)
	if candidate == "" {
		candidate = strings.TrimSpace(slug)
	}
	branchName, err := resolveUniqueLocalBranchName(ctx, topLevel, candidate)
	if err != nil {
		return "", "", err
	}

	// GitHub publishes every PR head at refs/pull/<n>/head, including cross-repository ones,
	// which is the one ref that works without knowing the fork's URL. Other forges expose the
	// head branch under its own name.
	remoteRef := fmt.Sprintf("refs/pull/%d/head", intent.ChangeRequestNumber)
	if intent.Forge != "" && intent.Forge != "github" {
		remoteRef = intent.HeadRef
	}
	// Fetch straight into the local branch: `worktree add` then has something to check out even
	// when the head branch was never fetched, which is the whole point of this path.
	if _, err := runGit(ctx, topLevel, "fetch", "origin",
		"+"+remoteRef+":refs/heads/"+branchName, "--force"); err != nil {
		return "", "", err
	}

	if _, err := runGit(ctx, topLevel, "worktree", "add", wtPath, branchName); err != nil {
		return "", "", err
	}
	// Track the origin branch when the head lives in this repository, so a later push goes to
	// the right place. A cross-repository head has no matching origin branch.
	if !intent.IsCrossRepository {
		_, _ = runGit(ctx, wtPath, "branch", "--set-upstream-to=origin/"+intent.HeadRef, branchName)
	}
	return wtPath, branchName, nil
}

// resolveUniqueLocalBranchName appends -1, -2, ... until the name is free, matching
// resolveUniqueLocalBranchName in the Node server.
func resolveUniqueLocalBranchName(ctx context.Context, cwd, candidate string) (string, error) {
	name := candidate
	for suffix := 1; suffix < 100; suffix++ {
		exists, err := localBranchExists(ctx, cwd, name)
		if err != nil {
			return "", err
		}
		if !exists {
			return name, nil
		}
		name = fmt.Sprintf("%s-%d", candidate, suffix)
	}
	return "", fmt.Errorf("could not find a free branch name for %s", candidate)
}

func localBranchExists(ctx context.Context, cwd, branch string) (bool, error) {
	if _, err := runGit(ctx, cwd, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); err != nil {
		// show-ref exits non-zero for a missing ref; anything else is a real failure, but the
		// caller only needs the boolean and a second git call per candidate is not worth it.
		return false, nil
	}
	return true, nil
}

// ResolveDefaultBranch reports the repository's default branch.
//
// Order: the remote HEAD (what a fresh clone would check out), then well-known names, then the
// current branch. A repository with no remote still needs an answer, which is why the fallbacks
// exist rather than returning an error.
func ResolveDefaultBranch(ctx context.Context, repoRoot string) (string, error) {
	if out, err := runGit(ctx, repoRoot, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil {
		if name := strings.TrimPrefix(strings.TrimSpace(out), "origin/"); name != "" {
			return name, nil
		}
	}
	for _, candidate := range []string{"main", "master", "trunk", "develop"} {
		if _, err := runGit(ctx, repoRoot, "rev-parse", "--verify", "refs/heads/"+candidate); err == nil {
			return candidate, nil
		}
	}
	if out, err := runGit(ctx, repoRoot, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		return strings.TrimSpace(out), nil
	}
	return "", fmt.Errorf("could not determine the default branch")
}

// GitRefChange describes one remote ref that moved between two snapshots.
type GitRefChange struct {
	Kind      string `json:"kind"` // "added" | "moved" | "deleted"
	Ref       string `json:"ref"`
	BeforeOID string `json:"beforeOid,omitempty"`
	AfterOID  string `json:"afterOid,omitempty"`
}

// ReadRefs snapshots every ref in the repository, keyed by full refname.
//
// Ported from readWorkspaceGitRefs. The daemon needs before/after snapshots around a fetch to
// tell "nothing changed" from "an agent created a branch", which is what decides whether the
// branch list in the UI has to be refreshed.
func ReadRefs(ctx context.Context, cwd string) (map[string]string, error) {
	out, err := runGit(ctx, cwd, "for-each-ref", "--format=%(refname)%00%(objectname)")
	if err != nil {
		return nil, err
	}
	refs := make(map[string]string)
	for _, line := range strings.Split(out, "\n") {
		ref, oid, found := strings.Cut(line, "\x00")
		if !found || !strings.HasPrefix(ref, "refs/") || oid == "" {
			continue
		}
		refs[ref] = oid
	}
	return refs, nil
}

// DiffRefs compares two snapshots.
//
// Returns the remote-branch changes (what the user sees in a branch picker) and whether any
// non-remote ref moved — a changed local branch or tag is a different kind of event and must not
// be reported as "a remote branch moved".
func DiffRefs(before, after map[string]string) ([]GitRefChange, bool) {
	const remotePrefix = "refs/remotes/"
	changes := make([]GitRefChange, 0, 4)
	nonRemoteChanged := false

	for ref, afterOID := range after {
		if !strings.HasPrefix(ref, remotePrefix) {
			if before[ref] != afterOID {
				nonRemoteChanged = true
			}
			continue
		}
		name := strings.TrimPrefix(ref, remotePrefix)
		beforeOID, existed := before[ref]
		switch {
		case !existed:
			changes = append(changes, GitRefChange{Kind: "added", Ref: name, AfterOID: afterOID})
		case beforeOID != afterOID:
			changes = append(changes, GitRefChange{Kind: "moved", Ref: name, BeforeOID: beforeOID, AfterOID: afterOID})
		}
	}
	for ref, beforeOID := range before {
		if !strings.HasPrefix(ref, remotePrefix) {
			continue
		}
		if _, stillThere := after[ref]; !stillThere {
			changes = append(changes, GitRefChange{
				Kind: "deleted", Ref: strings.TrimPrefix(ref, remotePrefix), BeforeOID: beforeOID,
			})
		}
	}

	// Stable order so the wire payload does not change on every run.
	sort.Slice(changes, func(i, j int) bool {
		if changes[i].Ref != changes[j].Ref {
			return changes[i].Ref < changes[j].Ref
		}
		return changes[i].Kind < changes[j].Kind
	})
	return changes, nonRemoteChanged
}

// FetchRemote runs `git fetch origin --prune` and reports what changed.
//
// Ported from fetchWorkspaceGitRemote. The snapshots are taken around the fetch, and a failure
// in either snapshot is reported alongside the fetch error rather than swallowed: without them
// the caller cannot distinguish "the fetch worked and nothing moved" from "we could not tell".
func FetchRemote(ctx context.Context, cwd string) ([]GitRefChange, bool, error) {
	before, beforeErr := ReadRefs(ctx, cwd)

	_, fetchErr := runGit(ctx, cwd, "fetch", "origin", "--prune")

	after, afterErr := ReadRefs(ctx, cwd)

	if beforeErr != nil || afterErr != nil {
		if fetchErr != nil {
			return nil, false, fetchErr
		}
		if beforeErr != nil {
			return nil, false, beforeErr
		}
		return nil, false, afterErr
	}

	changes, nonRemote := DiffRefs(before, after)
	if fetchErr != nil {
		// Changes still describe reality: a partial fetch may have moved some refs.
		return changes, nonRemote, fetchErr
	}
	return changes, nonRemote, nil
}

// CountAheadOfOrigin reports how many local commits are not on the upstream branch.
//
// Used before archiving a merged worktree: commits made after the PR was opened are not in it,
// so "merged and clean" is not enough. A branch with no upstream counts as ahead by its own
// commit count against the default branch — treating it as 0 would silently discard the work.
func CountAheadOfOrigin(ctx context.Context, cwd string) (int, error) {
	out, err := runGit(ctx, cwd, "rev-list", "--count", "@{upstream}..HEAD")
	if err != nil {
		// No upstream: count against the repository's default branch instead.
		remoteHead, remoteErr := runGit(ctx, cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
		if remoteErr != nil {
			return 0, err
		}
		base := strings.TrimPrefix(strings.TrimSpace(remoteHead), "origin/")
		if base == "" {
			return 0, err
		}
		fallback, fallbackErr := runGit(ctx, cwd, "rev-list", "--count", "origin/"+base+"..HEAD")
		if fallbackErr != nil {
			return 0, fallbackErr
		}
		return parseCount(fallback)
	}
	return parseCount(out)
}

func parseCount(raw string) (int, error) {
	count, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, err
	}
	return count, nil
}

// clampDiffLine truncates a diff line that is too long to render.
//
// A minified bundle is one line of hundreds of thousands of characters; highlighting it blocks
// the renderer, and nobody reads a line that long. The truncation is visible in the output
// rather than silent, because a user comparing two minified files needs to know they are not
// seeing the whole line.
func clampDiffLine(line string) string {
	if len(line) <= MaxDiffLineChars {
		return line
	}
	// Byte slicing could split a rune; back off to a boundary.
	cut := MaxDiffLineChars
	for cut > 0 && !utf8.RuneStart(line[cut]) {
		cut--
	}
	return line[:cut] + "… (truncated)"
}

// GetDiffSummaryForPrompt renders the working diff as text for a model to read.
//
// The raw `git diff` rather than the parsed structure: the model wants the code, and rebuilding
// it from ParsedDiffFile would drop line-break details and reorder hunks. Truncated to keep the
// prompt bounded — a huge diff would cost more tokens than the message is worth.
func GetDiffSummaryForPrompt(ctx context.Context, cwd string) (string, error) {
	const maxDiffPromptBytes = 20000

	if out, err := runGit(ctx, cwd, "diff", "HEAD"); err == nil && strings.TrimSpace(out) != "" {
		return clampPromptDiff(out, maxDiffPromptBytes), nil
	}
	// Nothing tracked has changed; the change may be an untracked file.
	untracked, err := runGit(ctx, cwd, "ls-files", "--others", "--exclude-standard")
	if err != nil || strings.TrimSpace(untracked) == "" {
		return "", errors.New("no changes to describe")
	}
	parts := make([]string, 0, 8)
	for _, name := range strings.Split(strings.TrimSpace(untracked), "\n") {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		parts = append(parts, "new file: "+trimmed)
	}
	return clampPromptDiff(strings.Join(parts, "\n"), maxDiffPromptBytes), nil
}

// clampPromptDiff bounds the text sent to the model.
func clampPromptDiff(diff string, limit int) string {
	if len(diff) <= limit {
		return diff
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(diff[cut]) {
		cut--
	}
	return diff[:cut] + "\n… (diff truncated)"
}

// ResolveDiffBaseRef finds the commit a branch should be compared against.
//
// Ported from resolveRepositoryDefaultBranch. `refs/remotes/origin/HEAD` is the clone's own answer and wins; without a
// remote the conventional names are tried. Returns "" when nothing resolves, which means "there is no base to compare
// against" rather than "compare against everything" — the caller must show the working diff instead.
func ResolveDiffBaseRef(ctx context.Context, cwd string) string {
	if out, err := runGit(ctx, cwd, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"); err == nil {
		if ref := strings.TrimSpace(out); ref != "" {
			ref = strings.TrimPrefix(ref, "refs/remotes/")
			if ref != "" {
				return ref
			}
		}
	}
	for _, candidate := range []string{"origin/main", "origin/master", "main", "master"} {
		if _, err := runGit(ctx, cwd, "rev-parse", "--verify", "--quiet", candidate); err == nil {
			return candidate
		}
	}
	return ""
}

// GetBaseDiff lists the changes a branch carries relative to its base.
//
// This is the "Committed" comparison: `git diff <base>...HEAD`. Without it the picker's committed mode showed nothing,
// because GetWorkingDiff answers "what is not committed yet" and a clean checkout has no such changes — the user saw an
// empty Changes pane on a branch full of commits.
//
// Untracked files are deliberately excluded: they are not part of any commit, so including them would make the
// committed view disagree with what the branch actually contains.
func GetBaseDiff(ctx context.Context, cwd, baseRef string) ([]ParsedDiffFile, error) {
	base := strings.TrimSpace(baseRef)
	if base == "" {
		base = ResolveDiffBaseRef(ctx, cwd)
	}
	if base == "" {
		// No base to compare against: report nothing rather than diffing against the empty tree, which would
		// present the whole repository as this branch's work.
		return []ParsedDiffFile{}, nil
	}
	patch, err := runGit(ctx, cwd, "diff", "--no-color", base+"...HEAD")
	if err != nil {
		return nil, err
	}
	files := ParseUnifiedDiff(patch)
	if files == nil {
		files = []ParsedDiffFile{}
	}
	return files, nil
}

// BranchName returns the checked-out branch at cwd, or "" when it is not a git checkout.
//
// "HEAD" is what `symbolic-ref` prints for a detached checkout; it is not a branch name and callers
// that put it in a prompt or a port-script argument would be quoting a lie.
func BranchName(ctx context.Context, cwd string) (string, error) {
	branch, err := runGit(ctx, cwd, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return "", err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" || branch == "HEAD" {
		return "", nil
	}
	return branch, nil
}
