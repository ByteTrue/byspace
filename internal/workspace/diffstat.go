package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

// CheckoutDiffStat is the additions/deletions summary the composer shows for a checkout.
type CheckoutDiffStat struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

// untrackedShortstatMaxFiles bounds how many untracked files the shortstat walk reads. Ported
// from the node daemon, which stops at 500 so a checkout with a build output directory cannot
// block the status call.
const untrackedShortstatMaxFiles = 500

// perFileDiffMaxBytes skips untracked files big enough that reading them is the whole cost.
const perFileDiffMaxBytes = 1024 * 1024

// GetCheckoutDiffStat summarizes the work the checkout carries relative to its comparison base.
//
// Ported from getCheckoutShortstatUncached. The comparison is NOT `git status`: a clean tree on a
// feature branch still has work to show, and the composer's diff pill has to agree with what the
// Changes pane would open. Hence merge-base against the base ref, then `diff --shortstat`, plus a
// manual count of untracked files because `--shortstat` ignores them and a brand-new file is the
// most visible kind of change there is.
//
// Returns nil when there is nothing to report — not git, no comparison ref, or a genuinely
// unchanged tree.
func GetCheckoutDiffStat(ctx context.Context, cwd string) *CheckoutDiffStat {
	topLevel, err := runGit(ctx, cwd, "rev-parse", "--show-toplevel")
	if err != nil || topLevel == "" {
		return nil
	}
	branch, _ := runGit(ctx, topLevel, "symbolic-ref", "--quiet", "--short", "HEAD")
	if branch == "" {
		// A detached HEAD has no branch to compare against, and diffing against the base would
		// report the whole divergence from that base as this checkout's work.
		return nil
	}

	comparisonRef := resolveShortstatComparisonRef(ctx, topLevel, branch)
	if comparisonRef == "" {
		return nil
	}
	mergeBase, err := runGit(ctx, topLevel, "merge-base", "HEAD", comparisonRef)
	if err != nil || mergeBase == "" {
		return nil
	}

	shortstat, _ := runGit(ctx, topLevel, "diff", "--shortstat", mergeBase)
	additions, deletions, tracked := parseCheckoutShortstat(shortstat)
	untracked := countUntrackedAdditions(ctx, topLevel)

	if tracked {
		return &CheckoutDiffStat{Additions: additions + untracked, Deletions: deletions}
	}
	if untracked > 0 {
		return &CheckoutDiffStat{Additions: untracked, Deletions: 0}
	}
	return nil
}

// resolveShortstatComparisonRef picks the ref the shortstat compares HEAD against.
//
// A feature branch compares against its base. When the branch IS the base, the interesting
// comparison is the branch's own upstream, so a local commit on main still shows a diff pill
// instead of disappearing the moment the branch stops differing from itself.
func resolveShortstatComparisonRef(ctx context.Context, cwd, currentBranch string) string {
	base := ResolveDiffBaseRef(ctx, cwd)
	if base != "" && base != currentBranch {
		name := strings.TrimPrefix(BranchNameFromRef(base), "origin/")
		if name == "" {
			return ""
		}
		if refExists(ctx, cwd, "refs/remotes/origin/"+name) {
			return "origin/" + name
		}
		if refExists(ctx, cwd, "refs/heads/"+name) {
			return name
		}
		return ""
	}
	if refExists(ctx, cwd, "refs/remotes/origin/"+currentBranch) {
		return "origin/" + currentBranch
	}
	return ""
}

func refExists(ctx context.Context, cwd, fullRef string) bool {
	_, err := runGit(ctx, cwd, "show-ref", "--verify", "--quiet", fullRef)
	return err == nil
}

// parseCheckoutShortstat reads `git diff --shortstat` output.
//
// The third return value separates "nothing changed" from "only one side changed": git omits the
// half of the sentence whose count is zero, so `1 file changed, 2 insertions(+)` carries no
// deletion clause at all.
func parseCheckoutShortstat(text string) (int, int, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0, 0, false
	}
	additions := numberBeforeWord(trimmed, "insertion")
	deletions := numberBeforeWord(trimmed, "deletion")
	if additions == 0 && deletions == 0 {
		return 0, 0, false
	}
	return additions, deletions, true
}

// numberBeforeWord returns the integer written immediately before word, or 0.
func numberBeforeWord(text, word string) int {
	index := strings.Index(text, word)
	if index < 0 {
		return 0
	}
	end := index
	for end > 0 && text[end-1] == ' ' {
		end--
	}
	start := end
	for start > 0 && text[start-1] >= '0' && text[start-1] <= '9' {
		start--
	}
	if start == end {
		return 0
	}
	value := 0
	for _, digit := range text[start:end] {
		value = value*10 + int(digit-'0')
	}
	return value
}

// countUntrackedAdditions counts the lines a checkout's untracked files would add.
//
// `git diff --shortstat` reports tracked paths only, so a workspace whose sole change is a new
// file produced no diff stat and the composer pill never appeared.
func countUntrackedAdditions(ctx context.Context, cwd string) int {
	listing, err := runGit(ctx, cwd, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return 0
	}
	total := 0
	counted := 0
	for _, file := range strings.Split(listing, "\n") {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}
		counted++
		if counted > untrackedShortstatMaxFiles {
			break
		}
		absolute := filepath.Join(cwd, file)
		info, statErr := os.Stat(absolute)
		if statErr != nil || info.IsDir() || info.Size() > perFileDiffMaxBytes {
			continue
		}
		content, readErr := os.ReadFile(absolute)
		if readErr != nil || len(content) == 0 {
			continue
		}
		if isLikelyBinary(content) {
			continue
		}
		normalized := strings.ReplaceAll(string(content), "\r\n", "\n")
		lineCount := strings.Count(normalized, "\n") + 1
		if strings.HasSuffix(normalized, "\n") {
			lineCount--
		}
		total += lineCount
	}
	return total
}

// isLikelyBinary reports whether content looks binary: a NUL byte in the first probe window.
func isLikelyBinary(content []byte) bool {
	window := content
	if len(window) > 8000 {
		window = window[:8000]
	}
	for _, b := range window {
		if b == 0 {
			return true
		}
	}
	return false
}
