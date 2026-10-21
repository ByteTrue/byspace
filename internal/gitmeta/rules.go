// Package gitmeta classifies changes inside a repository's git directory.
//
// Ported from git-metadata-event-rules.ts. A `.git` directory changes constantly during ordinary
// work — index refreshes, ref updates, object packs, reflog writes — and most of it is
// irrelevant to what the UI shows. Deciding *which* change matters is what keeps a watcher from
// re-reading the whole working tree on every keystroke the user's editor triggers.
//
// The distinction the rules draw:
//
//   - "owner" — only the worktree whose .git this is needs a refresh
//   - "all"   — every worktree of the repository needs one (shared state)
//   - "ref"   — only a branch list changed, not the working tree
//   - "ignore"— nothing the UI shows
package gitmeta

import "strings"

// Scope says which git directory a path came from.
type Scope string

const (
	// ScopeWorktree is the per-worktree directory (`<repo>/.git/worktrees/<name>` or a
	// submodule's `.git`).
	ScopeWorktree Scope = "worktree"
	// ScopeCommon is the shared directory (`<repo>/.git`).
	ScopeCommon Scope = "common"
)

// Kind is the effect a changed path has.
type Kind string

const (
	KindIgnore Kind = "ignore"
	KindOwner  Kind = "owner"
	KindAll    Kind = "all"
	KindRef    Kind = "ref"
)

// Effect describes what a changed path means.
type Effect struct {
	Kind Kind
	// RefreshBase asks for the diff base to be recomputed, not just the working tree.
	RefreshBase bool
	// Namespace is "local" or "remote" for KindRef.
	Namespace string
	// Ref is the branch name for KindRef.
	Ref string
}

type matchKind int

const (
	matchExact matchKind = iota
	matchPrefix
	matchSuffix
)

type rule struct {
	scope       Scope // empty means "both"
	match       matchKind
	path        string
	kind        Kind
	refreshBase bool
	namespace   string
	prune       bool
}

// rules are ordered: the first match wins, so specific entries precede broad ones.
var rules = []rule{
	// Any lock file is transient git bookkeeping.
	{match: matchSuffix, path: ".lock", kind: KindIgnore},

	// Per-worktree state.
	{scope: ScopeWorktree, match: matchExact, path: "index", kind: KindOwner},
	{scope: ScopeWorktree, match: matchExact, path: "HEAD", kind: KindOwner, refreshBase: true},
	{scope: ScopeWorktree, match: matchExact, path: "config.worktree", kind: KindOwner, refreshBase: true},
	{scope: ScopeWorktree, match: matchExact, path: "byspace/worktree.json", kind: KindOwner, refreshBase: true},

	// Shared state that only the owning worktree needs.
	{scope: ScopeCommon, match: matchExact, path: "index", kind: KindOwner},
	{scope: ScopeCommon, match: matchExact, path: "HEAD", kind: KindOwner, refreshBase: true},

	// Branch names: only the branch list changed.
	{scope: ScopeCommon, match: matchPrefix, path: "refs/heads/", kind: KindRef, namespace: "local"},
	{scope: ScopeCommon, match: matchPrefix, path: "refs/remotes/", kind: KindRef, namespace: "remote"},

	// Shared state every worktree must re-read.
	{scope: ScopeCommon, match: matchExact, path: "packed-refs", kind: KindAll, refreshBase: true},
	{scope: ScopeCommon, match: matchPrefix, path: "reftable/", kind: KindAll, refreshBase: true},
	{scope: ScopeCommon, match: matchExact, path: "config", kind: KindAll, refreshBase: true},

	// Noise that must never trigger a refresh.
	{scope: ScopeCommon, match: matchPrefix, path: "worktrees/", kind: KindIgnore},
	{scope: ScopeCommon, match: matchPrefix, path: "hooks/", kind: KindIgnore, prune: true},
	{scope: ScopeCommon, match: matchPrefix, path: "logs/", kind: KindIgnore, prune: true},
	{scope: ScopeCommon, match: matchPrefix, path: "objects/", kind: KindIgnore, prune: true},
}

// Classify returns what a changed path inside the git directory means.
//
// The classification is deliberately conservative: an unrecognised path is ignored rather than
// triggering a refresh. Git adds new internal files regularly, and an unknown one is far more
// likely to be bookkeeping than a change the user can see.
func Classify(scope Scope, inputPath string) Effect {
	path := strings.ReplaceAll(inputPath, `\`, "/")
	for _, r := range rules {
		if r.scope != "" && r.scope != scope {
			continue
		}
		if !matches(r.match, r.path, path) {
			continue
		}
		switch r.kind {
		case KindIgnore:
			return Effect{Kind: KindIgnore}
		case KindRef:
			return Effect{Kind: KindRef, Namespace: r.namespace, Ref: strings.TrimPrefix(path, r.path)}
		default:
			return Effect{Kind: r.kind, RefreshBase: r.refreshBase}
		}
	}
	return Effect{Kind: KindIgnore}
}

// PrunedPaths lists prefix rules whose subtree a watcher should not descend into.
//
// Watching `objects/` on a busy repository costs more than the refreshes it would trigger.
func PrunedPaths(scope Scope) []string {
	out := make([]string, 0, 3)
	for _, r := range rules {
		if !r.prune || r.match != matchPrefix {
			continue
		}
		if r.scope != "" && r.scope != scope {
			continue
		}
		out = append(out, strings.TrimSuffix(r.path, "/"))
	}
	return out
}

func matches(kind matchKind, pattern, path string) bool {
	switch kind {
	case matchExact:
		return path == pattern
	case matchSuffix:
		return strings.HasSuffix(path, pattern)
	default:
		// A prefix rule also matches the directory itself without its trailing slash.
		return path == strings.TrimSuffix(pattern, "/") || strings.HasPrefix(path, pattern)
	}
}
