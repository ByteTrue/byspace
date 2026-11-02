package workspace

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// stubTimelineCommands answers forge CLI calls from a table keyed by the joined arguments.
func stubTimelineCommands(t *testing.T, binary string, responses map[string]string) *[]string {
	t.Helper()
	var mu sync.Mutex
	calls := []string{}
	previous, previousInstalled := runForgeTimelineCommand, forgeCLIInstalled
	forgeCLIInstalled = func(bin string) bool { return bin == binary }
	runForgeTimelineCommand = func(_ context.Context, bin, _ string, args ...string) (string, error) {
		key := strings.Join(args, " ")
		mu.Lock()
		calls = append(calls, bin+" "+key)
		mu.Unlock()
		if out, ok := responses[key]; ok {
			if strings.HasPrefix(out, "ERR:") {
				return "", &TimelineError{Kind: classifyForgeTimelineError(out), Message: out}
			}
			return out, nil
		}
		return "", &TimelineError{Kind: "not_found", Message: "404 not found: " + key}
	}
	t.Cleanup(func() { runForgeTimelineCommand, forgeCLIInstalled = previous, previousInstalled })
	return &calls
}

// GitLab: discussions keep their thread, file, line range and resolution; system notes go.
func TestGitLabTimelineFromDiscussions(t *testing.T) {
	discussions := `[
	  {"id":"d-general","individual_note":true,"notes":[
	    {"id":10,"body":"LGTM","system":false,"created_at":"2026-01-01T00:00:00Z","author":{"username":"alice","web_url":"https://gl/alice","avatar_url":"https://gl/a.png"}}]},
	  {"id":"d-system","individual_note":true,"notes":[
	    {"id":11,"body":"approved this merge request","system":true,"created_at":"2026-01-01T00:00:01Z"}]},
	  {"id":"d-file","individual_note":false,"notes":[
	    {"id":12,"body":"rename this","created_at":"2026-01-02T00:00:00Z","resolvable":true,"resolved":true,"author":{"username":"bob"},
	     "position":{"new_path":"src/a.go","new_line":42,"line_range":{"start":{"new_line":40},"end":{"new_line":42}}}},
	    {"id":13,"body":"done","created_at":"2026-01-02T01:00:00Z","resolvable":true,"resolved":true,"author":{"name":"Carol"},
	     "position":{"old_path":"src/a.go","old_line":7}}]},
	  {"id":"d-thread","notes":[
	    {"id":14,"body":"question","created_at":"2026-01-03T00:00:00Z","resolvable":true,"resolved":false},
	    {"id":15,"body":"answer","created_at":"2026-01-03T01:00:00Z","resolvable":true,"resolved":false}]}
	]`
	calls := stubTimelineCommands(t, "glab", map[string]string{
		"mr view 7 -F json": `{"iid":7,"web_url":"https://gl/g/p/-/merge_requests/7","references":{"full":"g/p!7"}}`,
		"api projects/g%2Fp/merge_requests/7/discussions?per_page=100": discussions,
	})
	items, truncated, err := PullRequestTimeline(context.Background(), "gitlab", t.TempDir(), "", "", 7)
	if err != nil || truncated {
		t.Fatalf("err %v truncated %v (calls %v)", err, truncated, *calls)
	}
	if len(items) != 5 {
		t.Fatalf("items = %d, want 5 (system note dropped): %v", len(items), items)
	}
	general := items[0]
	if general["id"] != "10" || general["author"] != "alice" || general["authorUrl"] != "https://gl/alice" ||
		general["url"] != "https://gl/g/p/-/merge_requests/7#note_10" || general["threadId"] != nil || general["location"] != nil {
		t.Fatalf("general note = %v", general)
	}
	file := items[1]["location"].(map[string]any)
	if items[1]["threadId"] != "d-file" || file["path"] != "src/a.go" || file["line"] != 42 || file["startLine"] != 40 ||
		file["isResolved"] != true || file["threadId"] != "d-file" {
		t.Fatalf("file thread = %v", items[1])
	}
	if items[2]["author"] != "Carol" || items[2]["location"].(map[string]any)["line"] != 7 {
		t.Fatalf("old-side note = %v", items[2])
	}
	if items[3]["threadId"] != "d-thread" || items[3]["threadIsResolved"] != false || items[3]["location"] != nil {
		t.Fatalf("general thread = %v", items[3])
	}
}

// A full page of discussions is truncated only when the next page has one.
func TestGitLabTimelineTruncation(t *testing.T) {
	var page strings.Builder
	page.WriteString("[")
	for i := 0; i < gitLabTimelinePageSize; i++ {
		if i > 0 {
			page.WriteString(",")
		}
		fmt.Fprintf(&page, `{"id":"d%d","individual_note":true,"notes":[{"id":%d,"body":"n"}]}`, i, i)
	}
	page.WriteString("]")
	for _, tc := range []struct {
		next string
		want bool
	}{{"[]", false}, {`[{"id":"more","notes":[]}]`, true}, {"ERR: 500", true}} {
		stubTimelineCommands(t, "glab", map[string]string{
			"mr view 7 -F json": `{"iid":7,"web_url":"u","references":{"full":"g/p!7"}}`,
			"api projects/g%2Fp/merge_requests/7/discussions?per_page=100":        page.String(),
			"api projects/g%2Fp/merge_requests/7/discussions?per_page=1&page=101": tc.next,
		})
		items, truncated, err := PullRequestTimeline(context.Background(), "gitlab", t.TempDir(), "", "", 7)
		if err != nil || len(items) != gitLabTimelinePageSize || truncated != tc.want {
			t.Fatalf("next %q: %d items truncated %v err %v", tc.next, len(items), truncated, err)
		}
	}
}

// Gitea: comments, reviews and each review's inline comments; system events go; inline comments
// thread by diff position.
func TestGiteaTimeline(t *testing.T) {
	calls := stubTimelineCommands(t, "tea", map[string]string{
		"pr 7 -o json": `{"index":7,"url":"https://gt/o/r/pulls/7"}`,
		"api repos/o/r/issues/7/comments?page=1&limit=50": `[
		  {"id":1,"body":"hi","created_at":"2026-01-01T00:00:00Z","user":{"login":"alice","html_url":"https://gt/alice"}},
		  {"id":2,"body":"","type":"label","created_at":"2026-01-01T00:00:01Z"}]`,
		"api repos/o/r/pulls/7/reviews?page=1&limit=50": `[
		  {"id":30,"state":"REQUEST_CHANGES","body":"fix","comments_count":2,"submitted_at":"2026-01-02T00:00:00Z","user":{"full_name":"Bob"}},
		  {"id":31,"state":"APPROVED","body":"","comments_count":0,"updated_at":"2026-01-04T00:00:00Z"}]`,
		"api repos/o/r/pulls/7/reviews/30/comments?page=1&limit=50": `[
		  {"id":40,"body":"line one","path":"a.go","position":12,"pull_request_review_id":30,"resolver":null,"created_at":"2026-01-02T00:00:01Z"},
		  {"id":41,"body":"gone line","path":"a.go","original_position":3,"pull_request_review_id":30,"created_at":"2026-01-02T00:00:02Z"}]`,
	})
	items, truncated, err := PullRequestTimeline(context.Background(), "gitea", t.TempDir(), "o", "r", 7)
	if err != nil || truncated {
		t.Fatalf("err %v truncated %v (calls %v)", err, truncated, *calls)
	}
	if len(items) != 5 {
		t.Fatalf("items = %d, want 5: %v", len(items), items)
	}
	if items[0]["id"] != "1" || items[0]["url"] != "https://gt/o/r/pulls/7#issuecomment-1" || items[0]["authorUrl"] != "https://gt/alice" {
		t.Fatalf("comment = %v", items[0])
	}
	if items[1]["kind"] != "review" || items[1]["reviewState"] != "changes_requested" || items[1]["author"] != "Bob" {
		t.Fatalf("review = %v", items[1])
	}
	inline := items[2]["location"].(map[string]any)
	if items[2]["reviewId"] != "30" || inline["threadId"] != "a.go#pos-12" || inline["line"] != 12 || inline["isResolved"] != false {
		t.Fatalf("inline comment = %v", items[2])
	}
	outdated := items[3]["location"].(map[string]any)
	if outdated["threadId"] != "a.go#pos-3" || outdated["line"] != nil || outdated["isResolved"] != nil {
		t.Fatalf("outdated inline comment = %v", items[3])
	}
	if items[4]["reviewState"] != "approved" {
		t.Fatalf("approval = %v", items[4])
	}
}

// One list failing keeps the other; both failing is the error.
func TestGiteaTimelineFailures(t *testing.T) {
	stubTimelineCommands(t, "tea", map[string]string{
		"pr 7 -o json": `{"url":"u"}`,
		"api repos/o/r/issues/7/comments?page=1&limit=50": `[{"id":1,"body":"hi"}]`,
		"api repos/o/r/pulls/7/reviews?page=1&limit=50":   "ERR: 403 forbidden",
	})
	items, _, err := PullRequestTimeline(context.Background(), "gitea", t.TempDir(), "o", "r", 7)
	if err != nil || len(items) != 1 {
		t.Fatalf("reviews failing: %v %v", items, err)
	}
	stubTimelineCommands(t, "tea", map[string]string{
		"pr 7 -o json": `{"url":"u"}`,
		"api repos/o/r/issues/7/comments?page=1&limit=50": "ERR: 403 forbidden",
		"api repos/o/r/pulls/7/reviews?page=1&limit=50":   "ERR: 403 forbidden",
	})
	_, _, err = PullRequestTimeline(context.Background(), "gitea", t.TempDir(), "o", "r", 7)
	var classified *TimelineError
	if err == nil || !asTimelineError(err, &classified) || classified.Kind != "forbidden" {
		t.Fatalf("both failing: %v", err)
	}
	if _, _, err := PullRequestTimeline(context.Background(), "gitea", t.TempDir(), "o", "@etc/passwd", 7); err == nil {
		t.Fatal("an invalid repository name must not reach tea")
	}
}

func asTimelineError(err error, target **TimelineError) bool {
	classified, ok := err.(*TimelineError)
	if ok {
		*target = classified
	}
	return ok
}

// A forge CLI that is not installed is a forbidden timeline, as Node reported it.
func TestForgeTimelineWithoutCLI(t *testing.T) {
	previous := forgeCLIInstalled
	forgeCLIInstalled = func(string) bool { return false }
	t.Cleanup(func() { forgeCLIInstalled = previous })
	for _, forge := range []string{"gitlab", "gitea"} {
		_, _, err := PullRequestTimeline(context.Background(), forge, t.TempDir(), "o", "r", 7)
		var classified *TimelineError
		if !asTimelineError(err, &classified) || classified.Kind != "forbidden" {
			t.Fatalf("%s without its CLI: %v", forge, err)
		}
	}
}
