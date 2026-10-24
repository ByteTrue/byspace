package workspace

import (
	"path/filepath"
	"strings"
)

// WorktreeOwnership answers "is this directory a BySpace-managed worktree, and which one".
type WorktreeOwnership struct {
	Owned bool
	// Root is the per-repository directory BySpace keeps the worktrees of one repo under:
	// <worktrees-base>/<repo-hash>.
	Root string
	// Path is the worktree directory itself: <Root>/<slug>.
	Path string
}

// ResolveWorktreeOwnership decides ownership from the path shape alone.
//
// A BySpace worktree always lives at <worktrees-base>/<repo-hash>/<slug>, and nothing else writes
// under that tree, so the shape is proof even when git has already forgotten the worktree — a
// half-finished archive can leave the working tree without its admin directory, and the directory
// still has to be removable. This matches isBySpaceOwnedWorktreeCwd in the archived Node daemon.
func ResolveWorktreeOwnership(worktreesBaseRoot, cwd string) WorktreeOwnership {
	base := filepath.Clean(strings.TrimSpace(worktreesBaseRoot))
	target := filepath.Clean(strings.TrimSpace(cwd))
	if base == "" || base == "." || target == "" || target == "." {
		return WorktreeOwnership{}
	}
	relative, ok := relativeWithin(base, target)
	if !ok {
		return WorktreeOwnership{}
	}
	parts := strings.FieldsFunc(relative, func(r rune) bool { return r == '/' || r == '\\' })
	// <hash>/<slug> is the minimum: a path directly under the base is not a worktree.
	if len(parts) < 2 {
		return WorktreeOwnership{}
	}
	root := filepath.Join(base, parts[0])
	return WorktreeOwnership{Owned: true, Root: root, Path: filepath.Join(root, parts[1])}
}

// relativeWithin returns target relative to base.
//
// Both sides are expanded to every spelling they can take (as given, absolute, symlink-resolved)
// before comparing, because macOS hands out /tmp and /private/tmp for the same directory and the
// ownership check would otherwise call a BySpace worktree foreign on one spelling only.
func relativeWithin(base, target string) (string, bool) {
	for _, root := range pathVariants(base) {
		for _, candidate := range pathVariants(target) {
			relative, err := filepath.Rel(root, candidate)
			if err != nil || relative == "." {
				continue
			}
			if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				continue
			}
			return relative, true
		}
	}
	return "", false
}

func pathVariants(path string) []string {
	variants := []string{filepath.Clean(path)}
	if absolute, err := filepath.Abs(path); err == nil && absolute != variants[0] {
		variants = append(variants, absolute)
	}
	for _, candidate := range append([]string(nil), variants...) {
		if resolved, err := filepath.EvalSymlinks(candidate); err == nil && !containsPath(variants, resolved) {
			variants = append(variants, resolved)
		}
	}
	return variants
}

func containsPath(list []string, value string) bool {
	for _, existing := range list {
		if existing == value {
			return true
		}
	}
	return false
}
