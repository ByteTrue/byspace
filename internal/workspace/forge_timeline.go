package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GitLab and Gitea pull request timelines, ported from getPullRequestTimeline in the archived Node
// daemon's gitlab-service.ts and gitea-service.ts.
//
// GitLab reads the merge request's discussions, so a reply chain keeps its thread and a diff note
// keeps its file, line and resolved state. Gitea reads issue comments, reviews, and each review's
// inline comments. Both used to read a flat note or comment list: inline review threads, reply
// chains and resolution never reached the PR panel.

// forgeTimelineResult is one forge's timeline.
type forgeTimelineResult struct {
	items     []map[string]any
	truncated bool
}

// sortTimelineItems is Node's compareTimelineItems: by creation time, then id.
func sortTimelineItems(items []map[string]any) {
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
}

// parseOptionalTime is Node's: an ISO timestamp in epoch milliseconds, 0 when absent or invalid.
func parseOptionalTime(value string) int64 {
	if value == "" {
		return 0
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UnixMilli()
	}
	return 0
}

var forgeAuthFailurePattern = regexp.MustCompile(`(?i)\b(401|unauthorized|not logged in|authentication failed|no token|invalid token|no logins?)\b`)

// classifyForgeTimelineError is Node's classifyGlabTimelineErrorKind / classifyGiteaTimelineErrorKind.
func classifyForgeTimelineError(stderr string) string {
	normalized := strings.ToLower(stderr)
	if strings.Contains(normalized, "404") || strings.Contains(normalized, "not found") {
		return "not_found"
	}
	if strings.Contains(normalized, "403") || strings.Contains(normalized, "forbidden") || forgeAuthFailurePattern.MatchString(stderr) {
		return "forbidden"
	}
	return "unknown"
}

// forgeCLIInstalled reports whether a forge CLI is on PATH; a variable so tests can stand in for it.
var forgeCLIInstalled = func(bin string) bool {
	_, err := exec.LookPath(bin)
	return err == nil
}

// runForgeTimelineCommand runs a forge CLI and classifies a failure as a TimelineError.
var runForgeTimelineCommand = func(ctx context.Context, bin, cwd string, args ...string) (string, error) {
	out, stderr, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, bin, cwd, args...)
	if err == nil {
		return out, nil
	}
	message := strings.TrimSpace(stderr)
	if message == "" {
		message = err.Error()
	}
	return "", &TimelineError{Kind: classifyForgeTimelineError(stderr), Message: message}
}

// ------------------------------------------------------------------------------------- GitLab

const gitLabTimelinePageSize = 100

type gitLabNoteAuthor struct {
	Username  *string `json:"username"`
	Name      *string `json:"name"`
	WebURL    *string `json:"web_url"`
	AvatarURL *string `json:"avatar_url"`
}

type gitLabLineEndpoint struct {
	NewLine *int `json:"new_line"`
	OldLine *int `json:"old_line"`
}

type gitLabNotePosition struct {
	NewPath   *string `json:"new_path"`
	OldPath   *string `json:"old_path"`
	NewLine   *int    `json:"new_line"`
	OldLine   *int    `json:"old_line"`
	LineRange *struct {
		Start *gitLabLineEndpoint `json:"start"`
		End   *gitLabLineEndpoint `json:"end"`
	} `json:"line_range"`
}

type gitLabNote struct {
	ID         int64               `json:"id"`
	Body       *string             `json:"body"`
	System     bool                `json:"system"`
	CreatedAt  *string             `json:"created_at"`
	Resolvable *bool               `json:"resolvable"`
	Resolved   *bool               `json:"resolved"`
	Author     *gitLabNoteAuthor   `json:"author"`
	Position   *gitLabNotePosition `json:"position"`
}

type gitLabDiscussion struct {
	ID             string       `json:"id"`
	IndividualNote *bool        `json:"individual_note"`
	Notes          []gitLabNote `json:"notes"`
}

// gitLabPullRequestTimeline lists a merge request's discussions.
func gitLabPullRequestTimeline(ctx context.Context, cwd string, number int) (forgeTimelineResult, error) {
	if !forgeCLIInstalled("glab") {
		return forgeTimelineResult{}, &TimelineError{Kind: "forbidden", Message: "GitLab CLI (glab) is not installed or not in PATH"}
	}
	raw, err := runForgeTimelineCommand(ctx, "glab", cwd, "mr", "view", strconv.Itoa(number), "-F", "json")
	if err != nil {
		return forgeTimelineResult{}, err
	}
	var mr struct {
		IID        int    `json:"iid"`
		WebURL     string `json:"web_url"`
		References struct {
			Full string `json:"full"`
		} `json:"references"`
	}
	if err := json.Unmarshal([]byte(raw), &mr); err != nil {
		return forgeTimelineResult{}, &TimelineError{Kind: "unknown", Message: err.Error()}
	}
	projectPath := gitLabProjectPath(mr.References.Full)
	if projectPath == "" {
		return forgeTimelineResult{}, &TimelineError{Kind: "not_found", Message: "GitLab merge request project path is unavailable"}
	}
	discussionsPath := fmt.Sprintf("projects/%s/merge_requests/%d/discussions", url.PathEscape(projectPath), mr.IID)
	raw, err = runForgeTimelineCommand(ctx, "glab", cwd, "api", fmt.Sprintf("%s?per_page=%d", discussionsPath, gitLabTimelinePageSize))
	if err != nil {
		return forgeTimelineResult{}, err
	}
	var discussions []gitLabDiscussion
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &discussions); err != nil {
			return forgeTimelineResult{}, &TimelineError{Kind: "unknown", Message: err.Error()}
		}
	}
	items := gitLabTimelineItems(discussions, mr.WebURL)
	truncated := false
	if len(discussions) >= gitLabTimelinePageSize {
		// glab exposes no pagination headers: probe the next page for one discussion. A failed probe
		// reports truncation, since a full first page means there is at least that much.
		probe, probeErr := runForgeTimelineCommand(ctx, "glab", cwd, "api",
			fmt.Sprintf("%s?per_page=1&page=%d", discussionsPath, gitLabTimelinePageSize+1))
		var next []json.RawMessage
		truncated = probeErr != nil || json.Unmarshal([]byte(probe), &next) != nil || len(next) > 0
	}
	return forgeTimelineResult{items: items, truncated: truncated}, nil
}

// gitLabProjectPath is the project half of a reference like "group/project!12".
func gitLabProjectPath(fullReference string) string {
	head, _, _ := strings.Cut(fullReference, "!")
	head, _, _ = strings.Cut(head, "#")
	return head
}

// gitLabTimelineItems maps discussions to timeline comments. GitLab has no review verdict on a
// note, so every human note is a comment; system notes ("approved", "mentioned in commit") go.
func gitLabTimelineItems(discussions []gitLabDiscussion, mrWebURL string) []map[string]any {
	items := []map[string]any{}
	for _, discussion := range discussions {
		isThread := discussion.IndividualNote == nil && len(discussion.Notes) > 1 ||
			discussion.IndividualNote != nil && !*discussion.IndividualNote
		for _, note := range discussion.Notes {
			if note.System {
				continue
			}
			author := "unknown"
			var authorURL, avatarURL any
			if note.Author != nil {
				if note.Author.Username != nil {
					author = *note.Author.Username
				} else if note.Author.Name != nil {
					author = *note.Author.Name
				}
				authorURL = nullableStringPtr(note.Author.WebURL)
				avatarURL = nullableStringPtr(note.Author.AvatarURL)
			}
			body := ""
			if note.Body != nil {
				body = *note.Body
			}
			createdAt := ""
			if note.CreatedAt != nil {
				createdAt = *note.CreatedAt
			}
			item := map[string]any{
				"kind":      "comment",
				"id":        strconv.FormatInt(note.ID, 10),
				"author":    author,
				"authorUrl": authorURL,
				"avatarUrl": avatarURL,
				"body":      body,
				"createdAt": parseOptionalTime(createdAt),
				"url":       fmt.Sprintf("%s#note_%d", mrWebURL, note.ID),
			}
			location := gitLabNoteLocation(note, discussion)
			// The discussion id groups every note of a reply chain into one thread, general
			// (non-file) discussions included.
			if isThread {
				item["threadId"] = discussion.ID
			}
			// A resolvable general thread carries its resolution here; a file thread carries it on
			// its location.
			if location == nil && note.Resolvable != nil && *note.Resolvable {
				item["threadIsResolved"] = note.Resolved != nil && *note.Resolved
			}
			if location != nil {
				item["location"] = location
			}
			items = append(items, item)
		}
	}
	sortTimelineItems(items)
	return items
}

func gitLabNoteLocation(note gitLabNote, discussion gitLabDiscussion) map[string]any {
	position := note.Position
	if position == nil {
		return nil
	}
	path := ""
	if position.NewPath != nil && *position.NewPath != "" {
		path = *position.NewPath
	} else if position.OldPath != nil {
		path = *position.OldPath
	}
	if path == "" {
		return nil
	}
	location := map[string]any{"path": path, "threadId": discussion.ID}
	line := gitLabLine(position.NewLine, position.OldLine)
	if line != nil {
		location["line"] = *line
	}
	if position.LineRange != nil && position.LineRange.Start != nil {
		if start := gitLabLine(position.LineRange.Start.NewLine, position.LineRange.Start.OldLine); start != nil && (line == nil || *start != *line) {
			location["startLine"] = *start
		}
	}
	// Only a resolvable note has a resolution GitLab owns; anything else would render a fake
	// "unresolved" badge.
	if note.Resolvable != nil && *note.Resolvable {
		location["isResolved"] = note.Resolved != nil && *note.Resolved
	}
	return location
}

func gitLabLine(newLine, oldLine *int) *int {
	if newLine != nil {
		return newLine
	}
	return oldLine
}

func nullableStringPtr(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// -------------------------------------------------------------------------------------- Gitea

const (
	giteaTimelinePageSize          = 50
	giteaTimelineMaxPagesPerBucket = 4
	// One `tea api` process per review with comments; bounded so a PR with dozens of reviews does
	// not launch that many at once.
	giteaReviewCommentsConcurrency = 5
)

type giteaUser struct {
	Login    *string `json:"login"`
	FullName *string `json:"full_name"`
	Avatar   *string `json:"avatar_url"`
	HTMLURL  *string `json:"html_url"`
}

func (u *giteaUser) login() string {
	if u != nil && u.Login != nil {
		return *u.Login
	}
	if u != nil && u.FullName != nil {
		return *u.FullName
	}
	return "unknown"
}

func (u *giteaUser) url() any {
	if u == nil {
		return nil
	}
	return nullableStringPtr(u.HTMLURL)
}

func (u *giteaUser) avatar() any {
	if u == nil {
		return nil
	}
	return nullableStringPtr(u.Avatar)
}

type giteaIssueComment struct {
	ID        int64      `json:"id"`
	HTMLURL   *string    `json:"html_url"`
	User      *giteaUser `json:"user"`
	Body      string     `json:"body"`
	CreatedAt string     `json:"created_at"`
	Type      *string    `json:"type"`
}

type giteaReview struct {
	ID            int64      `json:"id"`
	User          *giteaUser `json:"user"`
	State         string     `json:"state"`
	Body          string     `json:"body"`
	CommentsCount int        `json:"comments_count"`
	SubmittedAt   string     `json:"submitted_at"`
	UpdatedAt     string     `json:"updated_at"`
	HTMLURL       string     `json:"html_url"`
}

type giteaReviewComment struct {
	ID                   int64           `json:"id"`
	Body                 string          `json:"body"`
	User                 *giteaUser      `json:"user"`
	PullRequestReviewID  *int64          `json:"pull_request_review_id"`
	CreatedAt            string          `json:"created_at"`
	UpdatedAt            string          `json:"updated_at"`
	Path                 string          `json:"path"`
	Position             *int            `json:"position"`
	OriginalPosition     *int            `json:"original_position"`
	Resolver             json.RawMessage `json:"resolver"`
	HTMLURL              string          `json:"html_url"`
	resolverFieldPresent bool
}

// giteaPullRequestTimeline lists a pull request's comments, reviews and review comments.
func giteaPullRequestTimeline(ctx context.Context, cwd, owner, name string, number int) (forgeTimelineResult, error) {
	if !forgeCLIInstalled("tea") {
		return forgeTimelineResult{}, &TimelineError{Kind: "forbidden", Message: "Gitea CLI (tea) is not installed or not in PATH"}
	}
	raw, err := runForgeTimelineCommand(ctx, "tea", cwd, "pr", strconv.Itoa(number), "-o", "json")
	if err != nil {
		return forgeTimelineResult{}, err
	}
	var pr struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(raw), &pr); err != nil {
		return forgeTimelineResult{}, &TimelineError{Kind: "unknown", Message: err.Error()}
	}
	repoPath := fmt.Sprintf("repos/%s/%s", url.PathEscape(owner), url.PathEscape(name))

	var comments []giteaIssueComment
	var reviews []giteaReview
	var commentsTruncated, reviewsTruncated bool
	var commentsErr, reviewsErr error
	var group sync.WaitGroup
	group.Add(2)
	go func() {
		defer group.Done()
		commentsTruncated, commentsErr = giteaTimelinePages(ctx, cwd, fmt.Sprintf("%s/issues/%d/comments", repoPath, number), &comments)
	}()
	go func() {
		defer group.Done()
		reviewsTruncated, reviewsErr = giteaTimelinePages(ctx, cwd, fmt.Sprintf("%s/pulls/%d/reviews", repoPath, number), &reviews)
	}()
	group.Wait()
	if commentsErr != nil && reviewsErr != nil {
		return forgeTimelineResult{}, commentsErr
	}

	// Each review's inline comments, a bounded number at a time. A review whose comments fail to
	// load keeps its own card; only its inline comments are missing.
	type reviewComments struct {
		comments  []giteaReviewComment
		truncated bool
		err       error
	}
	withComments := []giteaReview{}
	for _, review := range reviews {
		if review.CommentsCount > 0 {
			withComments = append(withComments, review)
		}
	}
	results := make([]reviewComments, len(withComments))
	slots := make(chan struct{}, giteaReviewCommentsConcurrency)
	var fanOut sync.WaitGroup
	for index, review := range withComments {
		fanOut.Add(1)
		go func(index int, reviewID int64) {
			defer fanOut.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			var page []giteaReviewComment
			truncated, err := giteaTimelinePages(ctx, cwd, fmt.Sprintf("%s/pulls/%d/reviews/%d/comments", repoPath, number, reviewID), &page)
			results[index] = reviewComments{comments: page, truncated: truncated, err: err}
		}(index, review.ID)
	}
	fanOut.Wait()

	items := []map[string]any{}
	for _, comment := range comments {
		if comment.Type != nil && *comment.Type != "comment" {
			continue // system event
		}
		commentURL := fmt.Sprintf("%s#issuecomment-%d", pr.URL, comment.ID)
		if comment.HTMLURL != nil {
			commentURL = *comment.HTMLURL
		}
		items = append(items, map[string]any{
			"kind":      "comment",
			"id":        strconv.FormatInt(comment.ID, 10),
			"author":    comment.User.login(),
			"authorUrl": comment.User.url(),
			"avatarUrl": comment.User.avatar(),
			"body":      comment.Body,
			"createdAt": parseOptionalTime(comment.CreatedAt),
			"url":       commentURL,
		})
	}
	for _, review := range reviews {
		submitted := review.SubmittedAt
		if submitted == "" {
			submitted = review.UpdatedAt
		}
		items = append(items, map[string]any{
			"kind":        "review",
			"id":          strconv.FormatInt(review.ID, 10),
			"author":      review.User.login(),
			"authorUrl":   review.User.url(),
			"avatarUrl":   review.User.avatar(),
			"body":        review.Body,
			"createdAt":   parseOptionalTime(submitted),
			"url":         review.HTMLURL,
			"reviewState": giteaReviewState(review.State),
		})
	}
	truncated := commentsTruncated || reviewsTruncated
	for _, result := range results {
		if result.err != nil {
			continue
		}
		truncated = truncated || result.truncated
		for _, comment := range result.comments {
			items = append(items, giteaReviewCommentItem(comment))
		}
	}
	sortTimelineItems(items)
	return forgeTimelineResult{items: items, truncated: truncated}, nil
}

// giteaTimelinePages reads up to four pages of one list, reporting truncation when all four are full.
func giteaTimelinePages[T any](ctx context.Context, cwd, apiPath string, into *[]T) (bool, error) {
	for page := 1; page <= giteaTimelineMaxPagesPerBucket; page++ {
		raw, err := runForgeTimelineCommand(ctx, "tea", cwd, "api",
			fmt.Sprintf("%s?page=%d&limit=%d", apiPath, page, giteaTimelinePageSize))
		if err != nil {
			return false, err
		}
		var pageItems []T
		if strings.TrimSpace(raw) != "" {
			if err := json.Unmarshal([]byte(raw), &pageItems); err != nil {
				return false, &TimelineError{Kind: "unknown", Message: err.Error()}
			}
		}
		*into = append(*into, pageItems...)
		if len(pageItems) < giteaTimelinePageSize {
			return false, nil
		}
	}
	return true, nil
}

func giteaReviewState(state string) string {
	switch strings.ToUpper(strings.TrimSpace(state)) {
	case "APPROVED", "APPROVE":
		return "approved"
	case "REQUEST_CHANGES", "REQUESTED_CHANGES", "CHANGES_REQUESTED":
		return "changes_requested"
	default:
		return "commented"
	}
}

func (c *giteaReviewComment) UnmarshalJSON(data []byte) error {
	type plain giteaReviewComment
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*c = giteaReviewComment(decoded)
	_, c.resolverFieldPresent = fields["resolver"]
	return nil
}

func giteaReviewCommentItem(comment giteaReviewComment) map[string]any {
	created := comment.CreatedAt
	if created == "" {
		created = comment.UpdatedAt
	}
	item := map[string]any{
		"kind":      "comment",
		"id":        strconv.FormatInt(comment.ID, 10),
		"author":    comment.User.login(),
		"authorUrl": comment.User.url(),
		"avatarUrl": comment.User.avatar(),
		"body":      comment.Body,
		"createdAt": parseOptionalTime(created),
		"url":       comment.HTMLURL,
	}
	if comment.PullRequestReviewID != nil {
		item["reviewId"] = strconv.FormatInt(*comment.PullRequestReviewID, 10)
	}
	if comment.Path != "" {
		// Gitea has no review-thread id: one review's inline comments share pull_request_review_id
		// whatever line they are on. The diff position keys a thread instead, which a reply on the
		// same line reuses; without one the comment is its own thread.
		position := comment.Position
		if position == nil {
			position = comment.OriginalPosition
		}
		anchor := fmt.Sprintf("comment-%d", comment.ID)
		if position != nil {
			anchor = fmt.Sprintf("pos-%d", *position)
		}
		location := map[string]any{"path": comment.Path, "threadId": comment.Path + "#" + anchor}
		if comment.Position != nil {
			location["line"] = *comment.Position
		}
		// `resolver` names who resolved the thread, null while open; an older server omits it, and
		// then the state is unknown rather than unresolved.
		if comment.resolverFieldPresent {
			location["isResolved"] = len(comment.Resolver) > 0 && string(comment.Resolver) != "null"
		}
		item["location"] = location
	}
	return item
}
