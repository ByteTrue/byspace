package gui

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/gui/awake"
	"github.com/ByteTrue/byspace/internal/home"
)

const (
	desktopSettingsFile = "desktop.json"
	LightEvery          = 30 * time.Second
	LightTicks          = 2
	IdleSettle          = 10 * time.Second
)

var ValidUpdateEveries = []int{30, 60, 360, 1440}

// DesktopSettings stores the desktop client preferences in $BYSPACE_HOME/desktop.json.
type DesktopSettings struct {
	KeepAwake      string    `json:"keepAwake,omitempty"` // "off" | "system" (default) | "display"
	DockMode       string    `json:"dockMode,omitempty"`  // "show" (default) | "window" | "hide"
	HideFromDock   bool      `json:"hideFromDock,omitempty"`
	Lightweight    bool      `json:"lightweight"`
	NoAutoUpdate   bool      `json:"noAutoUpdate"`
	UpdateEvery    int       `json:"updateEvery,omitempty"` // minutes: 30, 60, 360 (default, 6h), 1440
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

// EffectiveDockMode returns "show", "window", or "hide".
func (s DesktopSettings) EffectiveDockMode() string {
	switch strings.ToLower(strings.TrimSpace(s.DockMode)) {
	case "hide":
		return "hide"
	case "window":
		return "window"
	case "show":
		return "show"
	}
	if s.HideFromDock {
		return "window"
	}
	return "show"
}

// EffectiveUpdateEvery returns the check interval in minutes (defaulting to 360 minutes / 6 hours, matching Magpie).
func (s DesktopSettings) EffectiveUpdateEvery() int {
	if slices.Contains(ValidUpdateEveries, s.UpdateEvery) {
		return s.UpdateEvery
	}
	return 360
}

// LoadDesktopSettings reads $BYSPACE_HOME/desktop.json, returning defaults when absent.
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
