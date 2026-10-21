package terminal

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

type OutputEvent struct {
	Data     []byte
	Revision int64
}

// Session manages a live PTY process, its output backlog, and active subscribers.
type Session struct {
	ID            string
	Name          string
	Cwd           string
	WorkspaceID   string
	ActivityToken string

	mu               sync.Mutex
	cmd              *exec.Cmd
	ptmx             *os.File
	revision         int64
	activityState    string // "idle" | "working"
	onActivityChange func(string)
	vt               *VTGrid
	backlog          *Backlog
	subscribers      map[int]func(OutputEvent)
	nextSubID        int
	closed           bool
	done             chan struct{}
}

type StartOptions struct {
	ID               string
	Name             string
	Cwd              string
	WorkspaceID      string
	ActivityToken    string
	OnActivityChange func(string)
	Command          string
	Args             []string
	Env              []string
	Rows             uint16
	Cols             uint16
}

func StartSession(opts StartOptions) (*Session, error) {
	shell := opts.Command
	args := opts.Args
	if shell == "" {
		// Same resolution the picker reports, so "Auto" and what actually spawns cannot drift.
		shell = ResolveDefaultShell("")
	}
	rows := opts.Rows
	if rows == 0 {
		rows = 24
	}
	cols := opts.Cols
	if cols == 0 {
		cols = 80
	}

	cmd := exec.Command(shell, args...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	if len(opts.Env) > 0 {
		cmd.Env = append([]string(nil), opts.Env...)
	} else {
		cmd.Env = os.Environ()
	}
	actToken := opts.ActivityToken
	if actToken == "" {
		var b [12]byte
		_, _ = rand.Read(b[:])
		actToken = hex.EncodeToString(b[:])
	}
	if opts.ID != "" {
		cmd.Env = append(cmd.Env, "BYSPACE_TERMINAL_ID="+opts.ID)
	}
	cmd.Env = append(cmd.Env, "BYSPACE_TERMINAL_ACTIVITY_TOKEN="+actToken)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
	if err != nil {
		return nil, err
	}

	s := &Session{
		ID:               opts.ID,
		Name:             opts.Name,
		Cwd:              opts.Cwd,
		WorkspaceID:      opts.WorkspaceID,
		ActivityToken:    actToken,
		cmd:              cmd,
		ptmx:             ptmx,
		activityState:    "idle",
		onActivityChange: opts.OnActivityChange,
		vt:               NewVTGrid(int(rows), int(cols)),
		backlog:          NewBacklog(MaxBacklogChars),
		subscribers:      make(map[int]func(OutputEvent)),
		done:             make(chan struct{}),
	}

	go s.readLoop()
	return s, nil
}

// outputCoalesceWindow bounds how long a burst of PTY reads waits before being sent.
//
// Ported from terminal-output-coalescer.ts. Every read used to produce one websocket frame, so
// a command that prints in many small writes (a build log, `yes`) produced a frame per read —
// the client spent its time on frame overhead instead of rendering. The window is short enough
// that interactive echo still feels immediate.
const outputCoalesceWindow = 5 * time.Millisecond

func (s *Session) readLoop() {
	defer close(s.done)
	buf := make([]byte, 32*1024)

	var pending []byte
	var pendingTimer *time.Timer
	var flushMu sync.Mutex

	flush := func() {
		flushMu.Lock()
		chunk := pending
		pending = nil
		pendingTimer = nil
		flushMu.Unlock()
		if len(chunk) == 0 {
			return
		}
		s.publishOutput(chunk)
	}

	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			// Activity detection runs on arrival, not on flush: the indicator should react to a
			// command boundary without waiting for the coalescing window.
			if bytes.Contains(chunk, []byte("\x1b]633;D")) {
				s.SetActivity("idle")
			} else if bytes.Contains(chunk, []byte("\x1b]633;C")) {
				s.SetActivity("working")
			}
			s.vt.Write(chunk)

			flushMu.Lock()
			leader := pendingTimer == nil
			pending = append(pending, chunk...)
			if leader {
				// Leading edge: nothing pending, so send now and start a window during which
				// further reads accumulate.
				flushMu.Unlock()
				flush()
				flushMu.Lock()
				pendingTimer = time.AfterFunc(outputCoalesceWindow, flush)
			}
			flushMu.Unlock()
		}
		if err != nil {
			flush()
			return
		}
	}
}

// publishOutput records a chunk in the backlog and hands it to subscribers.
func (s *Session) publishOutput(chunk []byte) {
	s.mu.Lock()
	s.revision++
	rev := s.revision
	s.backlog.Append(rev, string(chunk))
	subs := make([]func(OutputEvent), 0, len(s.subscribers))
	for _, fn := range s.subscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	ev := OutputEvent{Data: chunk, Revision: rev}
	for _, fn := range subs {
		fn(ev)
	}
}

func (s *Session) WriteInput(data []byte) error {
	s.mu.Lock()
	ptmx := s.ptmx
	closed := s.closed
	s.mu.Unlock()
	if closed || ptmx == nil {
		return os.ErrClosed
	}
	_, err := ptmx.Write(data)
	return err
}

func (s *Session) Resize(rows, cols uint16) error {
	s.mu.Lock()
	ptmx := s.ptmx
	closed := s.closed
	s.mu.Unlock()
	if closed || ptmx == nil {
		return os.ErrClosed
	}
	s.vt.Resize(int(rows), int(cols))
	return pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *Session) VT() *VTGrid {
	return s.vt
}

func (s *Session) Subscribe(fn func(OutputEvent)) (unsubscribe func(), currentRevision int64) {
	s.mu.Lock()
	id := s.nextSubID
	s.nextSubID++
	s.subscribers[id] = fn
	rev := s.revision
	s.mu.Unlock()

	return func() {
		s.mu.Lock()
		delete(s.subscribers, id)
		s.mu.Unlock()
	}, rev
}

func (s *Session) ResumeSince(revision int64) *Resumption {
	return s.backlog.Since(revision)
}

func (s *Session) Activity() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activityState == "" {
		return "idle"
	}
	return s.activityState
}

func (s *Session) SetActivity(state string) bool {
	if state != "idle" && state != "working" {
		return false
	}
	s.mu.Lock()
	if s.activityState == state {
		s.mu.Unlock()
		return false
	}
	s.activityState = state
	cb := s.onActivityChange
	s.mu.Unlock()
	if cb != nil {
		cb(state)
	}
	return true
}

func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	ptmx := s.ptmx
	cmd := s.cmd
	s.mu.Unlock()

	if ptmx != nil {
		_ = ptmx.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	<-s.done
	return nil
}
