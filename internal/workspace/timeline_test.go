package workspace

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A review and a comment must arrive in the same shape: the client discriminates on `kind` and
// would otherwise render a review as an empty comment.
func TestDecodeGitHubReviews(t *testing.T) {
	raw := `[
	  {"id":1,"user":{"login":"alice","avatar_url":"https://a/x.png","html_url":"https://github.com/alice"},
	   "body":"LGTM","submitted_at":"2026-01-02T03:04:05Z","html_url":"https://github.com/pull/1#r1","state":"APPROVED"},
	  {"id":2,"user":{"login":"bob"},"body":"please fix","submitted_at":"2026-01-03T00:00:00Z","state":"CHANGES_REQUESTED"}
	]`
	items := decodeGitHubReviews(raw)
	if len(items) != 2 {
		t.Fatalf("got %d items", len(items))
	}
	if items[0]["kind"] != "review" || items[0]["reviewState"] != "approved" {
		t.Fatalf("approved review: %+v", items[0])
	}
	if items[1]["reviewState"] != "changes_requested" {
		t.Fatalf("changes requested: %+v", items[1])
	}
	// createdAt must be epoch milliseconds, not the raw string: the client sorts numerically.
	if created, ok := items[0]["createdAt"].(int64); !ok || created <= 0 {
		t.Fatalf("createdAt = %v", items[0]["createdAt"])
	}
	if items[0]["author"] != "alice" || items[0]["avatarUrl"] != "https://a/x.png" {
		t.Fatalf("author fields: %+v", items[0])
	}
}

func TestDecodeGitHubComments(t *testing.T) {
	raw := `[{"id":5,"user":{"login":"carol"},"body":"note","created_at":"2026-02-01T00:00:00Z","html_url":"u"}]`
	items := decodeGitHubComments(raw)
	if len(items) != 1 || items[0]["kind"] != "comment" || items[0]["body"] != "note" {
		t.Fatalf("%+v", items)
	}
	if _, hasReviewState := items[0]["reviewState"]; hasReviewState {
		t.Fatal("a comment must not carry reviewState: the schema rejects it")
	}
}

// A long thread that stops at the limit without saying so looks like the conversation ended.
func TestSortAndLimitTimelineReportsTruncation(t *testing.T) {
	items := []map[string]any{
		{"createdAt": int64(300)},
		{"createdAt": int64(100)},
		{"createdAt": int64(200)},
	}
	sorted, truncated, err := sortAndLimitTimeline(items, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated {
		t.Fatal("dropping an item must be reported")
	}
	if sorted[0]["createdAt"] != int64(100) || sorted[1]["createdAt"] != int64(200) {
		t.Fatalf("order: %v", sorted)
	}

	sorted, truncated, _ = sortAndLimitTimeline(items, 10)
	if truncated || len(sorted) != 3 {
		t.Fatalf("under the limit: truncated=%v len=%d", truncated, len(sorted))
	}
}

// GitLab models a review as a system note carrying approval text.
func TestDecodeGitLabNotesPromotesApproval(t *testing.T) {
	raw := `[
	  {"id":1,"author":{"username":"dev"},"body":"Approved","system":true,"created_at":"2026-01-01T00:00:00Z"},
	  {"id":2,"author":{"username":"dev"},"body":"a comment","system":false,"created_at":"2026-01-02T00:00:00Z"}
	]`
	items, truncated, err := decodeGitLabNotes(raw, 10)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("unexpected truncation")
	}
	if items[0]["kind"] != "review" || items[0]["reviewState"] != "approved" {
		t.Fatalf("approval note: %+v", items[0])
	}
	if items[1]["kind"] != "comment" {
		t.Fatalf("plain note: %+v", items[1])
	}
}

func TestParseUnixOrISO(t *testing.T) {
	if got := parseUnixOrISO("2026-01-01T00:00:00Z"); got == 0 {
		t.Fatal("ISO timestamp not parsed")
	}
	if got := parseUnixOrISO(float64(1700000000)); got != 1700000000000 {
		t.Fatalf("epoch seconds: %d", got)
	}
	if got := parseUnixOrISO(""); got != 0 {
		t.Fatalf("empty: %d", got)
	}
	if got := parseUnixOrISO(nil); got != 0 {
		t.Fatalf("nil: %d", got)
	}
}

// End to end through the real gh invocation path, with a stub `gh` on PATH.
func TestPullRequestTimelineUsesGH(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "gh")
	script := `#!/bin/sh
case "$*" in
  *reviews*) echo '[{"id":1,"user":{"login":"alice"},"body":"ok","state":"APPROVED","submitted_at":"2026-01-01T00:00:00Z"}]' ;;
  *comments*) echo '[{"id":2,"user":{"login":"bob"},"body":"hi","created_at":"2026-01-02T00:00:00Z"}]' ;;
  *) echo '[]' ;;
esac
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	// A .git directory makes DetectForge resolve to github.
	repo := filepath.Join(dir, "repo")
	if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, ".git", "config"),
		[]byte("[remote \"origin\"]\n\turl = https://github.com/acme/repo.git\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	items, truncated, err := PullRequestTimeline(t.Context(), "github", repo, 7, 50)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("unexpected truncation")
	}
	if len(items) != 2 {
		t.Fatalf("got %d items: %+v", len(items), items)
	}
	if items[0]["kind"] != "review" || items[1]["kind"] != "comment" {
		t.Fatalf("kinds: %v, %v", items[0]["kind"], items[1]["kind"])
	}
	if !strings.Contains(items[0]["body"].(string), "ok") {
		t.Fatalf("body: %v", items[0]["body"])
	}
}
