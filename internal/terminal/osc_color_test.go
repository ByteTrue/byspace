package terminal

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// writerOnly adapts an *os.File to the pseudo-terminal interface these tests need.
//
// The session writes OSC replies back to the terminal; only Write is exercised here, so the other
// pty.Pty methods never run. Keeping the adapter in the test rather than widening the production
// interface means the real code still goes through the same type on Unix and Windows.
type writerOnly struct{ *os.File }

func (writerOnly) Resize(int, int) error { return nil }
func (writerOnly) Name() string          { return "pipe" }
func (writerOnly) Command(string, ...string) *pty.Cmd {
	return nil
}
func (writerOnly) CommandContext(context.Context, string, ...string) *pty.Cmd { return nil }
func (writerOnly) Fd() uintptr                                                { return 0 }

// pipePair returns a writer (stand-in for the pty master) and its reader.
//
// A pipe rather than a real pty: the pty's line discipline buffers writes until a newline, and an OSC
// reply has none — the test would then be measuring termios rather than the reply.
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

// readWithin reads once and gives up after timeout, reporting whether anything arrived.
//
// A goroutine and a timer rather than SetReadDeadline: read deadlines on an os.Pipe are not honoured on
// Windows, where the read blocks forever and the test hangs instead of failing.
func readWithin(t *testing.T, reader *os.File, size int, timeout time.Duration) (string, bool) {
	t.Helper()
	type result struct {
		text string
		err  error
	}
	done := make(chan result, 1)
	go func() {
		buf := make([]byte, size)
		n, err := reader.Read(buf)
		done <- result{text: string(buf[:n]), err: err}
	}()
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("read: %v", got.err)
		}
		return got.text, true
	case <-time.After(timeout):
		return "", false
	}
}

// A TUI that adapts to the terminal's light/dark mode sends OSC 10/11/12 and reads the reply; with no reply it
// falls back to its own default, which may be a light theme inside this app's dark one.
func TestAnswerOSCColorQueriesWritesReplies(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writerOnly{writer}}
	session.answerOSCColorQueries([]byte("\x1b]11;?\x1b\\"))

	got, ok := readWithin(t, reader, 64, 2*time.Second)
	if !ok {
		t.Fatal("no reply")
	}
	if got != "\x1b]11;rgb:0b0b/0b0b/0b0b\x1b\\" {
		t.Fatalf("reply = %q", got)
	}
}

// All three queries in one chunk are answered.
func TestAnswerOSCColorQueriesAnswersEach(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writerOnly{writer}}
	session.answerOSCColorQueries([]byte("\x1b]10;?\x1b]11;?\x1b]12;?"))

	got, ok := readWithin(t, reader, 256, 2*time.Second)
	if !ok {
		t.Fatal("no reply")
	}
	for _, want := range []string{"\x1b]10;rgb:", "\x1b]11;rgb:", "\x1b]12;rgb:"} {
		if !contains(got, want) {
			t.Fatalf("reply %q lacks %q", got, want)
		}
	}
}

// A chunk without a query writes nothing: replying to every read would fill the program's input with garbage.
func TestAnswerOSCColorQueriesIgnoresOtherOutput(t *testing.T) {
	writer, reader := pipePair(t)
	session := &Session{ptmx: writerOnly{writer}}
	session.answerOSCColorQueries([]byte("ordinary output\r\n"))

	if got, wrote := readWithin(t, reader, 8, 200*time.Millisecond); wrote {
		t.Fatalf("something was written for ordinary output: %q", got)
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
