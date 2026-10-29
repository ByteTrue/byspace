package gui

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/ByteTrue/byspace/internal/awake"
	"github.com/ByteTrue/byspace/internal/home"
)

const (
	desktopSettingsFile = "desktop.json"
	LightEvery          = 30 * time.Second
	LightTicks          = 2
	IdleSettle          = 10 * time.Second
)

// DesktopSettings stores the desktop client preferences in $BYSPACE_HOME/desktop.json.
type DesktopSettings struct {
	KeepAwake      string    `json:"keepAwake,omitempty"` // "off" | "system" (default) | "display"
	HideFromDock   bool      `json:"hideFromDock"`        // macOS: hide from Dock when main window is closed
	Lightweight    bool      `json:"lightweight"`
	NoAutoUpdate   bool      `json:"noAutoUpdate"`
	NoAutoDownload bool      `json:"noAutoDownload"`
	AutoRestart    bool      `json:"autoRestart"`
	WindowWidth    int       `json:"windowWidth,omitempty"`
	WindowHeight   int       `json:"windowHeight,omitempty"`
	TitleBarColor  *[3]uint8 `json:"titleBarColor,omitempty"`
	TitleBarDark   bool      `json:"titleBarDark,omitempty"`
}

// EffectiveKeepAwake returns the normalized awake.Level (defaulting empty to awake.System).
func (s DesktopSettings) EffectiveKeepAwake() awake.Level {
	return awake.NormalizeLevel(s.KeepAwake)
}

// LoadDesktopSettings reads $BYSPACE_HOME/desktop.json, returning zero-value defaults when absent.
func LoadDesktopSettings(homeDir string) DesktopSettings {
	if homeDir == "" {
		return DesktopSettings{}
	}
	raw, err := os.ReadFile(filepath.Join(homeDir, desktopSettingsFile))
	if err != nil {
		return DesktopSettings{}
	}
	var s DesktopSettings
	if json.Unmarshal(raw, &s) != nil {
		return DesktopSettings{}
	}
	return s
}

// SaveDesktopSettings atomically persists s to $BYSPACE_HOME/desktop.json.
func SaveDesktopSettings(homeDir string, s DesktopSettings) error {
	if homeDir == "" {
		return nil
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(filepath.Join(homeDir, desktopSettingsFile), append(b, '\n'), 0o600)
}

// LightStep evaluates one 30s lightweight-mode tick (ported from magpie's lightweight_rule.go).
func LightStep(on, shown bool, ticks int) (int, bool) {
	if !on || shown {
		return 0, false
	}
	ticks++
	return ticks, ticks >= LightTicks
}

// IdleAt reports whether a staged update can safely auto-restart at now without interrupting
// active agents, a recent turn transition (settle window), or a focused foreground window.
func IdleAt(agentBusy, windowFocused bool, lastBusy, now time.Time, settle time.Duration) bool {
	if agentBusy || windowFocused {
		return false
	}
	if !lastBusy.IsZero() && now.Sub(lastBusy) < settle {
		return false
	}
	return true
}
