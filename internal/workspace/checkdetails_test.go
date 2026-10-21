package workspace

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The check run alone says "this failed"; the annotations say what broke, which is the only
// thing the user can act on.
func TestCheckDetailsIncludesAnnotations(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
case "$*" in
  *annotations*) echo '[{"path":"src/a.ts","start_line":3,"end_line":3,"annotation_level":"failure","message":"expected 2 got 3","title":"assert"}]' ;;
  *) echo '{"id":42,"name":"build","status":"completed","conclusion":"failure","html_url":"https://gh/1","details_url":"https://gh/2","output":{"title":"Build failed","summary":"see annotation"},"check_suite":{"workflow_run_id":77}}' ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	details, err := CheckDetails(t.Context(), "github", dir, 42)
	if err != nil {
		t.Fatal(err)
	}
	if details["checkRunId"] != 42 || details["name"] != "build" {
		t.Fatalf("identity: %+v", details)
	}
	if details["conclusion"] != "failure" {
		t.Fatalf("conclusion: %v", details["conclusion"])
	}
	if details["workflowRunId"] != int64(77) {
		t.Fatalf("workflowRunId: %v", details["workflowRunId"])
	}
	output, ok := details["output"].(map[string]any)
	if !ok || output["title"] != "Build failed" {
		t.Fatalf("output: %+v", details["output"])
	}
	annotations, ok := details["annotations"].([]map[string]any)
	if !ok || len(annotations) != 1 {
		t.Fatalf("annotations: %+v", details["annotations"])
	}
	if annotations[0]["message"] != "expected 2 got 3" || annotations[0]["annotationLevel"] != "failure" {
		t.Fatalf("annotation: %+v", annotations[0])
	}
}

// A non-GitHub forge has no check runs; saying so beats returning an empty object the UI shows
// as "no details".
func TestCheckDetailsRejectsOtherForges(t *testing.T) {
	if _, err := CheckDetails(t.Context(), "gitlab", "/tmp", 1); err == nil {
		t.Fatal("expected an error for a non-GitHub forge")
	}
	if _, err := CheckDetails(t.Context(), "github", "/tmp", 0); err == nil {
		t.Fatal("expected an error for a missing check run id")
	}
}
