package workspace

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The GitHub pull request timeline, ported from Node's getPullRequestTimeline (github-service.ts):
// one GraphQL query for the first 100 reviews, issue comments and review threads, mapped the way
// toPullRequestTimeline did. Review threads are the comments on code lines; each comment carries
// its review id and the thread's location, so the client can nest threads under their review.

// gitHubTimelineQuery is Node's PULL_REQUEST_TIMELINE_QUERY.
const gitHubTimelineQuery = `
query PullRequestTimeline($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      reviews(first: 100) {
        nodes {
          id
          state
          body
          bodyHTML
          url
          submittedAt
          author {
            login
            url
            avatarUrl
          }
        }
        pageInfo {
          hasNextPage
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          bodyHTML
          url
          createdAt
          author {
            login
            url
            avatarUrl
          }
        }
        pageInfo {
          hasNextPage
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id
          path
          line
          startLine
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              id
              body
              bodyHTML
              url
              createdAt
              author {
                login
                url
                avatarUrl
              }
              pullRequestReview {
                id
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
}`

// TimelineError is a timeline failure classified as Node classified it (not_found, forbidden or
// unknown). The response carries it as {kind, message}.
type TimelineError struct {
	Kind    string
	Message string
}

func (e *TimelineError) Error() string { return e.Message }

type gitHubTimelineAuthor struct {
	Login     string `json:"login"`
	URL       string `json:"url"`
	AvatarURL string `json:"avatarUrl"`
}

type gitHubTimelinePageInfo struct {
	HasNextPage bool `json:"hasNextPage"`
}

type gitHubTimelineComment struct {
	ID                string                `json:"id"`
	Body              string                `json:"body"`
	BodyHTML          string                `json:"bodyHTML"`
	URL               string                `json:"url"`
	CreatedAt         string                `json:"createdAt"`
	Author            *gitHubTimelineAuthor `json:"author"`
	PullRequestReview *struct {
		ID string `json:"id"`
	} `json:"pullRequestReview"`
}

type gitHubTimelineReview struct {
	ID          string                `json:"id"`
	State       string                `json:"state"`
	Body        string                `json:"body"`
	BodyHTML    string                `json:"bodyHTML"`
	URL         string                `json:"url"`
	SubmittedAt string                `json:"submittedAt"`
	Author      *gitHubTimelineAuthor `json:"author"`
}

type gitHubTimelineThread struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	Line       *int   `json:"line"`
	StartLine  *int   `json:"startLine"`
	IsResolved bool   `json:"isResolved"`
	IsOutdated bool   `json:"isOutdated"`
	Comments   struct {
		Nodes    []gitHubTimelineComment `json:"nodes"`
		PageInfo gitHubTimelinePageInfo  `json:"pageInfo"`
	} `json:"comments"`
}

type gitHubTimelineResponse struct {
	Data struct {
		Repository *struct {
			PullRequest *struct {
				Reviews struct {
					Nodes    []gitHubTimelineReview `json:"nodes"`
					PageInfo gitHubTimelinePageInfo `json:"pageInfo"`
				} `json:"reviews"`
				Comments struct {
					Nodes    []gitHubTimelineComment `json:"nodes"`
					PageInfo gitHubTimelinePageInfo  `json:"pageInfo"`
				} `json:"comments"`
				ReviewThreads struct {
					Nodes    []gitHubTimelineThread `json:"nodes"`
					PageInfo gitHubTimelinePageInfo `json:"pageInfo"`
				} `json:"reviewThreads"`
			} `json:"pullRequest"`
		} `json:"repository"`
	} `json:"data"`
}

// Node rejected an identity outside these characters; it also keeps gh's -F from reading a file
// for a value that starts with "@".
var gitHubRepoSegmentRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func gitHubPullRequestTimeline(ctx context.Context, cwd, owner, name string, number int) ([]map[string]any, bool, error) {
	if !gitHubRepoSegmentRe.MatchString(owner) || !gitHubRepoSegmentRe.MatchString(name) {
		return nil, false, &TimelineError{Kind: "unknown", Message: "Pull request timeline request has invalid PR identity"}
	}
	out, stderr, err := runForgeCLIWithStderr(ctx, 30*time.Second, "gh", cwd,
		"api", "graphql", "-f", "query="+gitHubTimelineQuery,
		"-F", "owner="+owner, "-F", "name="+name, "-F", "number="+strconv.Itoa(number))
	if err != nil {
		message := strings.TrimSpace(stderr)
		if message == "" {
			message = err.Error()
		}
		return nil, false, &TimelineError{Kind: classifyTimelineError(stderr), Message: message}
	}
	var parsed gitHubTimelineResponse
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &parsed); err != nil {
			return nil, false, &TimelineError{Kind: "unknown", Message: err.Error()}
		}
	}
	return gitHubTimelineItems(parsed)
}

// gitHubTimelineItems is Node's toPullRequestTimeline.
func gitHubTimelineItems(parsed gitHubTimelineResponse) ([]map[string]any, bool, error) {
	if parsed.Data.Repository == nil || parsed.Data.Repository.PullRequest == nil {
		return []map[string]any{}, false, &TimelineError{Kind: "not_found", Message: "Pull request not found"}
	}
	pr := parsed.Data.Repository.PullRequest

	threadItems := []map[string]any{}
	threadCommentIDs := map[string]bool{}
	truncated := pr.Reviews.PageInfo.HasNextPage || pr.Comments.PageInfo.HasNextPage ||
		pr.ReviewThreads.PageInfo.HasNextPage
	for _, thread := range pr.ReviewThreads.Nodes {
		truncated = truncated || thread.Comments.PageInfo.HasNextPage
		for _, comment := range thread.Comments.Nodes {
			item := gitHubTimelineCommentItem(comment)
			if comment.PullRequestReview != nil && comment.PullRequestReview.ID != "" {
				item["reviewId"] = comment.PullRequestReview.ID
			}
			location := map[string]any{
				"path":       thread.Path,
				"isResolved": thread.IsResolved,
				"isOutdated": thread.IsOutdated,
			}
			if thread.Line != nil {
				location["line"] = *thread.Line
			}
			if thread.StartLine != nil {
				location["startLine"] = *thread.StartLine
			}
			if thread.ID != "" {
				location["threadId"] = thread.ID
			}
			item["location"] = location
			threadItems = append(threadItems, item)
			if comment.ID != "" {
				threadCommentIDs[comment.ID] = true
			}
		}
	}

	items := []map[string]any{}
	for _, review := range pr.Reviews.Nodes {
		state, ok := gitHubTimelineReviewState(review.State, review.Body)
		if !ok {
			continue
		}
		item := gitHubTimelineEntry("review", review.ID, review.Author, review.Body, review.BodyHTML, review.SubmittedAt, review.URL)
		item["reviewState"] = state
		items = append(items, item)
	}
	for _, comment := range pr.Comments.Nodes {
		if threadCommentIDs[comment.ID] {
			continue
		}
		items = append(items, gitHubTimelineCommentItem(comment))
	}
	items = append(items, threadItems...)
	// Node's compareTimelineItems: by creation time, then id.
	sort.SliceStable(items, func(i, j int) bool {
		ai, _ := items[i]["createdAt"].(int64)
		aj, _ := items[j]["createdAt"].(int64)
		if ai != aj {
			return ai < aj
		}
		idI, _ := items[i]["id"].(string)
		idJ, _ := items[j]["id"].(string)
		return idI < idJ
	})
	return items, truncated, nil
}

func gitHubTimelineCommentItem(comment gitHubTimelineComment) map[string]any {
	return gitHubTimelineEntry("comment", comment.ID, comment.Author, comment.Body, comment.BodyHTML, comment.CreatedAt, comment.URL)
}

func gitHubTimelineEntry(kind, id string, author *gitHubTimelineAuthor, body, bodyHTML, createdAt, itemURL string) map[string]any {
	item := map[string]any{
		"kind":      kind,
		"id":        id,
		"author":    "unknown",
		"authorUrl": nil,
		"avatarUrl": nil,
		"body":      normalizeGitHubTimelineBody(body, bodyHTML),
		"createdAt": parseUnixOrISO(createdAt),
		"url":       itemURL,
	}
	if author != nil {
		if author.Login != "" {
			item["author"] = author.Login
		}
		item["authorUrl"] = nullableString(author.URL)
		item["avatarUrl"] = nullableString(author.AvatarURL)
	}
	return item
}

// gitHubTimelineReviewState is Node's mapTimelineReviewState: a dismissed, pending or unknown review
// shows only when it says something.
func gitHubTimelineReviewState(state, body string) (string, bool) {
	switch state {
	case "APPROVED":
		return "approved", true
	case "CHANGES_REQUESTED":
		return "changes_requested", true
	case "COMMENTED":
		return "commented", true
	}
	if strings.TrimSpace(body) != "" {
		return "commented", true
	}
	return "", false
}

// classifyTimelineError is Node's classifyPullRequestTimelineError.
func classifyTimelineError(stderr string) string {
	normalized := strings.ToLower(stderr)
	for _, marker := range []string{"could not resolve to a pullrequest", "pull request not found", "pullrequest not found"} {
		if strings.Contains(normalized, marker) {
			return "not_found"
		}
	}
	for _, marker := range []string{"forbidden", "resource not accessible", "permission", "access denied", "requires authentication", "http 403"} {
		if strings.Contains(normalized, marker) {
			return "forbidden"
		}
	}
	return "unknown"
}

var (
	rawMarkdownImageRe = regexp.MustCompile(`!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+["'][^)]*["'])?\s*\)`)
	// Node matched the quote with a backreference, which RE2 has no form for; one branch per quote.
	htmlImageRe = regexp.MustCompile(`(?i)<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>`)
)

type imageSourceRef struct {
	src        string
	start, end int
}

// normalizeGitHubTimelineBody is Node's: an image pasted into a comment links to
// github.com/user-attachments, which needs the viewer's GitHub session; the rendered HTML has the
// same images on GitHub's image proxy. When every image pairs up, the body uses the proxied
// sources; otherwise it stays as written.
func normalizeGitHubTimelineBody(body, bodyHTML string) string {
	raw := append(htmlImageRefs(body), markdownImageRefs(body)...)
	if len(raw) == 0 {
		return body
	}
	sort.SliceStable(raw, func(i, j int) bool { return raw[i].start < raw[j].start })
	rendered := htmlImageRefs(bodyHTML)
	if len(rendered) != len(raw) {
		return body
	}
	var normalized strings.Builder
	cursor := 0
	for i, image := range raw {
		if !isRawGitHubAttachment(image.src) || !isGitHubRenderedImage(rendered[i].src) {
			return body
		}
		normalized.WriteString(body[cursor:image.start])
		normalized.WriteString(rendered[i].src)
		cursor = image.end
	}
	normalized.WriteString(body[cursor:])
	return normalized.String()
}

func htmlImageRefs(source string) []imageSourceRef {
	var refs []imageSourceRef
	for _, m := range htmlImageRe.FindAllStringSubmatchIndex(source, -1) {
		start, end := m[2], m[3]
		if start < 0 {
			start, end = m[4], m[5]
		}
		src := decodeHTMLAttribute(source[start:end])
		if src == "" {
			continue
		}
		refs = append(refs, imageSourceRef{src: src, start: start, end: end})
	}
	return refs
}

func markdownImageRefs(source string) []imageSourceRef {
	var refs []imageSourceRef
	for _, m := range rawMarkdownImageRe.FindAllStringSubmatchIndex(source, -1) {
		if m[3] > m[2] {
			refs = append(refs, imageSourceRef{src: source[m[2]:m[3]], start: m[2], end: m[3]})
		}
	}
	return refs
}

func isRawGitHubAttachment(src string) bool {
	u, err := url.Parse(src)
	return err == nil && u.Scheme == "https" && u.Hostname() == "github.com" &&
		strings.HasPrefix(u.Path, "/user-attachments/assets/")
}

func isGitHubRenderedImage(src string) bool {
	u, err := url.Parse(src)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	return host == "camo.githubusercontent.com" || host == "private-user-images.githubusercontent.com"
}

// decodeHTMLAttribute decodes in Node's order, &amp; first.
func decodeHTMLAttribute(value string) string {
	for _, pair := range [][2]string{{"&amp;", "&"}, {"&quot;", `"`}, {"&#39;", "'"}, {"&lt;", "<"}, {"&gt;", ">"}} {
		value = strings.ReplaceAll(value, pair[0], pair[1])
	}
	return value
}
