package terminal

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// Coalescing must not drop or reorder bytes: the client replays them into a terminal.
func TestOutputCoalescingPreservesAllBytes(t *testing.T) {
	sess, err := StartSession(StartOptions{Cwd: t.TempDir(), Rows: 24, Cols: 80})
	if err != nil {
		t.Skip("pty unavailable:", err)
	}
	defer sess.Close()

	var mu sync.Mutex
	var frames int
	var got strings.Builder
	unsub, _ := sess.Subscribe(func(ev OutputEvent) {
		mu.Lock()
		frames++
		got.Write(ev.Data)
		mu.Unlock()
	})
	defer unsub()

	// Emit in many small writes to provoke the coalescing path.
	if err := sess.WriteInput([]byte("for i in $(seq 1 200); do printf 'X'; done; echo DONE\r")); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		done := strings.Contains(got.String(), "DONE") && strings.Count(got.String(), "X") >= 200
		mu.Unlock()
		if done {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if strings.Count(got.String(), "X") < 200 {
		t.Fatalf("bytes lost: only %d X in output", strings.Count(got.String(), "X"))
	}
	if frames == 0 {
		t.Fatal("no frames delivered")
	}
	t.Logf("delivered %d bytes in %d frames", got.Len(), frames)
}
