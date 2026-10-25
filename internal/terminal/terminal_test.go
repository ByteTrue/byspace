package terminal

import (
	"bytes"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestFramesAndBacklog(t *testing.T) {
	raw := EncodeFrame(OpcodeOutput, 3, []byte("hello"))
	dec, err := DecodeFrame(raw)
	if err != nil {
		t.Fatal(err)
	}
	if dec.Opcode != OpcodeOutput || dec.Slot != 3 || !bytes.Equal(dec.Payload, []byte("hello")) {
		t.Fatalf("unexpected decoded frame: %+v", dec)
	}

	bl := NewBacklog(10)
	bl.Append(1, "aaaa")
	bl.Append(2, "bbbb")
	bl.Append(3, "cccc") // total 12 > 10 -> evicts rev 1

	if res := bl.Since(0); res != nil {
		t.Fatalf("expected nil when revision 1 was evicted, got %+v", res)
	}
	res := bl.Since(1)
	if res == nil || res.Data != "bbbbcccc" || res.Revision != 3 {
		t.Fatalf("unexpected resumption since rev 1: %+v", res)
	}
}

func TestPTYSessionEcho(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	sess, err := StartSession(StartOptions{
		ID:      "term_1",
		Name:    "test",
		Command: "/bin/sh",
		Args:    []string{"-c", "read line && echo \"GOT:$line\""},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	outCh := make(chan string, 16)
	unsub, _ := sess.Subscribe(func(ev OutputEvent) {
		outCh <- string(ev.Data)
	})
	defer unsub()

	if err := sess.WriteInput([]byte("byspace-pty\n")); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(3 * time.Second)
	var collected strings.Builder
	for !strings.Contains(collected.String(), "GOT:byspace-pty") {
		select {
		case chunk := <-outCh:
			collected.WriteString(chunk)
		case <-deadline:
			t.Fatalf("timed out waiting for PTY output, got %q", collected.String())
		}
	}
}

func TestVTGridSnapshotModesAndAgentHooks(t *testing.T) {
	vt := NewVTGrid(4, 10)
	vt.Write([]byte("\x1b[?2004h\x1b[?1hHello\r\nWorld"))

	snap, frame := vt.Snapshot(2)
	if !snap.BracketedPaste || !snap.ApplicationKeys {
		t.Fatalf("expected bracketed paste and application keys tracked, got %+v", snap)
	}
	if !strings.Contains(snap.ReplayPreamble, "\x1b[?2004h") || !strings.Contains(snap.ReplayPreamble, "\x1b[?1h") {
		t.Fatalf("unexpected replayPreamble: %q", snap.ReplayPreamble)
	}
	if snap.Grid[0][0].Char != "H" || snap.Grid[1][0].Char != "W" {
		t.Fatalf("unexpected VT grid cells: row0=%+v row1=%+v", snap.Grid[0][:5], snap.Grid[1][:5])
	}
	dec, err := DecodeFrame(frame)
	if err != nil || dec.Opcode != OpcodeSnapshot || dec.Slot != 2 {
		t.Fatalf("unexpected snapshot binary frame: %+v (%v)", dec, err)
	}

	tmpHome := t.TempDir()
	hookPath, err := EnsureAgentHooksInstalled(tmpHome)
	if err != nil || !strings.HasSuffix(hookPath, "byspace-terminal-activity.ts") {
		t.Fatalf("failed to install agent hook: %q (%v)", hookPath, err)
	}
}

func TestStripAnsi(t *testing.T) {
	cases := map[string]string{
		"":                                "",
		"plain text":                      "plain text",
		"\x1b[31mred\x1b[0m":              "red",
		"\x1b]633;A\x07prompt$ ":          "prompt$ ",
		"\x1b[?25lhidden cursor\x1b[?25h": "hidden cursor",
		"a\x1b[1;32mb\x1b[0mc":            "abc",
	}
	for input, want := range cases {
		if got := StripAnsi(input); got != want {
			t.Errorf("StripAnsi(%q) = %q, want %q", input, got, want)
		}
	}
}
