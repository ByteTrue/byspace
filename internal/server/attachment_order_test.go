package server

import (
	"strings"
	"testing"
)

// The production type, aliased so the test does not maintain a second copy of the field set — that
// copy is exactly how the forge fields went missing from two of three call sites.
type testAttachment = promptAttachment

// A chat_history attachment is the conversation the user is referring to ("continue that
// thread"); the instruction that follows only makes sense once the history is in context, so it
// must precede the text.
func TestAppendAttachmentHintsOrdersChatHistoryFirst(t *testing.T) {
	history := testAttachment{Type: "text", ContextKind: "chat_history", FileName: "thread.md", Path: "/tmp/thread.md", MimeType: "text/markdown"}
	other := testAttachment{Type: "uploaded_file", FileName: "log.txt", Path: "/tmp/log.txt", MimeType: "text/plain"}

	got := appendAttachmentHints("continue that", []testAttachment{other, history})
	historyAt := strings.Index(got, "thread.md")
	textAt := strings.Index(got, "continue that")
	otherAt := strings.Index(got, "log.txt")
	if historyAt < 0 || textAt < 0 || otherAt < 0 {
		t.Fatalf("missing a part: %q", got)
	}
	if !(historyAt < textAt && textAt < otherAt) {
		t.Fatalf("order should be history → text → other, got %q", got)
	}
}

// With no attachments the text is returned untouched.
func TestAppendAttachmentHintsNoAttachments(t *testing.T) {
	if got := appendAttachmentHints("hello", nil); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

// An attachment with neither a path nor uploaded_file type contributes nothing; an empty bracket
// line would be noise the model has to skip.
func TestAppendAttachmentHintsSkipsUnusable(t *testing.T) {
	got := appendAttachmentHints("hi", []testAttachment{{Type: "other", FileName: "x"}})
	if got != "hi" {
		t.Fatalf("got %q", got)
	}
}

// Text that is only whitespace must not leave a blank paragraph in the middle.
func TestAppendAttachmentHintsEmptyText(t *testing.T) {
	got := appendAttachmentHints("   ", []testAttachment{{Type: "uploaded_file", FileName: "a.txt"}})
	if strings.Contains(got, "\n\n\n") || strings.HasPrefix(got, "\n") {
		t.Fatalf("blank paragraph left behind: %q", got)
	}
	if !strings.Contains(got, "a.txt") {
		t.Fatalf("attachment dropped: %q", got)
	}
}
