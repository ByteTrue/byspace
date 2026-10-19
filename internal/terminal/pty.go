package terminal

import (
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

type OutputEvent struct {
	Data     []byte
	Revision int64
}

// Session manages a live PTY process, its output backlog, and active subscribers.
type Session struct {
	ID          string
	Name        string
	Cwd         string
	WorkspaceID string

	mu          sync.Mutex
	cmd         *exec.Cmd
	ptmx        *os.File
	revision    int64
	backlog     *Backlog
	subscribers map[int]func(OutputEvent)
	nextSubID   int
	closed      bool
	done        chan struct{}
}

type StartOptions struct {
	ID          string
	Name        string
	Cwd         string
	WorkspaceID string
	Command     string
	Args        []string
	Env         []string
	Rows        uint16
	Cols        uint16
}

func StartSession(opts StartOptions) (*Session, error) {
	shell := opts.Command
	args := opts.Args
	if shell == "" {
		shell = os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/sh"
		}
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
		cmd.Env = opts.Env
	} else {
		cmd.Env = os.Environ()
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
	if err != nil {
		return nil, err
	}

	s := &Session{
		ID:          opts.ID,
		Name:        opts.Name,
		Cwd:         opts.Cwd,
		WorkspaceID: opts.WorkspaceID,
		cmd:         cmd,
		ptmx:        ptmx,
		backlog:     NewBacklog(MaxBacklogChars),
		subscribers: make(map[int]func(OutputEvent)),
		done:        make(chan struct{}),
	}

	go s.readLoop()
	return s, nil
}

func (s *Session) readLoop() {
	defer close(s.done)
	buf := make([]byte, 32*1024)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
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
		if err != nil {
			return
		}
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
	return pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})
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
