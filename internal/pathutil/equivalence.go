// Package pathutil compares filesystem paths.
//
// Ported from utils/path.ts. Two strings can name the same directory: one has a trailing
// separator, one went through a symlink, one came from a shell with `~` expanded differently, and
// on macOS `/tmp` is a symlink to `/private/tmp`. Comparing the raw strings treats them as two
// workspaces, which shows up as a duplicate sidebar entry, an agent attached to "the other"
// workspace, and a diff against the wrong tree.
package pathutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ExpandTilde replaces a leading ~ with the user's home directory.
//
// HOME is checked before os.UserHomeDir so a caller that intentionally overrides HOME (a test, a
// service with a different user context) is honoured.
func ExpandTilde(path string) string {
	if path == "~" {
		return homeDir()
	}
	if strings.HasPrefix(path, "~/") {
		rest := strings.TrimPrefix(path, "~/")
		home := homeDir()
		if home == "" {
			return path
		}
		return filepath.Join(home, rest)
	}
	return path
}

func homeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return ""
}

// AreEquivalent reports whether two paths name the same location.
//
// Symlinks are resolved when the paths exist; a path that does not exist falls back to lexical
// comparison, because a realpath failure must not make two identical strings unequal.
func AreEquivalent(left, right string) bool {
	if left == "" || right == "" {
		return left == right
	}
	lexicalLeft := normalizeForComparison(left)
	lexicalRight := normalizeForComparison(right)
	if lexicalLeft == lexicalRight {
		return true
	}

	realLeft, leftErr := filepath.EvalSymlinks(lexicalLeft)
	realRight, rightErr := filepath.EvalSymlinks(lexicalRight)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return normalizeForComparison(realLeft) == normalizeForComparison(realRight)
}

// EquivalenceMatcher returns a function that reports whether a candidate matches target.
//
// Precomputing the target's variants is what makes this cheap enough to call in a loop over every
// workspace on every request.
func EquivalenceMatcher(target string) func(candidate string) bool {
	targetVariants := collectVariants(target)
	return func(candidate string) bool {
		for _, variant := range collectVariants(candidate) {
			for _, targetVariant := range targetVariants {
				if normalizeForComparison(variant) == normalizeForComparison(targetVariant) {
					return true
				}
			}
		}
		return false
	}
}

// collectVariants lists the spellings a path can take: as given, absolute, and symlink-resolved.
func collectVariants(path string) []string {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	variants := make([]string, 0, 3)
	add := func(value string) {
		if value == "" {
			return
		}
		for _, existing := range variants {
			if existing == value {
				return
			}
		}
		variants = append(variants, value)
	}

	add(ExpandTilde(path))
	if absolute, err := filepath.Abs(ExpandTilde(path)); err == nil {
		add(absolute)
	}
	if resolved, err := filepath.EvalSymlinks(ExpandTilde(path)); err == nil {
		add(resolved)
	}
	return variants
}

// normalizeForComparison cleans a path for string comparison.
//
// Trailing separators are removed (except for a root) because `/tmp/x` and `/tmp/x/` are the same
// directory. Case is folded on Windows and macOS, where the default filesystems are
// case-insensitive — comparing case-sensitively there reports the same directory twice.
func normalizeForComparison(path string) string {
	cleaned := filepath.Clean(path)
	if cleaned == "" {
		return ""
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.ToLower(cleaned)
	}
	return cleaned
}

// IsWithin reports whether child is inside parent.
//
// The separator check is the point: without it `/repo/app` claims to contain `/repo/application`.
func IsWithin(parent, child string) bool {
	cleanedParent := normalizeForComparison(parent)
	cleanedChild := normalizeForComparison(child)
	if cleanedParent == "" || cleanedChild == "" {
		return false
	}
	if cleanedParent == cleanedChild {
		return true
	}
	return strings.HasPrefix(cleanedChild, strings.TrimSuffix(cleanedParent, string(filepath.Separator))+string(filepath.Separator))
}
