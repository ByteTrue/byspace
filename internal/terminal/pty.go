package terminal

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"

	"github.com/ByteTrue/byspace/internal/home"
)

type OutputEvent struct {
	Data     []byte
	Revision int64
}

// Session manages a live PTY process, its output backlog, and active subscribers.
type Session struct {
	ID   string
	Name string
	// Title is the user's rename. It is separate from Name because Name is what the rename
	// replaces and Title is what the client shows in the tab label.
	Title         string
	Cwd           string
	WorkspaceID   string
	ActivityToken string

	mu  sync.Mutex
	cmd *pty.Cmd
	// ptmx is the master side of the pseudo-terminal. On Unix it is the pty master; on Windows it
	// is the ConPTY pseudo console. Read, Write, Resize and Close all go through the library so one
	// code path serves both — a bare *os.File only exists on Unix, which is why Windows had no
	// terminal at all.
	ptmx          pty.Pty
	revision      int64
	activityState string // "idle" | "working"
	// attentionReason marks why a terminal wants attention. "finished" is set when a working
	// agent goes idle, which is what the sidebar's rollup shows; without it a long task that
	// just completed looks the same as one that never ran.
	attentionReason string
	// onActivityChange reports state and, when the state is idle because work just finished, the
	// attention reason. Without the reason a completed long task looks like one that never ran.
	onActivityChange func(state, attentionReason string)
	vt               *VTGrid
	backlog          *Backlog
	subscribers      map[int]func(OutputEvent)
	nextSubID        int
	closed           bool
	done             chan struct{}
	// exited closes when the child process itself has exited, which is earlier than done when
	// the process leaves children behind on the pty. Callers that start work in a terminal (the
	// workspace scripts) need the exit code, and only Wait can produce it.
	exited   chan struct{}
	exitCode *int
}

type StartOptions struct {
	ID            string
	Name          string
	Cwd           string
	WorkspaceID   string
	ActivityToken string
	// Title is the name the user gave the terminal. It stays separate from Name, which is the
	// generated "Terminal 1" label: renaming one does not change what the tab is, and the client
	// reads the two fields independently.
	Title string
	// ActivityURL is where a shell hook posts activity. Without it the hook has no destination and
	// every terminal reports idle forever.
	ActivityURL      string
	OnActivityChange func(state, attentionReason string)
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

	term, err := pty.New()
	if err != nil {
		return nil, fmt.Errorf("terminal: create pseudo-terminal: %w", err)
	}
	cmd := term.Command(shell, args...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	if len(opts.Env) > 0 {
		cmd.Env = home.ExternalProcessEnv(opts.Env)
	} else {
		// Strip runtime-control keys: a terminal that inherits the supervisor's identity makes
		// the Pi activity extension believe it is an inherited child and register no handlers,
		// so the terminal never reports running/idle.
		cmd.Env = home.ExternalProcessEnv(os.Environ())
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
	// Both names: the daemon's own hook reads BYSPACE_ACTIVITY_TOKEN, while the terminal docs and
	// third-party reporters use the longer one. Sending only the long form left every hook that
	// followed the documented contract failing auth with a 403.
	cmd.Env = append(cmd.Env,
		"BYSPACE_ACTIVITY_TOKEN="+actToken,
		"BYSPACE_TERMINAL_ACTIVITY_TOKEN="+actToken,
	)
	if activityURL := strings.TrimSpace(opts.ActivityURL); activityURL != "" {
		cmd.Env = append(cmd.Env, "BYSPACE_TERMINAL_ACTIVITY_URL="+activityURL)
	}
	// Agent hooks call "$BYSPACE_HOOK_CLI hooks ...". Point it at the daemon's own binary and put
	// that directory on PATH: the hook runs inside the user's shell, where a repo checkout's CLI is
	// not installed, so the default `byspace` lookup finds nothing and the hook dies quietly.
	if cli := byspaceCLIPath(); cli != "" {
		cmd.Env = append(cmd.Env, "BYSPACE_HOOK_CLI="+cli)
		cmd.Env = prependDirToPath(cmd.Env, filepath.Dir(cli))
	}

	// Size before start so the first render has the right dimensions; resizing after a process
	// has already drawn leaves the shell believing the old geometry.
	if err := term.Resize(int(cols), int(rows)); err != nil {
		_ = term.Close()
		return nil, fmt.Errorf("terminal: size pseudo-terminal: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = term.Close()
		return nil, err
	}

	s := &Session{
		ID:               opts.ID,
		Name:             opts.Name,
		Cwd:              opts.Cwd,
		WorkspaceID:      opts.WorkspaceID,
		ActivityToken:    actToken,
		Title:            strings.TrimSpace(opts.Title),
		cmd:              cmd,
		ptmx:             term,
		activityState:    "idle",
		onActivityChange: opts.OnActivityChange,
		vt:               NewVTGrid(int(rows), int(cols)),
		backlog:          NewBacklog(MaxBacklogChars),
		subscribers:      make(map[int]func(OutputEvent)),
		done:             make(chan struct{}),
		exited:           make(chan struct{}),
	}

	go s.readLoop()
	// Reap the child in its own goroutine: without Wait the exit code is lost and a finished
	// process stays a zombie until the session is closed.
	go s.waitForExit()
	return s, nil
}

func (s *Session) waitForExit() {
	code := 0
	if err := s.cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = -1
		}
	}
	s.mu.Lock()
	s.exitCode = &code
	s.mu.Unlock()
	close(s.exited)
}

// Exited closes when the child process has exited; ExitCode reports why. Both matter to
// callers that render a terminal-backed task's result.
func (s *Session) Exited() <-chan struct{} { return s.exited }

func (s *Session) ExitCode() *int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

// Pid reports the child's process id, or 0 once it is gone.
func (s *Session) Pid() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil || s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
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
			s.answerOSCColorQueries(chunk)
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
	// Resize takes (width, height); the grid above is (rows, cols).
	return ptmx.Resize(int(cols), int(rows))
}

func (s *Session) VT() *VTGrid { return s.vt }

// Size reports the current grid dimensions.
func (s *Session) Size() (rows, cols uint16) {
	r, c := s.vt.Size()
	return uint16(r), uint16(c)
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

// SetActivity records what the agent inside the terminal is doing.
//
// The three inputs are not three states: "attention" means the agent is waiting for the user, which
// is idle plus a reason. "idle" right after "working" likewise means the work finished, and a
// repeated "idle" must not wipe that marker — the tab still has something to show.
func (s *Session) SetActivity(state string) bool {
	if state != "idle" && state != "working" && state != "attention" {
		return false
	}
	s.mu.Lock()
	// attention maps to idle plus a reason, so the state machine below sees two states and one
	// reason rather than three states.
	nextState, nextReason := state, ""
	if state == "attention" {
		nextState, nextReason = "idle", "needs_input"
	} else if state == "idle" {
		switch {
		case s.activityState == "working":
			nextReason = "finished"
		case s.attentionReason == "finished":
			// Already recorded; a second idle report is the same fact.
			s.mu.Unlock()
			return false
		}
	}
	// An unchanged pair is not a change: broadcasting it would re-render every client's tab for
	// nothing, and the tests count those.
	if s.activityState == nextState && s.attentionReason == nextReason {
		s.mu.Unlock()
		return false
	}
	s.activityState = nextState
	s.attentionReason = nextReason
	reason := s.attentionReason
	cb := s.onActivityChange
	s.mu.Unlock()
	if cb != nil {
		cb(nextState, reason)
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
	}
	<-s.done
	return nil
}

// AttentionReason reports why this terminal wants attention, or "" when it does not.
func (s *Session) AttentionReason() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attentionReason
}

// SetTitle records the user's rename. The name stays as it was: the two fields answer different
// questions and the client renders both.
func (s *Session) SetTitle(title string) bool {
	trimmed := strings.TrimSpace(title)
	if s == nil || trimmed == "" {
		return false
	}
	s.mu.Lock()
	s.Title = trimmed
	s.mu.Unlock()
	return true
}

// TitleValue is the user's rename, or "" when nobody renamed the terminal.
func (s *Session) TitleValue() string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Title
}

// ClearAttention drops the attention marker once the user has seen it.
func (s *Session) ClearAttention() {
	s.mu.Lock()
	s.attentionReason = ""
	s.mu.Unlock()
}

// terminalColorQueryResponses answers a program that asks the terminal for its colors.
//
// Ported from TERMINAL_OSC_COLOR_QUERY_RESPONSES. A TUI that adapts to the terminal's light/dark mode sends
// OSC 10/11/12 and reads the reply; with no reply it falls back to its own default, which may be a light theme
// rendered inside this app's dark one.
//
// The colors are the app's own theme, not the terminal's: BySpace renders the grid itself, so "the terminal
// background" is the app's background.
var terminalColorQueryResponses = map[string]string{
	"10": "rgb:e6e6/e6e6/e6e6", // foreground
	"11": "rgb:0b0b/0b0b/0b0b", // background
	"12": "rgb:e6e6/e6e6/e6e6", // cursor
}

// answerOSCColorQueries writes replies for any color query in this chunk.
//
// A query can be split across reads — "\x1b]1" then "1;?" — so a chunk that ends inside a possible sequence is
// skipped rather than half-answered: a malformed reply is worse than a late one, because the program reads it
// as garbage in its input.
func (s *Session) answerOSCColorQueries(chunk []byte) {
	if s.ptmx == nil || !bytes.Contains(chunk, []byte("\x1b]")) {
		return
	}
	for _, state := range []string{"10", "11", "12"} {
		query := []byte("\x1b]" + state + ";?")
		if !bytes.Contains(chunk, query) {
			continue
		}
		response := "\x1b]" + state + ";" + terminalColorQueryResponses[state] + "\x1b\\"
		_, _ = s.ptmx.Write([]byte(response))
	}
}

// byspaceCLIPath returns the path to the CLI a terminal should hand to agent hooks.
//
// Hooks run `"${BYSPACE_HOOK_CLI:-byspace}" hooks ...`, so without this the terminal falls back to
// whatever `byspace` happens to be on PATH — which in a repo checkout is nothing at all, and the
// hook then fails silently inside a shell the user cannot see. BYSPACE_CLI overrides it, matching
// the node daemon, for the case where the CLI lives somewhere the daemon cannot guess.
func byspaceCLIPath() string {
	if override := strings.TrimSpace(os.Getenv("BYSPACE_CLI")); override != "" {
		return override
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, resolveErr := filepath.EvalSymlinks(exe); resolveErr == nil {
		exe = resolved
	}
	return exe
}

// prependDirToPath puts dir in front of PATH.
//
// Prepending rather than appending matters: a stale globally installed byspace would otherwise win,
// and a hook that talks to the wrong daemon reports nothing.
func prependDirToPath(env []string, dir string) []string {
	if dir == "" {
		return env
	}
	key := "PATH"
	for _, entry := range env {
		if name, _, ok := strings.Cut(entry, "="); ok && strings.EqualFold(name, "PATH") {
			key = name
			break
		}
	}
	var current string
	for _, entry := range env {
		if name, value, ok := strings.Cut(entry, "="); ok && strings.EqualFold(name, "PATH") {
			current = value
			break
		}
	}
	separator := ":"
	if runtime.GOOS == "windows" {
		separator = ";"
	}
	joined := dir
	if current != "" {
		joined += separator + current
	}
	return home.ExternalProcessEnv(env, map[string]string{key: joined})
}
