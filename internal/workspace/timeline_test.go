package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

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

// End to end through the real gh invocation path, with a stub `gh` on PATH: the GraphQL query Node
// sent, mapped the way Node's toPullRequestTimeline mapped it. Review threads are the comments on
// code lines; they carry their review id and location so the client nests them under the review.
func TestPullRequestTimelineUsesGitHubGraphQL(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	payload := `{"data":{"repository":{"pullRequest":{"number":7,
	  "reviews":{"nodes":[
	    {"id":"PRR_1","state":"APPROVED","body":"ok","bodyHTML":"","url":"u1","submittedAt":"2026-01-01T00:00:00Z","author":{"login":"alice","url":"https://github.com/alice","avatarUrl":"a.png"}},
	    {"id":"PRR_2","state":"DISMISSED","body":"  ","bodyHTML":"","url":"u2","submittedAt":"2026-01-01T00:00:01Z","author":null}
	  ],"pageInfo":{"hasNextPage":false}},
	  "comments":{"nodes":[
	    {"id":"IC_1","body":"hi","bodyHTML":"","url":"u3","createdAt":"2026-01-02T00:00:00Z","author":{"login":"bob","url":"","avatarUrl":""}}
	  ],"pageInfo":{"hasNextPage":false}},
	  "reviewThreads":{"nodes":[
	    {"id":"PRRT_1","path":"main.go","line":12,"startLine":null,"isResolved":true,"isOutdated":false,
	     "comments":{"nodes":[
	       {"id":"PRRC_1","body":"rename this","bodyHTML":"","url":"u4","createdAt":"2026-01-01T00:00:00Z","author":{"login":"alice","url":"","avatarUrl":""},"pullRequestReview":{"id":"PRR_1"}},
	       {"id":"PRRC_2","body":"done","bodyHTML":"","url":"u5","createdAt":"2026-01-03T00:00:00Z","author":{"login":"carol","url":"","avatarUrl":""},"pullRequestReview":null}
	     ],"pageInfo":{"hasNextPage":true}}}
	  ],"pageInfo":{"hasNextPage":false}}}}}}`
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + argsFile + "\ncat <<'EOF'\n" + payload + "\nEOF\n"
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	items, truncated, err := PullRequestTimeline(t.Context(), "github", dir, "acme", "repo", 7)
	if err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(argsFile)
	for _, want := range []string{"graphql", "owner=acme", "name=repo", "number=7", "reviewThreads(first: 100)"} {
		if !strings.Contains(string(args), want) {
			t.Fatalf("gh args missing %q:\n%s", want, args)
		}
	}
	// A thread comment past the first page makes the timeline incomplete.
	if !truncated {
		t.Fatal("expected truncated: the thread has more comments")
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item["id"].(string))
	}
	// The blank dismissed review is dropped; same-time items order by id.
	if got := strings.Join(ids, ","); got != "PRRC_1,PRR_1,IC_1,PRRC_2" {
		t.Fatalf("order = %s", got)
	}
	threadComment := items[0]
	if threadComment["kind"] != "comment" || threadComment["reviewId"] != "PRR_1" {
		t.Fatalf("thread comment: %+v", threadComment)
	}
	location, _ := threadComment["location"].(map[string]any)
	if location["path"] != "main.go" || location["line"] != 12 || location["threadId"] != "PRRT_1" ||
		location["isResolved"] != true || location["isOutdated"] != false {
		t.Fatalf("location: %+v", location)
	}
	if _, hasStart := location["startLine"]; hasStart {
		t.Fatal("a null startLine is left out")
	}
	if items[1]["reviewState"] != "approved" || items[1]["author"] != "alice" || items[1]["authorUrl"] != "https://github.com/alice" {
		t.Fatalf("review: %+v", items[1])
	}
	if items[2]["authorUrl"] != nil {
		t.Fatalf("an empty author url is null: %+v", items[2])
	}
}

func TestPullRequestTimelineClassifiesFailures(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\necho 'GraphQL: Could not resolve to a PullRequest with the number of 999.' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	_, _, err := PullRequestTimeline(t.Context(), "github", dir, "acme", "repo", 999)
	var classified *TimelineError
	if !errors.As(err, &classified) || classified.Kind != "not_found" {
		t.Fatalf("err = %#v", err)
	}
	_, _, err = PullRequestTimeline(t.Context(), "github", dir, "acme", "@etc/passwd", 1)
	if !errors.As(err, &classified) || !strings.Contains(classified.Message, "invalid PR identity") {
		t.Fatalf("an invalid identity never reaches gh: %#v", err)
	}
}

// An image pasted into a comment links to github.com/user-attachments, which only loads with the
// viewer's GitHub session; the rendered HTML has the same image on GitHub's proxy.
func TestNormalizeGitHubTimelineBodyUsesProxiedImages(t *testing.T) {
	body := "see ![shot](https://github.com/user-attachments/assets/abc) and <img src=\"https://github.com/user-attachments/assets/def\" width=10>"
	html := `<p>see <img src="https://private-user-images.githubusercontent.com/1.png?jwt=a&amp;b"> and <img src="https://camo.githubusercontent.com/2"></p>`
	want := "see ![shot](https://private-user-images.githubusercontent.com/1.png?jwt=a&b) and <img src=\"https://camo.githubusercontent.com/2\" width=10>"
	if got := normalizeGitHubTimelineBody(body, html); got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
	// Images that do not pair up leave the body as written.
	if got := normalizeGitHubTimelineBody(body, `<img src="https://camo.githubusercontent.com/2">`); got != body {
		t.Fatalf("unpaired images changed the body: %q", got)
	}
}
