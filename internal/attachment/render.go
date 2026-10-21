// Package attachment renders composer attachments as text for the model.
//
// Ported from prompt-attachments.ts. A change-request or review attachment is the user pointing at
// something and saying "this one". Without the render, the model receives nothing: the client sent the
// PR's title, number and body and the daemon dropped them, so the reply was about nothing in
// particular. Go handled only `uploaded_file`.
package attachment

import (
	"fmt"
	"strings"
)

// ForgeLabels are the per-forge display strings a rendered attachment uses.
//
// From protocol/forge-manifest.ts. The numbers and abbreviations differ per forge — GitLab calls a
// change request an MR and numbers it with `!` — so a single hardcoded "PR #" is wrong for two of the
// four.
type ForgeLabels struct {
	DisplayName               string
	ChangeRequestAbbrev       string
	ChangeRequestNumberPrefix string
	IssueNumberPrefix         string
}

// forgeLabels holds the built-in forges.
var forgeLabels = map[string]ForgeLabels{
	"github":   {DisplayName: "GitHub", ChangeRequestAbbrev: "PR", ChangeRequestNumberPrefix: "#", IssueNumberPrefix: "#"},
	"gitlab":   {DisplayName: "GitLab", ChangeRequestAbbrev: "MR", ChangeRequestNumberPrefix: "!", IssueNumberPrefix: "#"},
	"gitea":    {DisplayName: "Gitea", ChangeRequestAbbrev: "PR", ChangeRequestNumberPrefix: "#", IssueNumberPrefix: "#"},
	"forgejo":  {DisplayName: "Forgejo", ChangeRequestAbbrev: "PR", ChangeRequestNumberPrefix: "#", IssueNumberPrefix: "#"},
	"codeberg": {DisplayName: "Codeberg", ChangeRequestAbbrev: "PR", ChangeRequestNumberPrefix: "#", IssueNumberPrefix: "#"},
}

// labelsFor resolves a forge, falling back to a neutral entry.
//
// Neutral rather than an error: a self-hosted forge the daemon does not know still has a change
// request the user wants to talk about, and refusing to render it helps nobody.
func labelsFor(forge string) ForgeLabels {
	if labels, ok := forgeLabels[strings.ToLower(strings.TrimSpace(forge))]; ok {
		return labels
	}
	name := strings.TrimSpace(forge)
	if name == "" {
		name = "Forge"
	}
	return ForgeLabels{DisplayName: name, ChangeRequestAbbrev: "PR", ChangeRequestNumberPrefix: "#", IssueNumberPrefix: "#"}
}

// ChangeRequest renders a change-request attachment.
func ChangeRequest(forge string, number int, title, url, body, projectPath, baseRef, headRef string) string {
	labels := labelsFor(forge)
	lines := []string{
		fmt.Sprintf("%s %s %s%d: %s", labels.DisplayName, labels.ChangeRequestAbbrev,
			labels.ChangeRequestNumberPrefix, number, title),
		url,
	}
	if projectPath != "" {
		lines = append(lines, "Project: "+projectPath)
	}
	if baseRef != "" {
		lines = append(lines, "Base: "+baseRef)
	}
	if headRef != "" {
		lines = append(lines, "Head: "+headRef)
	}
	if body != "" {
		lines = append(lines, "", body)
	}
	return strings.Join(lines, "\n")
}

// Issue renders an issue attachment.
//
// "Issue" is spelled out for every forge: GitLab numbers issues with `#` like everyone else, so there
// is no per-forge abbreviation to apply.
func Issue(forge string, number int, title, url, body, projectPath string) string {
	labels := labelsFor(forge)
	lines := []string{
		fmt.Sprintf("%s Issue %s%d: %s", labels.DisplayName, labels.IssueNumberPrefix, number, title),
		url,
	}
	if projectPath != "" {
		lines = append(lines, "Project: "+projectPath)
	}
	if body != "" {
		lines = append(lines, "", body)
	}
	return strings.Join(lines, "\n")
}

// ReviewComment is one review comment with its surrounding diff.
type ReviewComment struct {
	FilePath   string
	Side       string
	LineNumber int
	Body       string
	HunkHeader string
	// Target is the line the comment is attached to, used to mark it with `>`.
	Target ReviewLine
	Lines  []ReviewLine
}

// Text renders a text attachment.
//
// When the client sent the body inline, that body is the content. When it sent a path instead (the
// daemon materialised a large body to disk), the path is what the model needs — reading the file is
// the model's job, and an empty string would make the attachment vanish.
func Text(text, path, name, mimeType string) string {
	if strings.TrimSpace(text) != "" {
		return text
	}
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return fmt.Sprintf("[Attached file: %s (%s) at %s]", name, mimeType, path)
}

// ReviewLine is one line of diff context.
type ReviewLine struct {
	OldLineNumber *int
	NewLineNumber *int
	Type          string
	Content       string
}

// lineMarkers map a diff line type to its marker.
var lineMarkers = map[string]string{"add": "+", "remove": "-", "context": " "}

// Review renders a review attachment.
//
// The `>` marker on the target line is what makes the comment readable: a paragraph of "fix this"
// attached to twenty lines of diff is ambiguous until one line is pointed at.
func Review(mode, cwd, baseRef string, comments []ReviewComment) string {
	lines := []string{
		fmt.Sprintf("BySpace review attachment (%s)", mode),
		"CWD: " + cwd,
	}
	if baseRef != "" {
		lines = append(lines, "Base: "+baseRef)
	}
	for index, comment := range comments {
		lines = append(lines, "",
			fmt.Sprintf("Comment %d: %s:%s:%d", index+1, comment.FilePath, comment.Side, comment.LineNumber),
			comment.Body,
			comment.HunkHeader,
		)
		for _, line := range comment.Lines {
			prefix := "  "
			if sameLine(line, comment.Target) {
				prefix = "> "
			}
			lines = append(lines, prefix+
				padLineNumber(line.OldLineNumber)+" "+
				padLineNumber(line.NewLineNumber)+" "+
				lineMarkers[line.Type]+line.Content)
		}
	}
	return strings.Join(lines, "\n")
}

// UploadedFile renders an uploaded-file attachment.
func UploadedFile(fileName, path, mimeType string, size int) string {
	return strings.Join([]string{
		"Uploaded file: " + fileName,
		"Path: " + path,
		"MIME: " + mimeType,
		fmt.Sprintf("Size: %d bytes", size),
	}, "\n")
}

// sameLine reports whether two diff lines are the same line.
func sameLine(left, right ReviewLine) bool {
	return sameInt(left.OldLineNumber, right.OldLineNumber) &&
		sameInt(left.NewLineNumber, right.NewLineNumber) &&
		left.Type == right.Type &&
		left.Content == right.Content
}

// sameInt compares two optional line numbers.
func sameInt(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// padLineNumber renders a line number for the gutter, `-` when absent.
func padLineNumber(value *int) string {
	text := "-"
	if value != nil {
		text = fmt.Sprintf("%d", *value)
	}
	if len(text) < 2 {
		text = " " + text
	}
	return text
}
