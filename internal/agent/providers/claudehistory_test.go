package providers

import (
	"os"
	"path/filepath"
	"testing"
)

// Resuming by session id is how an imported Claude agent is rebuilt after its process dies. The
// transcript has to be found from the id plus the cwd, or the rebuilt session starts with an empty
// timeline and the imported conversation disappears from the panel.
func TestFindClaudeTranscriptLocatesTheSessionUnderItsCwd(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "worktrees", "review-fix")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	dir := ClaudeProjectDir(cwd, root)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(dir, "fixture-root-03.jsonl")
	if err := os.WriteFile(transcript, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := FindClaudeTranscript("fixture-root-03", cwd, root); got != transcript {
		t.Fatalf("FindClaudeTranscript = %q, want %q", got, transcript)
	}
}

func TestFindClaudeTranscriptReportsNothingForAnUnknownSession(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "elsewhere")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindClaudeTranscript("fixture-nope", cwd, root); got != "" {
		t.Fatalf("FindClaudeTranscript = %q, want empty", got)
	}
	if got := FindClaudeTranscript("", cwd, root); got != "" {
		t.Fatalf("an empty id must resolve to nothing, got %q", got)
	}
}

// Callers sometimes hold the transcript path already (pi, and the .jsonl branch of the claude
// importer). That path has to be accepted as-is rather than re-encoded into a project directory.
func TestFindClaudeTranscriptAcceptsAPath(t *testing.T) {
	root := t.TempDir()
	transcript := filepath.Join(root, "session.jsonl")
	if err := os.WriteFile(transcript, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindClaudeTranscript(transcript, "", ""); got != transcript {
		t.Fatalf("FindClaudeTranscript = %q, want %q", got, transcript)
	}
	if got := FindClaudeTranscript(filepath.Join(root, "missing.jsonl"), "", ""); got != "" {
		t.Fatalf("a missing path must resolve to nothing, got %q", got)
	}
}
