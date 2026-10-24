package naming

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Artifact keys a project can override.
const (
	ArtifactTitle         = "title"
	ArtifactBranchName    = "branchName"
	ArtifactCommitMessage = "commitMessage"
	ArtifactPullRequest   = "pullRequest"
)

// ProjectOverrides holds a project's own style instructions, keyed by artifact.
//
// Ported from build-metadata-prompt.ts. A repository whose byspace.json says "use conventional commits with a
// scope" expects every generated commit message to follow it; Go ignored the setting entirely, so every
// project got the built-in wording.
type ProjectOverrides map[string]string

// ReadProjectOverrides reads `metadataGeneration.<artifact>.instructions` from byspace.json.
//
// Returns nil when there is no file, no section, or nothing readable — a project without the setting is the
// common case and must not cost an error path at every call site.
func ReadProjectOverrides(cwd string) ProjectOverrides {
	path := filepath.Join(cwd, "byspace.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var config map[string]any
	if json.Unmarshal(raw, &config) != nil {
		return nil
	}
	generation, ok := config["metadataGeneration"].(map[string]any)
	if !ok {
		return nil
	}
	out := make(ProjectOverrides, len(generation))
	for key, value := range generation {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		instructions, ok := entry["instructions"].(string)
		if !ok {
			continue
		}
		if trimmed := strings.TrimSpace(instructions); trimmed != "" {
			out[key] = trimmed
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// Style returns the project's instructions for an artifact, or "" when it has none.
func (o ProjectOverrides) Style(artifact string) string {
	if o == nil {
		return ""
	}
	return o[artifact]
}

// applyStyle replaces a default style block with the project's own.
//
// Replacement rather than appending, deliberately: a project that says "conventional commits" and a default
// that says "imperative mood, no prefix" are two instructions the model has to reconcile, and it does so
// inconsistently. The project owner's text is the authority.
func applyStyle(defaultBlock, override string) string {
	if strings.TrimSpace(override) == "" {
		return defaultBlock
	}
	return strings.TrimSpace(override)
}
