package terminal

import (
	"bytes"
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
