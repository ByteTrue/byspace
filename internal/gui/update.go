package gui

import (
	"context"
	"log"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/selfupdate"
)

// ClientUpdater manages background release polling, optional auto-download, and optional idle
// auto-install/restart (modeled on magpie's internal/gui/update.go and update_wait.go).
type ClientUpdater struct {
	Version       string
	HomeDir       string
	CheckInterval time.Duration
	OnFound       func(newVersion string)
	OnReady       func(newVersion string)
	OnAndroidAPK  func(newVersion, apkURL string)
	IsIdle        func() bool
	AutoRelaunch  func()

	mu      sync.Mutex
	state   string // "" | "checking" | "found" | "downloading" | "ready" | "error"
	bundle  string
	exe     string
	staged  string
	latest  *selfupdate.Release
	running bool
	stopCh  chan struct{}
}

// Start begins periodic background update checks and idle auto-restart polling.
func (u *ClientUpdater) Start() {
	u.mu.Lock()
	if u.running {
		u.mu.Unlock()
		return
	}
	u.running = true
	if u.CheckInterval <= 0 {
		u.CheckInterval = 6 * time.Hour
	}
	u.stopCh = make(chan struct{})
	if runtime.GOOS != "android" {
		if b := selfupdate.Bundle(); b != "" && selfupdate.Writable(filepath.Dir(b)) {
			u.bundle = b
		} else if exe, err := selfupdate.Executable(); err == nil && selfupdate.Writable(filepath.Dir(exe)) {
			u.exe = exe
			selfupdate.RemoveOld(exe)
		}
	}
	u.mu.Unlock()

	go func() {
		select {
		case <-u.stopCh:
			return
		case <-time.After(5 * time.Second):
		}
		if !LoadDesktopSettings(u.HomeDir).NoAutoUpdate {
			u.Check(false)
		}

		checkTicker := time.NewTicker(u.CheckInterval)
		defer checkTicker.Stop()
		idleTicker := time.NewTicker(5 * time.Second)
		defer idleTicker.Stop()

		for {
			select {
			case <-u.stopCh:
				return
			case <-checkTicker.C:
				if !LoadDesktopSettings(u.HomeDir).NoAutoUpdate {
					u.Check(false)
				}
			case <-idleTicker.C:
				u.AutoTick()
			}
		}
	}()
}

// Stop halts background update polling.
func (u *ClientUpdater) Stop() {
	u.mu.Lock()
	defer u.mu.Unlock()
	if !u.running {
		return
	}
	u.running = false
	close(u.stopCh)
}

// State returns the current update state ("", "checking", "found", "downloading", "ready", "error")
// and the latest discovered version string.
func (u *ClientUpdater) State() (state, latestVersion string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.latest != nil {
		latestVersion = u.latest.Version
	}
	return u.state, latestVersion
}

// CheckNow triggers an immediate check and downloads if a newer version is found.
func (u *ClientUpdater) CheckNow() {
	u.Check(true)
}

// Check queries the release feed. When forceDownload is false and DesktopSettings.NoAutoDownload
// is true, a newly discovered release stops at state="found" until the user clicks Download or
// turns auto-download on.
func (u *ClientUpdater) Check(forceDownload bool) {
	if !selfupdate.Released(u.Version) {
		return
	}
	u.mu.Lock()
	if u.state == "checking" || u.state == "downloading" {
		u.mu.Unlock()
		return
	}
	u.state = "checking"
	u.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	rel, err := selfupdate.Latest(ctx)
	if err != nil || rel == nil {
		u.mu.Lock()
		if u.staged != "" {
			u.state = "ready"
		} else {
			u.state = "error"
		}
		u.mu.Unlock()
		return
	}
	if !selfupdate.Newer(rel.Version, u.Version) {
		u.mu.Lock()
		u.state = ""
		u.mu.Unlock()
		return
	}

	if runtime.GOOS == "android" {
		u.mu.Lock()
		u.latest = rel
		u.state = "found"
		u.mu.Unlock()
		if apk, ok := rel.Assets[selfupdate.APKAsset()]; ok && apk.URL != "" && u.OnAndroidAPK != nil {
			u.OnAndroidAPK(rel.Version, apk.URL)
		}
		return
	}

	u.mu.Lock()
	bundle := u.bundle
	exe := u.exe
	alreadyStaged := u.staged != "" && u.latest != nil && u.latest.Version == rel.Version
	u.latest = rel
	if alreadyStaged {
		u.state = "ready"
		u.mu.Unlock()
		return
	}
	if bundle == "" && exe == "" {
		u.state = "found"
		u.mu.Unlock()
		return
	}
	prefs := LoadDesktopSettings(u.HomeDir)
	if prefs.NoAutoDownload && !forceDownload {
		u.state = "found"
		u.mu.Unlock()
		if u.OnFound != nil {
			u.OnFound(rel.Version)
		}
		return
	}
	u.state = "downloading"
	u.mu.Unlock()

	u.downloadAndStage(ctx, rel, bundle, exe)
}

// DownloadFound starts downloading a previously discovered update when NoAutoDownload was on.
func (u *ClientUpdater) DownloadFound() {
	u.mu.Lock()
	rel := u.latest
	bundle := u.bundle
	exe := u.exe
	if rel == nil || u.state == "downloading" || u.state == "ready" {
		u.mu.Unlock()
		return
	}
	u.state = "downloading"
	u.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		u.downloadAndStage(ctx, rel, bundle, exe)
	}()
}

func (u *ClientUpdater) downloadAndStage(ctx context.Context, rel *selfupdate.Release, bundle, exe string) {
	var staged string
	var err error
	if bundle != "" {
		staged, err = selfupdate.StageApp(ctx, rel, bundle)
	} else {
		staged, err = selfupdate.StageBinary(ctx, rel, exe)
	}
	if err != nil {
		log.Printf("byspace update stage failed: %v", err)
		u.mu.Lock()
		u.state = "error"
		u.mu.Unlock()
		return
	}

	u.mu.Lock()
	u.staged = staged
	u.latest = rel
	u.state = "ready"
	u.mu.Unlock()

	if u.OnReady != nil {
		u.OnReady(rel.Version)
	}
	u.AutoTick()
}

// AutoTick checks whether an already-staged update should be automatically installed and
// relaunched because AutoRestart is enabled in settings and the app/daemon are idle.
func (u *ClientUpdater) AutoTick() {
	if runtime.GOOS == "android" {
		return
	}
	prefs := LoadDesktopSettings(u.HomeDir)
	if prefs.NoAutoUpdate || !prefs.AutoRestart {
		return
	}
	u.mu.Lock()
	ready := u.state == "ready" && u.staged != ""
	u.mu.Unlock()
	if !ready {
		return
	}
	if u.IsIdle != nil && !u.IsIdle() {
		return
	}
	if u.AutoRelaunch != nil {
		u.AutoRelaunch()
	}
}

// InstallStaged swaps a previously staged update into place without relaunching (called on shutdown).
func (u *ClientUpdater) InstallStaged() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.staged == "" {
		return false
	}
	var err error
	if u.bundle != "" {
		err = selfupdate.InstallApp(u.staged, u.bundle)
	} else if u.exe != "" {
		err = selfupdate.InstallBinary(u.staged, u.exe)
	}
	if err != nil {
		log.Printf("byspace update install failed: %v", err)
		return false
	}
	u.staged = ""
	u.state = ""
	return true
}

// InstallAndRelaunch swaps the staged update in and spawns the new version before the caller quits.
func (u *ClientUpdater) InstallAndRelaunch(showWindow bool) bool {
	u.mu.Lock()
	bundle := u.bundle
	exe := u.exe
	u.mu.Unlock()

	if !u.InstallStaged() {
		return false
	}
	var err error
	if bundle != "" {
		err = selfupdate.RelaunchApp(bundle, showWindow)
	} else if exe != "" {
		err = selfupdate.RelaunchBinary(exe, showWindow)
	}
	if err != nil {
		log.Printf("byspace update relaunch failed: %v", err)
		return false
	}
	return true
}
