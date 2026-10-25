package workspace

import "strings"

// GitMetadataScope distinguishes the per-worktree git dir from the shared common dir.
//
// A worktree has two: its own (HEAD, index) and the repository's shared one (refs, config, objects).
// A change to `index` affects only that worktree; a change to `refs/heads/main` affects all of them.
type GitMetadataScope string

// Scopes.
const (
	GitScopeWorktree GitMetadataScope = "worktree"
	GitScopeCommon   GitMetadataScope = "common"
)

// GitMetadataEffect is what a change inside `.git` means.
//
// Ported from git-metadata-event-rules.ts. Without this classification every write git makes — the
// index after a `git status`, a lock file during any command, an object being unpacked — looks like
// the user changed a file, and the file watcher pushes an update for each one. Git touches its own
// directory constantly, so most of those updates are noise.
type GitMetadataEffect struct {
	// Kind is "ignore", "owner", "all" or "ref".
	Kind string
	// RefreshBase reports whether the diff base moved (a checkout, a reset).
	RefreshBase bool
	// Namespace is "local" or "remote" for a ref effect.
	Namespace string
	// Ref is the branch name for a ref effect, e.g. "main" or "origin/main".
	Ref string
}

// Rule matching modes.
const (
	gitMatchExact  = "exact"
	gitMatchPrefix = "prefix"
	gitMatchSuffix = "suffix"
)

// gitMetadataRule is one entry of the table.
type gitMetadataRule struct {
	// Scope is a scope value or "both".
	Scope string
	Match string
	Path  string
	// Route is "ignore", "owner", "all", "local-ref" or "remote-ref".
	Route       string
	RefreshBase bool
	// Prune marks a directory whose contents are disposable.
	Prune bool
}

// gitMetadataRules is the table, in match order.
//
// Order matters: `.lock` is a suffix rule that must catch `index.lock` before the exact `index` rule
// does, and the worktree rules come before the common ones so a path present in both resolves to the
// narrower scope.
var gitMetadataRules = []gitMetadataRule{
	// Any lock file is transient by definition.
	{Scope: "both", Match: gitMatchSuffix, Path: ".lock", Route: "ignore"},

	// Per-worktree state.
	{Scope: string(GitScopeWorktree), Match: gitMatchExact, Path: "index", Route: "owner"},
	{Scope: string(GitScopeWorktree), Match: gitMatchExact, Path: "HEAD", Route: "owner", RefreshBase: true},
	{Scope: string(GitScopeWorktree), Match: gitMatchExact, Path: "config.worktree", Route: "owner", RefreshBase: true},
	{Scope: string(GitScopeWorktree), Match: gitMatchExact, Path: "byspace/worktree.json", Route: "owner", RefreshBase: true},

	// Shared state that belongs to the worktree that owns the git dir being watched.
	{Scope: string(GitScopeCommon), Match: gitMatchExact, Path: "index", Route: "owner"},
	{Scope: string(GitScopeCommon), Match: gitMatchExact, Path: "HEAD", Route: "owner", RefreshBase: true},

	// Branch movement: a local branch affects this checkout, a remote one affects what a pull would do.
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "refs/heads/", Route: "local-ref"},
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "refs/remotes/", Route: "remote-ref"},

	// Everything that changes the repository as a whole.
	{Scope: string(GitScopeCommon), Match: gitMatchExact, Path: "packed-refs", Route: "all", RefreshBase: true},
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "reftable/", Route: "all", RefreshBase: true},
	{Scope: string(GitScopeCommon), Match: gitMatchExact, Path: "config", Route: "all", RefreshBase: true},

	// Administration and plumbing: never a user-visible change.
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "worktrees/", Route: "ignore"},
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "hooks/", Route: "ignore", Prune: true},
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "logs/", Route: "ignore", Prune: true},
	{Scope: string(GitScopeCommon), Match: gitMatchPrefix, Path: "objects/", Route: "ignore", Prune: true},
}

// ClassifyGitMetadataPath decides what a change inside `.git` means.
//
// An unmatched path is ignored, not treated as a change: git writes far more than the table names, and
// defaulting to "this is a change" is what produced the noise.
func ClassifyGitMetadataPath(scope GitMetadataScope, inputPath string) GitMetadataEffect {
	// Git writes forward slashes; a Windows path arrives with backslashes.
	normalized := strings.ReplaceAll(inputPath, `\`, "/")
	for _, rule := range gitMetadataRules {
		if rule.Scope != "both" && rule.Scope != string(scope) {
			continue
		}
		if !gitPathMatches(rule.Match, rule.Path, normalized) {
			continue
		}
		switch rule.Route {
		case "owner", "all":
			return GitMetadataEffect{Kind: rule.Route, RefreshBase: rule.RefreshBase}
		case "local-ref":
			return GitMetadataEffect{Kind: "ref", Namespace: "local", Ref: strings.TrimPrefix(normalized, rule.Path)}
		case "remote-ref":
			return GitMetadataEffect{Kind: "ref", Namespace: "remote", Ref: strings.TrimPrefix(normalized, rule.Path)}
		}
		return GitMetadataEffect{Kind: "ignore"}
	}
	return GitMetadataEffect{Kind: "ignore"}
}

// gitPathMatches applies one rule's match mode.
func gitPathMatches(mode, pattern, path string) bool {
	switch mode {
	case gitMatchExact:
		return path == pattern
	case gitMatchPrefix:
		return strings.HasPrefix(path, pattern)
	case gitMatchSuffix:
		return strings.HasSuffix(path, pattern)
	}
	return false
}

// PrunedGitMetadataPaths lists the disposable directories under one scope.
//
// Used to trim what the watcher reports after a burst: the object database and logs change on every
// git command and nothing in them is user-visible.
func PrunedGitMetadataPaths(scope GitMetadataScope) []string {
	out := make([]string, 0, 3)
	for _, rule := range gitMetadataRules {
		if rule.Scope != "both" && rule.Scope != string(scope) {
			continue
		}
		if !rule.Prune || rule.Match != gitMatchPrefix {
			continue
		}
		out = append(out, rule.Path)
	}
	return out
}
