// Package dirstream ports archive/packages/server/src/utils/directory-suggestions.ts.
//
// It is a ranked fuzzy search over a directory tree, not a single readdir: pickers need to find
// `packages/app/src/components` from a fragment like "comps", skip build output, and rank by
// where the match landed. A naive prefix filter over one level is what this replaces.
package dirstream

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/ByteTrue/byspace/internal/match"
)

// Kind is the entry type a suggestion can be.
type Kind string

const (
	KindFile      Kind = "file"
	KindDirectory Kind = "directory"
)

// Entry is one suggestion.
type Entry struct {
	Path string `json:"path"`
	Kind Kind   `json:"kind"`
}

// PathFormat controls whether results are absolute or relative to the root.
type PathFormat string

const (
	FormatAbsolute PathFormat = "absolute"
	FormatRelative PathFormat = "relative"
)

// MatchMode selects between ranked fuzzy matching and literal path-suffix matching.
type MatchMode string

const (
	ModeFuzzy  MatchMode = "fuzzy"
	ModeSuffix MatchMode = "suffix"
)

// PathQueryPolicy decides whether a query containing a slash is treated as a path.
type PathQueryPolicy string

const (
	PolicyRooted  PathQueryPolicy = "rooted"
	PolicySlashes PathQueryPolicy = "slashes"
)

// BlankQueryBehavior decides what an empty query means.
type BlankQueryBehavior string

const (
	BlankNone     BlankQueryBehavior = "none"
	BlankChildren BlankQueryBehavior = "children"
)

// Options mirrors SearchDirectoryEntriesOptions.
type Options struct {
	Root                            string
	Query                           string
	PathFormat                      PathFormat
	IncludeFiles                    bool
	IncludeDirectories              bool
	MatchMode                       MatchMode
	PathQueryPolicy                 PathQueryPolicy
	RootAliases                     []string
	BlankQueryBehavior              BlankQueryBehavior
	TraversableHiddenDirectoryNames []string
	Limit                           int
	MaxDepth                        int
	MaxEntriesScanned               int
	ConfidentResultScanThreshold    int
	RespectGitIgnore                bool
}

const (
	defaultLimit             = 30
	maxLimit                 = 100
	defaultMaxDepth          = 12
	defaultMaxEntriesScanned = 20_000
	noSegmentIndex           = int(^uint(0) >> 1)
	noMatchOffset            = noSegmentIndex
	noFuzzyScore             = noSegmentIndex
	noMatchTier              = 5
)

// WorkspaceSearchHiddenDirectories are hidden directories that stay traversable inside a
// workspace. Everything else starting with "." is skipped during discovery.
var WorkspaceSearchHiddenDirectories = []string{
	".agents", ".claude", ".codex", ".github", ".opencode", ".byspace", ".vscode",
}

var ignoredDirectoryNames = map[string]bool{
	"node_modules": true, "venv": true, "env": true, "virtualenv": true,
	"dist": true, "build": true, "target": true, "out": true,
	"coverage": true, "vendor": true, "__pycache__": true, ".git": true,
}

type queryPlan struct {
	isPathQuery     bool
	parentPart      string
	searchTerm      string
	normalizedQuery string
	browseExactPath bool
}

type searchInput struct {
	root                 string
	plan                 queryPlan
	includeDirectories   bool
	includeFiles         bool
	mode                 MatchMode
	pathFormat           PathFormat
	hiddenDirectoryNames map[string]bool
	limit                int
	maxDepth             int
	maxEntriesScanned    int
	confidentThreshold   int
}

type childEntry struct {
	name         string
	resolvedPath string
	kind         Kind
}

type traversedEntry struct {
	childEntry
	visiblePath string
	depth       int
}

type rankedEntry struct {
	path         string
	kind         Kind
	matchTier    int
	segmentIndex int
	matchOffset  int
	fuzzyScore   int
	depth        int
}

// Search returns ranked suggestions. Mirrors searchDirectoryEntries: discovery filters
// gitignored and hidden entries so pickers do not offer build output, while an exact path the
// caller named is returned regardless of ignore rules (only containment is checked).
func Search(opts Options) []Entry {
	root, ok := resolveDir(opts.Root)
	if !ok {
		return nil
	}
	input, ok := buildInput(opts, root)
	if !ok {
		return nil
	}

	var exact *Entry
	if input.plan.browseExactPath || (input.mode == ModeSuffix && input.plan.isPathQuery) {
		exact = findExactEntry(input)
		if exact != nil && input.limit == 1 {
			return []Entry{*exact}
		}
	}

	// Only an empty path query or an absolute parent browse is a single-level listing.
	// Everything else — including a path query naming a parent — is a tree walk, so a user
	// typing a fragment of a nested path still finds it.
	browsesRoot := input.plan.isPathQuery && input.plan.normalizedQuery == ""
	browsesAbsoluteParent := input.plan.browseExactPath
	var ranked []rankedEntry
	if browsesRoot || browsesAbsoluteParent {
		ranked = searchChildren(input)
	} else {
		ranked = searchTree(input)
	}
	results := sortAndFormat(ranked, input.root, input.pathFormat)
	if len(results) > input.limit {
		results = results[:input.limit]
	}
	if exact == nil {
		return results
	}
	filtered := make([]Entry, 0, len(results)+1)
	filtered = append(filtered, *exact)
	for _, entry := range results {
		if entry.Path != exact.Path || entry.Kind != exact.Kind {
			filtered = append(filtered, entry)
		}
	}
	if len(filtered) > input.limit {
		filtered = filtered[:input.limit]
	}
	return filtered
}

func buildInput(opts Options, root string) (*searchInput, bool) {
	includeDirectories := opts.IncludeDirectories || (!opts.IncludeDirectories && !opts.IncludeFiles)
	includeFiles := opts.IncludeFiles
	if !includeDirectories && !includeFiles {
		return nil, false
	}
	policy := opts.PathQueryPolicy
	if policy == "" {
		policy = PolicySlashes
	}
	blank := opts.BlankQueryBehavior
	if blank == "" {
		blank = BlankNone
	}
	plan, ok := parseQuery(opts.Query, root, opts.Root, policy, opts.RootAliases, blank)
	if !ok {
		return nil, false
	}

	mode := opts.MatchMode
	if mode == "" {
		mode = ModeFuzzy
	}
	format := opts.PathFormat
	if format == "" {
		format = FormatRelative
	}
	hidden := make(map[string]bool, len(opts.TraversableHiddenDirectoryNames))
	for _, name := range opts.TraversableHiddenDirectoryNames {
		hidden[name] = true
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	maxDepth := opts.MaxDepth
	if maxDepth <= 0 {
		maxDepth = defaultMaxDepth
	}
	maxScanned := opts.MaxEntriesScanned
	if maxScanned <= 0 {
		maxScanned = defaultMaxEntriesScanned
	}

	return &searchInput{
		root:                 root,
		plan:                 plan,
		includeDirectories:   includeDirectories,
		includeFiles:         includeFiles,
		mode:                 mode,
		pathFormat:           format,
		hiddenDirectoryNames: hidden,
		limit:                limit,
		maxDepth:             maxDepth,
		maxEntriesScanned:    maxScanned,
		confidentThreshold:   opts.ConfidentResultScanThreshold,
	}, true
}

func findExactEntry(input *searchInput) *Entry {
	if input.plan.normalizedQuery == "" {
		return nil
	}
	visiblePath := filepath.Join(input.root, input.plan.normalizedQuery)
	resolved, ok := realPath(visiblePath)
	if !ok || !isInsideRoot(input.root, resolved) {
		return nil
	}
	kind, ok := entryKind(resolved)
	if !ok {
		return nil
	}
	if kind == KindDirectory && !input.includeDirectories {
		return nil
	}
	if kind == KindFile && !input.includeFiles {
		return nil
	}
	return &Entry{Path: formatPath(visiblePath, input.root, input.pathFormat), Kind: kind}
}

func searchChildren(input *searchInput) []rankedEntry {
	visibleParent := filepath.Join(input.root, input.plan.parentPart)
	if input.plan.parentPart == "" {
		visibleParent = input.root
	}
	parent, ok := realPath(visibleParent)
	if !ok || !isInsideRoot(input.root, parent) {
		return nil
	}
	var out []rankedEntry
	for _, entry := range readChildren(parent) {
		if !isInsideRoot(input.root, entry.resolvedPath) || !shouldDiscover(entry, input) {
			continue
		}
		candidate := traversedEntry{
			childEntry:  entry,
			visiblePath: filepath.Join(visibleParent, entry.name),
			depth:       1,
		}
		if shouldSuggest(candidate, input) {
			out = append(out, rank(candidate, input))
		}
	}
	return out
}

func searchTree(input *searchInput) []rankedEntry {
	if input.maxEntriesScanned <= 0 {
		return nil
	}
	roots := make([]traversedEntry, 0)
	for _, entry := range readChildren(input.root) {
		if !isInsideRoot(input.root, entry.resolvedPath) || !shouldDiscover(entry, input) {
			continue
		}
		roots = append(roots, traversedEntry{
			childEntry:  entry,
			visiblePath: filepath.Join(input.root, entry.name),
			depth:       1,
		})
	}

	visited := map[string]bool{input.root: true}
	var ranked []rankedEntry
	scanned := 0
	queue := roots
	for len(queue) > 0 {
		next := queue[0]
		queue = queue[1:]
		scanned++
		if shouldSuggest(next, input) {
			ranked = append(ranked, rank(next, input))
		}
		if next.kind == KindDirectory && !visited[next.resolvedPath] && next.depth < input.maxDepth {
			visited[next.resolvedPath] = true
			for _, child := range readChildren(next.resolvedPath) {
				if !isInsideRoot(input.root, child.resolvedPath) || !shouldDiscover(child, input) {
					continue
				}
				queue = append(queue, traversedEntry{
					childEntry:  child,
					visiblePath: filepath.Join(next.visiblePath, child.name),
					depth:       next.depth + 1,
				})
			}
		}
		if scanned >= input.maxEntriesScanned {
			break
		}
		if input.confidentThreshold > 0 && scanned >= input.confidentThreshold {
			query := input.plan.normalizedQuery
			if query == "" {
				query = input.plan.searchTerm
			}
			if hasConfidentResult(ranked, query) {
				break
			}
		}
	}
	return ranked
}

func shouldDiscover(entry childEntry, input *searchInput) bool {
	if entry.kind == KindFile {
		return input.includeFiles && !strings.HasPrefix(entry.name, ".")
	}
	if ignoredDirectoryNames[entry.name] {
		return false
	}
	if !strings.HasPrefix(entry.name, ".") {
		return true
	}
	return input.hiddenDirectoryNames[entry.name]
}

func shouldSuggest(entry traversedEntry, input *searchInput) bool {
	if strings.HasPrefix(entry.name, ".") {
		return false
	}
	if entry.kind == KindDirectory && !input.includeDirectories {
		return false
	}
	if entry.kind == KindFile && !input.includeFiles {
		return false
	}
	if input.plan.normalizedQuery == "" {
		return true
	}
	if input.mode == ModeSuffix {
		return suffixMatches(entry.visiblePath, input.root, input.plan.normalizedQuery)
	}
	return rank(entry, input).matchTier != noMatchTier
}

func rank(entry traversedEntry, input *searchInput) rankedEntry {
	relativePath := normalizeRelative(input.root, entry.visiblePath)
	lowerPath := strings.ToLower(relativePath)
	query := rankQuery(input)
	segments := []string{}
	if lowerPath != "." && lowerPath != "" {
		segments = strings.Split(lowerPath, "/")
	}
	var pathScore *match.Score
	if query != "" {
		pathScore = match.MatchPath(query, relativePath)
	}

	var fields rankedEntry
	if input.plan.isPathQuery {
		fields.matchTier = noMatchTier
		if pathScore != nil {
			fields.matchTier = min(pathScore.Tier, 4)
			fields.matchOffset = pathScore.Offset
			fields.fuzzyScore = pathScore.Spread
		} else {
			fields.matchOffset = noMatchOffset
			fields.fuzzyScore = noFuzzyScore
		}
		fields.segmentIndex = noSegmentIndex
	} else {
		fields = rankTextMatch(query, lowerPath, input.pathFormat, pathScore, segments)
	}
	fields.path = entry.visiblePath
	fields.kind = entry.kind
	if relativePath == "." {
		fields.depth = 0
	} else {
		fields.depth = len(segments)
	}
	return fields
}

func rankQuery(input *searchInput) string {
	q := input.plan.searchTerm
	if input.plan.isPathQuery {
		q = input.plan.normalizedQuery
	}
	return strings.ToLower(q)
}

func rankTextMatch(query, lowerPath string, format PathFormat, pathScore *match.Score, segments []string) rankedEntry {
	offset := strings.Index(lowerPath, query)
	lastSegment := ""
	if len(segments) > 0 {
		lastSegment = segments[len(segments)-1]
	}
	fuzzyScore, hasFuzzy := scoreFuzzySubsequence(query, lastSegment)

	if query == "" {
		return rankedEntry{matchTier: 3, segmentIndex: noSegmentIndex, matchOffset: noMatchOffset, fuzzyScore: noFuzzyScore}
	}

	if tier, idx, ok := rankSegmentMatch(query, segments); ok {
		return rankedEntry{
			matchTier:    tier,
			segmentIndex: idx,
			matchOffset:  offsetOrNoMatch(offset),
			fuzzyScore:   fuzzyOrNoScore(fuzzyScore, hasFuzzy),
		}
	}
	prefixed := offset >= 0
	if format == FormatRelative {
		prefixed = strings.HasPrefix(lowerPath, query)
	}
	if prefixed {
		return rankedEntry{matchTier: 3, segmentIndex: noSegmentIndex, matchOffset: offset, fuzzyScore: fuzzyOrNoScore(fuzzyScore, hasFuzzy)}
	}
	if hasFuzzy {
		mo := noMatchOffset
		if offset >= 0 {
			mo = offset
		}
		return rankedEntry{matchTier: 4, segmentIndex: noSegmentIndex, matchOffset: mo, fuzzyScore: fuzzyScore}
	}
	if pathScore != nil {
		return rankedEntry{
			matchTier:    min(pathScore.Tier, 4),
			segmentIndex: noSegmentIndex,
			matchOffset:  pathScore.Offset,
			fuzzyScore:   pathScore.Spread,
		}
	}
	return rankedEntry{matchTier: noMatchTier, segmentIndex: noSegmentIndex, matchOffset: noMatchOffset, fuzzyScore: noFuzzyScore}
}

func rankSegmentMatch(query string, segments []string) (int, int, bool) {
	for i, segment := range segments {
		if segment == query {
			return 0, i, true
		}
	}
	for i, segment := range segments {
		if strings.HasPrefix(segment, query) {
			return 1, i, true
		}
	}
	for i, segment := range segments {
		if strings.Contains(segment, query) {
			return 2, i, true
		}
	}
	return 0, 0, false
}

func offsetOrNoMatch(offset int) int {
	if offset >= 0 {
		return offset
	}
	return noMatchOffset
}

func fuzzyOrNoScore(score int, has bool) int {
	if has {
		return score
	}
	return noFuzzyScore
}

// scoreFuzzySubsequence counts skipped characters when query appears as a subsequence of text.
func scoreFuzzySubsequence(query, text string) (int, bool) {
	if query == "" {
		return 0, false
	}
	qi := 0
	first, last := -1, -1
	for ti := 0; ti < len(text) && qi < len(query); ti++ {
		if text[ti] != query[qi] {
			continue
		}
		if first == -1 {
			first = ti
		}
		last = ti
		qi++
	}
	if qi != len(query) || first == -1 {
		return 0, false
	}
	return last - first + 1 - len(query), true
}

func sortAndFormat(entries []rankedEntry, root string, format PathFormat) []Entry {
	seen := map[string]rankedEntry{}
	for _, entry := range entries {
		key := string(entry.kind) + ":" + entry.path
		existing, ok := seen[key]
		if !ok || compareRank(entry, existing) < 0 {
			seen[key] = entry
		}
	}
	unique := make([]rankedEntry, 0, len(seen))
	for _, entry := range seen {
		unique = append(unique, entry)
	}
	sort.Slice(unique, func(i, j int) bool { return compareRank(unique[i], unique[j]) < 0 })

	out := make([]Entry, 0, len(unique))
	for _, entry := range unique {
		out = append(out, Entry{Path: formatPath(entry.path, root, format), Kind: entry.kind})
	}
	return out
}

func compareRank(left, right rankedEntry) int {
	switch {
	case left.matchTier != right.matchTier:
		return left.matchTier - right.matchTier
	case left.segmentIndex != right.segmentIndex:
		return left.segmentIndex - right.segmentIndex
	case left.matchOffset != right.matchOffset:
		return left.matchOffset - right.matchOffset
	case left.fuzzyScore != right.fuzzyScore:
		return left.fuzzyScore - right.fuzzyScore
	case left.depth != right.depth:
		return left.depth - right.depth
	case left.kind != right.kind:
		if left.kind == KindDirectory {
			return -1
		}
		return 1
	default:
		return strings.Compare(left.path, right.path)
	}
}

func hasConfidentResult(entries []rankedEntry, query string) bool {
	maxFuzzy := len(query) * 2
	for _, entry := range entries {
		if entry.matchTier < 4 || (entry.matchTier == 4 && entry.fuzzyScore <= maxFuzzy) {
			return true
		}
	}
	return false
}

func suffixMatches(visiblePath, root, query string) bool {
	querySegments := nonEmpty(strings.Split(strings.ToLower(query), "/"))
	if len(querySegments) == 0 {
		return false
	}
	pathSegments := nonEmpty(strings.Split(strings.ToLower(normalizeRelative(root, visiblePath)), "/"))
	offset := len(pathSegments) - len(querySegments)
	if offset < 0 {
		return false
	}
	for i, segment := range querySegments {
		if pathSegments[offset+i] != segment {
			return false
		}
	}
	return true
}

func nonEmpty(parts []string) []string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
