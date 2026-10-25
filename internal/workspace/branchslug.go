package workspace

import (
	"fmt"
	"regexp"
	"strings"
)

// Branch slug rules, ported from @bytetrue/protocol/branch-slug.
//
// These are the same rules the client applies before it sends a slug, so a name that passes in
// the UI must not be rejected here — and a name that arrives from an older or third-party client
// must be held to the same standard.

// MaxBranchSlugLength is the protocol's limit for a branch slug.
const MaxBranchSlugLength = 100

// MaxWorktreeSlugLength is the protocol's limit for a generated worktree slug.
const MaxWorktreeSlugLength = 50

var (
	validBranchSlug = regexp.MustCompile(`^[a-z0-9-/]+$`)
	slugDisallowed  = regexp.MustCompile(`[^a-z0-9]+`)
	slugEdgeHyphens = regexp.MustCompile(`^-+|-+$`)
	slugTrailing    = regexp.MustCompile(`-+$`)
)

// ValidateBranchSlug reports whether a branch name is acceptable.
func ValidateBranchSlug(slug string) error {
	if slug == "" {
		return fmt.Errorf("branch name cannot be empty")
	}
	if len(slug) > MaxBranchSlugLength {
		return fmt.Errorf("branch name too long (max %d characters)", MaxBranchSlugLength)
	}
	if !validBranchSlug.MatchString(slug) {
		return fmt.Errorf("branch name must contain only lowercase letters, numbers, hyphens, and forward slashes")
	}
	if strings.HasPrefix(slug, "-") || strings.HasSuffix(slug, "-") {
		return fmt.Errorf("branch name cannot start or end with a hyphen")
	}
	if strings.Contains(slug, "--") {
		return fmt.Errorf("branch name cannot have consecutive hyphens")
	}
	return nil
}

// Slugify turns arbitrary text into a worktree slug.
//
// Truncation prefers a hyphen boundary: cutting mid-word produces a slug that reads as a typo,
// and the boundary is only used when it falls past the halfway point so a long first word is not
// discarded entirely.
func Slugify(input string) string {
	slug := strings.ToLower(input)
	slug = slugDisallowed.ReplaceAllString(slug, "-")
	slug = slugEdgeHyphens.ReplaceAllString(slug, "")
	if len(slug) <= MaxWorktreeSlugLength {
		return slug
	}

	truncated := slug[:MaxWorktreeSlugLength]
	if lastHyphen := strings.LastIndex(truncated, "-"); lastHyphen > MaxWorktreeSlugLength/2 {
		return truncated[:lastHyphen]
	}
	return slugTrailing.ReplaceAllString(truncated, "")
}

// NormalizeWorktreeSlug makes a caller-supplied slug safe, or returns "" when nothing usable is
// left (the caller then generates one).
func NormalizeWorktreeSlug(raw string) string {
	slug := Slugify(strings.TrimSpace(raw))
	if slug == "" {
		return ""
	}
	// A slug becomes a path component, so separators are not allowed even though the branch
	// rules permit slashes.
	slug = strings.ReplaceAll(slug, "/", "-")
	return slug
}
