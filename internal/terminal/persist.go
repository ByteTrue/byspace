package terminal

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/ByteTrue/byspace/internal/home"
)

// PersistedTerminalSession is the metadata needed to recreate a tab.
//
// Ported from terminal/terminal-session-store.ts. The processes and their scrollback do not
// survive a restart — nothing can bring a shell back — but the tabs themselves can, so the user
// reopens the app to the terminal they were using instead of an empty panel.
//
// This is deliberately not a session snapshot: no output, no pty handle, no child pid. Restoring
// a pid from a previous run would attach the UI to a process that is not there.
type PersistedTerminalSession struct {
	ID          string   `json:"id"`
	Cwd         string   `json:"cwd"`
	WorkspaceID string   `json:"workspaceId"`
	Name        string   `json:"name"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
}

// TerminalSessionsFile is where the tab list lives under $BYSPACE_HOME.
func TerminalSessionsFile(homeDir string) string {
	return filepath.Join(homeDir, "terminal-sessions.json")
}

// LoadPersistedTerminals reads the tab list, returning nil when there is none.
//
// A malformed file reads as "no tabs": a broken side file must not stop the daemon from starting.
func LoadPersistedTerminals(homeDir string) []PersistedTerminalSession {
	raw, err := os.ReadFile(TerminalSessionsFile(homeDir))
	if err != nil {
		return nil
	}
	var sessions []PersistedTerminalSession
	if json.Unmarshal(raw, &sessions) != nil {
		return nil
	}
	// Entries missing an id or cwd cannot be recreated and would waste a tab slot.
	out := make([]PersistedTerminalSession, 0, len(sessions))
	for _, session := range sessions {
		if session.ID == "" || session.Cwd == "" {
			continue
		}
		out = append(out, session)
	}
	return out
}

// SavePersistedTerminals writes the tab list atomically.
//
// Called on every membership change (create, exit, kill): a tab that existed when the process
// died is exactly what the user expects to find again.
func SavePersistedTerminals(homeDir string, sessions []PersistedTerminalSession) error {
	if sessions == nil {
		sessions = []PersistedTerminalSession{}
	}
	raw, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(TerminalSessionsFile(homeDir), append(raw, '\n'), 0o600)
}
