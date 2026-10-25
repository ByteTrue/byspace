package workflowout

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Without this the transcript has a tool card pointing at a path and nothing that shows what the workflow concluded.
func TestReadResultFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "result.json")
	if err := os.WriteFile(path, []byte(`{"result":"the answer"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, ok := ReadResultFile(path)
	if !ok || got != "the answer" {
		t.Fatalf("got %q ok=%v", got, ok)
	}

	// A file that does not exist is "nothing to show", not an error: the workflow may still be writing it.
	if _, ok := ReadResultFile(filepath.Join(dir, "missing.json")); ok {
		t.Fatal("a missing file produced a result")
	}
	if _, ok := ReadResultFile("  "); ok {
		t.Fatal("an empty path produced a result")
	}
}

// An oversized file is not read into memory to render one card.
func TestReadResultFileOversized(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.json")
	// Just past the bound, valid JSON otherwise.
	body := `{"result":"` + strings.Repeat("x", MaxBytes) + `"}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := ReadResultFile(path); ok {
		t.Fatal("an oversized file produced a result")
	}
}

func TestParse(t *testing.T) {
	// Only documents with a `result` key count.
	if _, ok := Parse(`{"other":"x"}`); ok {
		t.Fatal("a document without result produced output")
	}
	if _, ok := Parse(`not json`); ok {
		t.Fatal("malformed JSON produced output")
	}
	if _, ok := Parse(`["array"]`); ok {
		t.Fatal("a top-level array produced output")
	}
}

// A workflow that returns one field wraps it; showing the wrapper instead of the value is worse than showing nothing.
func TestUnwrapSingleValue(t *testing.T) {
	got, ok := Format(map[string]any{"output": map[string]any{"value": "the answer"}})
	if !ok || got != "the answer" {
		t.Fatalf("got %q", got)
	}

	// Two keys is not a wrapper.
	got, ok = Format(map[string]any{"a": "1", "b": "2"})
	if !ok || !strings.HasPrefix(got, "```json") {
		t.Fatalf("got %q", got)
	}
}

// A number or bool is its literal; anything else is JSON in a fenced block, which is what makes a structured result
// readable rather than one long line.
func TestFormat(t *testing.T) {
	if got, _ := Format(42.0); got != "42" {
		t.Fatalf("number = %q", got)
	}
	if got, _ := Format(4.25); got != "4.25" {
		t.Fatalf("fraction = %q", got)
	}
	if got, _ := Format(true); got != "true" {
		t.Fatalf("bool = %q", got)
	}
	if _, ok := Format(nil); ok {
		t.Fatal("nil produced output")
	}
	if _, ok := Format("   "); ok {
		t.Fatal("blank text produced output")
	}

	got, ok := Format(map[string]any{"files": []any{"a.go", "b.go"}})
	if !ok || !strings.HasPrefix(got, "```json") || !strings.Contains(got, "a.go") {
		t.Fatalf("got %q", got)
	}
}

// Beyond this a result stops being readable and starts being a wall.
func TestFormatTruncates(t *testing.T) {
	got, ok := Format(strings.Repeat("y", MaxResultChars+500))
	if !ok {
		t.Fatal("no output")
	}
	// MaxResultChars plus the truncation marker.
	if len(got) > MaxResultChars+8 {
		t.Fatalf("length = %d", len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatal("the truncation is not marked")
	}
}
