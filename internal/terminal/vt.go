package terminal

import (
	"crypto/subtle"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/ByteTrue/byspace/internal/home"
)

// Cell represents a single character cell in the virtual terminal grid.
type Cell struct {
	Char string `json:"char"`
	Fg   int    `json:"fg,omitempty"`
	Bg   int    `json:"bg,omitempty"`
	Bold bool   `json:"bold,omitempty"`
}

// Cursor represents the terminal cursor position and visibility in TerminalStateSchema.
type Cursor struct {
	Row    int  `json:"row"`
	Col    int  `json:"col"`
	Hidden bool `json:"hidden,omitempty"`
}

// StateSnapshot mirrors TerminalStateSchema in @bytetrue/protocol/messages sent via OpcodeSnapshot (0x04).
type StateSnapshot struct {
	Rows            int      `json:"rows"`
	Cols            int      `json:"cols"`
	Grid            [][]Cell `json:"grid"`
	Scrollback      [][]Cell `json:"scrollback"`
	Cursor          Cursor   `json:"cursor"`
	AlternateScreen bool     `json:"-"`
	BracketedPaste  bool     `json:"-"`
	ApplicationKeys bool     `json:"-"`
	MouseTracking   bool     `json:"-"`
	ReplayPreamble  string   `json:"-"`
}

// VTGrid maintains a lightweight pure-Go virtual terminal screen buffer and input mode tracker.
type VTGrid struct {
	mu              sync.Mutex
	rows            int
	cols            int
	cursorX         int
	cursorY         int
	cursorVisible   bool
	alternateScreen bool
	bracketedPaste  bool
	applicationKeys bool
	mouseTracking   bool
	grid            [][]Cell
}

// NewVTGrid creates a virtual terminal screen buffer of the given dimensions.
func NewVTGrid(rows, cols int) *VTGrid {
	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}
	v := &VTGrid{
		rows:          rows,
		cols:          cols,
		cursorVisible: true,
	}
	v.resetGridLocked()
	return v
}

func (v *VTGrid) resetGridLocked() {
	v.grid = make([][]Cell, v.rows)
	for r := 0; r < v.rows; r++ {
		v.grid[r] = make([]Cell, v.cols)
		for c := 0; c < v.cols; c++ {
			v.grid[r][c] = Cell{Char: " "}
		}
	}
	v.cursorX = 0
	v.cursorY = 0
}

// Resize adjusts the virtual screen dimensions.
// Size reports the grid dimensions under the write lock.
func (v *VTGrid) Size() (rows, cols int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.rows, v.cols
}

func (v *VTGrid) Resize(rows, cols int) {
	if rows <= 0 || cols <= 0 {
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	newGrid := make([][]Cell, rows)
	for r := 0; r < rows; r++ {
		newGrid[r] = make([]Cell, cols)
		for c := 0; c < cols; c++ {
			if r < len(v.grid) && c < len(v.grid[r]) {
				newGrid[r][c] = v.grid[r][c]
			} else {
				newGrid[r][c] = Cell{Char: " "}
			}
		}
	}
	v.rows = rows
	v.cols = cols
	v.grid = newGrid
	if v.cursorX >= cols {
		v.cursorX = cols - 1
	}
	if v.cursorY >= rows {
		v.cursorY = rows - 1
	}
}

// Write feeds raw PTY output bytes into the virtual terminal state machine.
func (v *VTGrid) Write(data []byte) {
	v.mu.Lock()
	defer v.mu.Unlock()

	s := string(data)
	// Track DEC private modes (?1h/l, ?2004h/l, ?1000h/l, ?1006h/l, ?1049h/l, ?25h/l)
	v.trackModesLocked(s)

	i := 0
	runes := []rune(s)
	for i < len(runes) {
		ch := runes[i]
		if ch == '\x1b' {
			// Skip CSI / OSC escape sequences when updating printable cells
			i++
			if i >= len(runes) {
				break
			}
			switch runes[i] {
			case '[':
				i++
				for i < len(runes) && (runes[i] < 0x40 || runes[i] > 0x7e) {
					i++
				}
				if i < len(runes) {
					if runes[i] == 'H' || runes[i] == 'J' {
						v.cursorX = 0
						v.cursorY = 0
					}
					i++
				}
			case ']':
				i++
				for i < len(runes) && runes[i] != '\x07' {
					if runes[i] == '\x1b' && i+1 < len(runes) && runes[i+1] == '\\' {
						i++
						break
					}
					i++
				}
				if i < len(runes) {
					i++
				}
			default:
				i++
			}
			continue
		}

		switch ch {
		case '\r':
			v.cursorX = 0
		case '\n':
			v.lineFeedLocked()
		case '\b':
			if v.cursorX > 0 {
				v.cursorX--
			}
		case '\t':
			v.cursorX = (v.cursorX + 8) &^ 7
			if v.cursorX >= v.cols {
				v.cursorX = 0
				v.lineFeedLocked()
			}
		default:
			if ch >= 0x20 {
				if v.cursorX >= v.cols {
					v.cursorX = 0
					v.lineFeedLocked()
				}
				if v.cursorY >= 0 && v.cursorY < v.rows && v.cursorX >= 0 && v.cursorX < v.cols {
					v.grid[v.cursorY][v.cursorX] = Cell{Char: string(ch)}
					v.cursorX++
				}
			}
		}
		i++
	}
}

func (v *VTGrid) lineFeedLocked() {
	if v.cursorY+1 < v.rows {
		v.cursorY++
		return
	}
	copy(v.grid[0:], v.grid[1:])
	last := make([]Cell, v.cols)
	for c := 0; c < v.cols; c++ {
		last[c] = Cell{Char: " "}
	}
	v.grid[v.rows-1] = last
}

func (v *VTGrid) trackModesLocked(s string) {
	if strings.Contains(s, "\x1b[?2004h") {
		v.bracketedPaste = true
	}
	if strings.Contains(s, "\x1b[?2004l") {
		v.bracketedPaste = false
	}
	if strings.Contains(s, "\x1b[?1h") {
		v.applicationKeys = true
	}
	if strings.Contains(s, "\x1b[?1l") {
		v.applicationKeys = false
	}
	if strings.Contains(s, "\x1b[?1049h") {
		v.alternateScreen = true
		v.resetGridLocked()
	}
	if strings.Contains(s, "\x1b[?1049l") {
		v.alternateScreen = false
		v.resetGridLocked()
	}
	if strings.Contains(s, "\x1b[?1000h") || strings.Contains(s, "\x1b[?1002h") || strings.Contains(s, "\x1b[?1003h") || strings.Contains(s, "\x1b[?1006h") {
		v.mouseTracking = true
	}
	if strings.Contains(s, "\x1b[?1000l") || strings.Contains(s, "\x1b[?1002l") || strings.Contains(s, "\x1b[?1003l") {
		v.mouseTracking = false
	}
	if strings.Contains(s, "\x1b[?25l") {
		v.cursorVisible = false
	}
	if strings.Contains(s, "\x1b[?25h") {
		v.cursorVisible = true
	}
}

// ReplayPreamble returns the ANSI sequence needed to restore active DEC private modes on reconnect.
func (v *VTGrid) ReplayPreamble() string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.replayPreambleLocked()
}

func (v *VTGrid) replayPreambleLocked() string {
	var sb strings.Builder
	if v.alternateScreen {
		sb.WriteString("\x1b[?1049h")
	}
	if v.bracketedPaste {
		sb.WriteString("\x1b[?2004h")
	}
	if v.applicationKeys {
		sb.WriteString("\x1b[?1h")
	}
	if v.mouseTracking {
		sb.WriteString("\x1b[?1000h\x1b[?1006h")
	}
	if !v.cursorVisible {
		sb.WriteString("\x1b[?25l")
	}
	return sb.String()
}

// Snapshot returns a serializable StateSnapshot and its encoded OpcodeSnapshot (0x04) frame.
func (v *VTGrid) Snapshot(slot uint8) (StateSnapshot, []byte) {
	v.mu.Lock()
	defer v.mu.Unlock()

	grid := make([][]Cell, v.rows)
	for r := 0; r < v.rows; r++ {
		cells := make([]Cell, v.cols)
		copy(cells, v.grid[r])
		grid[r] = cells
	}
	snap := StateSnapshot{
		Rows:       v.rows,
		Cols:       v.cols,
		Grid:       grid,
		Scrollback: [][]Cell{},
		Cursor: Cursor{
			Row:    v.cursorY,
			Col:    v.cursorX,
			Hidden: !v.cursorVisible,
		},
		AlternateScreen: v.alternateScreen,
		BracketedPaste:  v.bracketedPaste,
		ApplicationKeys: v.applicationKeys,
		MouseTracking:   v.mouseTracking,
		ReplayPreamble:  v.replayPreambleLocked(),
	}
	payload, _ := json.Marshal(snap)
	return snap, EncodeFrame(OpcodeSnapshot, slot, payload)
}

// ValidateActivityToken performs a constant-time comparison of a terminal activity token.
func (s *Session) ValidateActivityToken(candidate string) bool {
	if s == nil || s.ActivityToken == "" || candidate == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(s.ActivityToken), []byte(candidate)) == 1
}

const piTerminalActivityHookSource = `// Installed by BySpace for terminal activity reporting.
export default function byspaceTerminalActivity(pi) {
  const url = process.env.BYSPACE_TERMINAL_ACTIVITY_URL;
  const terminalId = process.env.BYSPACE_TERMINAL_ID;
  const token = process.env.BYSPACE_TERMINAL_ACTIVITY_TOKEN;
  if (!url || !terminalId || !token) return;
  const report = (state) => {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId, token, state }),
    }).catch(() => {});
  };
  pi.on("turn_start", () => report("running"));
  pi.on("turn_end", () => report("idle"));
  pi.on("session_shutdown", () => report("idle"));
}
`

// EnsureAgentHooksInstalled installs the Pi terminal activity extension into userHomeDir/.pi/agent/extensions/.
func EnsureAgentHooksInstalled(userHomeDir string) (string, error) {
	if strings.TrimSpace(userHomeDir) == "" {
		var err error
		userHomeDir, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	extPath := filepath.Join(userHomeDir, ".pi", "agent", "extensions", "byspace-terminal-activity.ts")
	if err := home.WriteAtomic(extPath, []byte(piTerminalActivityHookSource), 0o644); err != nil {
		return "", err
	}
	return extPath, nil
}
