package workspace

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HasUncommittedSetupChanges reports whether a project's worktree setup differs from what is committed.
//
// Ported from worktree-setup-commit-status.ts. A worktree is created from a COMMIT, so setup commands that exist
// only in the working tree do not run for it — the user sees a new worktree with no node_modules and has no
// reason to connect that to an uncommitted byspace.json. The client renders a warning from this flag; Go never
// sent it, so the warning never appeared.
func HasUncommittedSetupChanges(ctx context.Context, repoRoot string) bool {
	gitPath, ok := configGitPath(ctx, repoRoot)
	if !ok {
		// No committed byspace.json and nothing to compare: nothing to warn about.
		return false
	}

	committed, committedOK := readCommittedConfig(ctx, repoRoot, gitPath)
	current, currentOK := readWorkingConfig(repoRoot)
	if !committedOK && !currentOK {
		return false
	}

	currentSetup := setupCommands(current)
	committedSetup := setupCommands(committed)
	return !equalStrings(currentSetup, committedSetup)
}

// configGitPath returns byspace.json's path relative to the repository root.
//
// `rev-parse --show-prefix` handles a project that lives in a subdirectory: the config path git knows about is
// `<prefix>byspace.json`, not the bare name.
func configGitPath(ctx context.Context, repoRoot string) (string, bool) {
	prefix, err := runGitCommandOutput(ctx, repoRoot, "rev-parse", "--show-prefix")
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(prefix) + "byspace.json", true
}

// readCommittedConfig reads byspace.json as of HEAD.
//
// Returns false when HEAD does not contain the file, which is the normal state before the first commit.
func readCommittedConfig(ctx context.Context, repoRoot, gitPath string) (map[string]any, bool) {
	if _, err := runGitCommandOutput(ctx, repoRoot, "rev-parse", "--verify", "HEAD"); err != nil {
		return nil, false
	}
	// `cat-file -e` distinguishes "not tracked" from "empty file": reading a missing path errors, but the
	// caller cannot tell why.
	if _, err := runGitCommandOutput(ctx, repoRoot, "cat-file", "-e", "HEAD:"+gitPath); err != nil {
		return nil, false
	}
	raw, err := runGitCommandOutput(ctx, repoRoot, "show", "HEAD:"+gitPath)
	if err != nil {
		return nil, false
	}
	var parsed map[string]any
	if json.Unmarshal([]byte(raw), &parsed) != nil {
		return nil, false
	}
	return parsed, true
}

// readWorkingConfig reads byspace.json from disk.
func readWorkingConfig(repoRoot string) (map[string]any, bool) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "byspace.json"))
	if err != nil {
		return nil, false
	}
	var parsed map[string]any
	if json.Unmarshal(raw, &parsed) != nil {
		return nil, false
	}
	return parsed, true
}

// setupCommands extracts the normalized setup commands from a config document.
//
// `worktree.setup` accepts a string, an array of strings, or an array of objects; all three normalize to the
// same list. Comparing raw JSON instead would report a difference between `"npm ci"` and `["npm ci"]` that has
// no effect on what runs.
func setupCommands(config map[string]any) []string {
	if config == nil {
		return nil
	}
	worktree, ok := config["worktree"].(map[string]any)
	if !ok {
		return nil
	}
	return normalizeSetupValue(worktree["setup"])
}

// normalizeSetupValue flattens the three accepted setup shapes.
func normalizeSetupValue(value any) []string {
	switch typed := value.(type) {
	case string:
		if trimmed := strings.TrimSpace(typed); trimmed != "" {
			return []string{trimmed}
		}
		return nil
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			switch entry := item.(type) {
			case string:
				if trimmed := strings.TrimSpace(entry); trimmed != "" {
					out = append(out, trimmed)
				}
			case map[string]any:
				// The object form carries the command under `command`.
				if command, ok := entry["command"].(string); ok {
					if trimmed := strings.TrimSpace(command); trimmed != "" {
						out = append(out, trimmed)
					}
				}
			}
		}
		return out
	}
	return nil
}

// equalStrings compares two command lists in order.
//
// Order matters: setup runs sequentially, and swapping two commands changes the result even with the same set.
func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// runGitCommandOutput runs a read-only git command and returns its stdout.
func runGitCommandOutput(ctx context.Context, repoRoot string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
