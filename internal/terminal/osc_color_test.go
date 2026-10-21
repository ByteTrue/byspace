package terminal

import (
	"os"
	"testing"
	"time"
)

// pipePair returns a writer (stand-in for the pty master) and its reader.
//
// A pipe rather than a real pty: the pty's line discipline buffers writes until a newline, and an OSC reply has
// none — the test would then be measuring termios rather than the reply.
func pipePair(t *testing.T) (writer, reader *os.File) {
	t.Helper()
	// os.Pipe returns (readEnd, writeEnd).
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = writer.Close()
		_ = reader.Close()
	})
	return writer, reader
}

// A TUI that adapts to the terminal's light/dark mode sends OSC 10/11/12 and reads the reply; with no reply it
// falls back to its own default, which may be a light theme inside this app's dark one.
func TestAnswerOSCColorQueriesWritesReplies(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writer}
	session.answerOSCColorQueries([]byte("\x1b]11;?\x1b\\"))

	_ = reader.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 64)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("no reply: %v", err)
	}
	if got := string(buf[:n]); got != "\x1b]11;rgb:0b0b/0b0b/0b0b\x1b\\" {
		t.Fatalf("reply = %q", got)
	}
}

// All three queries in one chunk are answered.
func TestAnswerOSCColorQueriesAnswersEach(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writer}
	session.answerOSCColorQueries([]byte("\x1b]10;?\x1b]11;?\x1b]12;?"))

	_ = reader.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 256)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("no reply: %v", err)
	}
	got := string(buf[:n])
	for _, want := range []string{"\x1b]10;rgb:", "\x1b]11;rgb:", "\x1b]12;rgb:"} {
		if !contains(got, want) {
			t.Fatalf("reply %q lacks %q", got, want)
		}
	}
}

// A chunk without a query writes nothing: replying to every read would fill the program's input with garbage.
func TestAnswerOSCColorQueriesIgnoresOtherOutput(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writer}
	session.answerOSCColorQueries([]byte("ordinary output\r\n"))

	_ = reader.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, err := reader.Read(make([]byte, 8)); err == nil {
		t.Fatal("something was written for ordinary output")
	}
}

// contains reports whether haystack has needle.
func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
