package attachment

import (
	"strings"
	"testing"
)

func intPtr(v int) *int { return &v }

// GitLab calls a change request an MR and numbers it with `!`; a hardcoded "PR #" is wrong for it.
func TestChangeRequestUsesForgeLabels(t *testing.T) {
	github := ChangeRequest("github", 42, "Fix login", "https://github.com/o/r/pull/42", "", "", "", "")
	if !strings.Contains(github, "GitHub PR #42: Fix login") {
		t.Fatalf("github = %q", github)
	}

	gitlab := ChangeRequest("gitlab", 7, "Fix login", "https://gitlab.com/o/r/-/merge_requests/7", "", "", "", "")
	if !strings.Contains(gitlab, "GitLab MR !7: Fix login") {
		t.Fatalf("gitlab = %q", gitlab)
	}

	// The optional fields appear only when set, and the body goes last separated by a blank line.
	full := ChangeRequest("github", 1, "T", "u", "body", "packages/app", "main", "feat/x")
	for _, want := range []string{"Project: packages/app", "Base: main", "Head: feat/x", "\n\nbody"} {
		if !strings.Contains(full, want) {
			t.Fatalf("missing %q in:\n%s", want, full)
		}
	}
	if strings.Contains(github, "Project:") {
		t.Fatal("project path appears when not set")
	}
}

// A self-hosted forge the daemon does not know still has a change request the user wants to talk
// about; refusing to render it helps nobody.
func TestUnknownForgeFallsBackToNeutral(t *testing.T) {
	got := ChangeRequest("my-forge", 3, "T", "u", "", "", "", "")
	if !strings.Contains(got, "my-forge PR #3: T") {
		t.Fatalf("got %q", got)
	}
	// An empty forge still produces a readable line.
	if got := ChangeRequest("", 1, "T", "u", "", "", "", ""); !strings.Contains(got, "Forge PR #1: T") {
		t.Fatalf("got %q", got)
	}
}

// Issues are numbered with `#` on every forge, so "Issue" is spelled out with no abbreviation.
func TestIssueUsesHashOnEveryForge(t *testing.T) {
	for _, forge := range []string{"github", "gitlab", "gitea"} {
		got := Issue(forge, 9, "Crash on start", "u", "", "")
		if !strings.Contains(got, "Issue #9: Crash on start") {
			t.Fatalf("%s: %q", forge, got)
		}
		if strings.Contains(got, "Issue !") {
			t.Fatalf("%s used the MR prefix for an issue: %q", forge, got)
		}
	}
}

// The `>` marker on the target line is what makes a comment readable: a paragraph of "fix this"
// attached to twenty lines of diff is ambiguous until one line is pointed at.
func TestReviewMarksTheTargetLine(t *testing.T) {
	got := Review("uncommitted", "/repo", "main", []ReviewComment{{
		FilePath: "a.go", Side: "new", LineNumber: 12, Body: "rename this",
		HunkHeader: "@@ -10,3 +10,4 @@",
		Target:     ReviewLine{OldLineNumber: intPtr(10), NewLineNumber: intPtr(11), Type: "add", Content: "x := 1"},
		Lines: []ReviewLine{
			{OldLineNumber: intPtr(10), NewLineNumber: intPtr(10), Type: "context", Content: "func f() {"},
			{OldLineNumber: intPtr(10), NewLineNumber: intPtr(11), Type: "add", Content: "x := 1"},
		},
	}})

	for _, want := range []string{
		"BySpace review attachment (uncommitted)",
		"CWD: /repo",
		"Base: main",
		"Comment 1: a.go:new:12",
		"rename this",
		"@@ -10,3 +10,4 @@",
		" 10 10  func f() {",
		"> 10 11 +x := 1",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
}

// A missing line number renders as `-`, padded so the gutter stays aligned.
func TestReviewPadsMissingLineNumbers(t *testing.T) {
	got := Review("staged", "/repo", "", []ReviewComment{{
		FilePath: "a.go", Side: "new", LineNumber: 1, Body: "b", HunkHeader: "@@",
		Lines: []ReviewLine{{OldLineNumber: nil, NewLineNumber: intPtr(5), Type: "context", Content: "y"}},
	}})
	if !strings.Contains(got, " -  5  y") {
		t.Fatalf("got %q", got)
	}
}

func TestUploadedFile(t *testing.T) {
	got := UploadedFile("report.pdf", "/tmp/report.pdf", "application/pdf", 1234)
	for _, want := range []string{"Uploaded file: report.pdf", "Path: /tmp/report.pdf", "MIME: application/pdf", "Size: 1234 bytes"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}
