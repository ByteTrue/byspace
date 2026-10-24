package jsonl

import (
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Protocol tracing.
//
// Set BYSPACE_PI_TRACE=<path> to append every frame in both directions to that file. This
// exists because the interesting failures are timing failures: a provider that ignores the
// first command, or answers a later one out of order, looks identical to "no traffic at all"
// from the outside. stderr is not usable for this — the daemon's own logs interleave with the
// provider's, and a trace that gets truncated by a crash is worse than none.
//
// Off unless the variable is set: a normal run must not pay for the file writes.
type traceWriter struct {
	mu   sync.Mutex
	file *os.File
}

var trace = &traceWriter{}

func (t *traceWriter) ensure() *os.File {
	if t.file != nil {
		return t.file
	}
	path := os.Getenv("BYSPACE_PI_TRACE")
	if path == "" {
		return nil
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil
	}
	t.file = f
	return f
}

// record appends one line with a direction marker and a millisecond timestamp.
func (t *traceWriter) record(direction string, payload []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	f := t.ensure()
	if f == nil {
		return
	}
	line := make([]byte, 0, len(payload)+32)
	line = append(line, []byte(time.Now().UTC().Format("15:04:05.000"))...)
	line = append(line, ' ')
	line = append(line, []byte(direction)...)
	line = append(line, ' ')
	line = append(line, payload...)
	line = append(line, '\n')
	_, _ = f.Write(line)
}
