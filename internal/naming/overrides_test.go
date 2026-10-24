package naming

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A repository whose byspace.json says "use conventional commits with a scope" expects every generated commit
// message to follow it.
func TestReadProjectOverrides(t *testing.T) {
	dir := t.TempDir()
	body := `{
		"metadataGeneration": {
			"commitMessage": {"instructions": "  Use conventional commits with a scope.  "},
			"title": {"instructions": "   "},
			"pullRequest": {"other": 1}
		}
	}`
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	overrides := ReadProjectOverrides(dir)
	if got := overrides.Style(ArtifactCommitMessage); got != "Use conventional commits with a scope." {
		t.Fatalf("commitMessage = %q", got)
	}
	// A blank instruction is no instruction: falling back to the default is right, and an empty override would
	// otherwise delete the style block entirely.
	if got := overrides.Style(ArtifactTitle); got != "" {
		t.Fatalf("title = %q", got)
	}
	if got := overrides.Style(ArtifactPullRequest); got != "" {
		t.Fatalf("pullRequest = %q", got)
	}
}

// A project without the setting is the common case and must not cost an error path.
func TestReadProjectOverridesMissing(t *testing.T) {
	for name, body := range map[string]string{
		"absent":           "",
		"broken":           "{not json",
		"no-section":       `{"setup": "npm ci"}`,
		"empty-generation": `{"metadataGeneration": {}}`,
	} {
		dir := t.TempDir()
		if body != "" {
			if err := os.WriteFile(filepath.Join(dir, "byspace.json"), []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		if got := ReadProjectOverrides(dir); got != nil {
			t.Fatalf("%s = %+v", name, got)
		}
	}
}

// Replacement rather than appending: two conflicting instructions are reconciled inconsistently by the model.
func TestStylePromptReplacesStyle(t *testing.T) {
	custom := stylePrompt(Prompt, "Use conventional commits.", seedMarker)
	if !strings.Contains(custom, "Use conventional commits.") {
		t.Fatalf("override missing: %q", custom)
	}
	// The material stays last, so the model does not read the seed then an instruction.
	if !strings.HasSuffix(strings.TrimSpace(custom), "Material:") {
		t.Fatalf("material is not last: %q", custom[:80])
	}
	// The contract survives: only the style is overridable.
	if !strings.Contains(custom, "Reply with a single JSON object") {
		t.Fatal("the contract was dropped")
	}

	// No override leaves the prompt untouched.
	if got := stylePrompt(Prompt, "", seedMarker); got != Prompt {
		t.Fatal("the prompt changed without an override")
	}
	if got := stylePrompt(Prompt, "   ", seedMarker); got != Prompt {
		t.Fatal("a blank override changed the prompt")
	}
}

// The commit and PR prompts use their own marker.
func TestStylePromptCommitMarker(t *testing.T) {
	custom := stylePrompt(CommitMessagePrompt, "Conventional commits.", skipMarker)
	if !strings.Contains(custom, "Conventional commits.") {
		t.Fatalf("override missing: %q", custom)
	}
	if !strings.HasSuffix(strings.TrimSpace(custom), "Diff:") {
		t.Fatalf("diff is not last: %q", custom[len(custom)-30:])
	}
}

func TestApplyStyle(t *testing.T) {
	if got := applyStyle("default", ""); got != "default" {
		t.Fatalf("got %q", got)
	}
	if got := applyStyle("default", "  custom  "); got != "custom" {
		t.Fatalf("got %q", got)
	}
}
