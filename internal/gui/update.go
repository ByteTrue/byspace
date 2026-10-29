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

// ClientUpdater checks for new releases in the background and stages them for one-click restart
// on desktop (matching Magpie's internal/gui/update.go) or notifies the Android client with the
// sideload APK download URL.
type ClientUpdater struct {
	Version       string
	CheckInterval time.Duration
	OnReady       func(newVersion string)
	OnAndroidAPK  func(newVersion, apkURL string)

	mu      sync.Mutex
	bundle  string
	exe     string
	staged  string
	latest  *selfupdate.Release
	running bool
	stopCh  chan struct{}
}

// Start begins periodic background update checks.
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
		u.CheckNow()

		ticker := time.NewTicker(u.CheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-u.stopCh:
				return
			case <-ticker.C:
				u.CheckNow()
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

// CheckNow checks the release feed once and stages an update when a newer version is available.
func (u *ClientUpdater) CheckNow() {
	if !selfupdate.Released(u.Version) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	rel, err := selfupdate.Latest(ctx)
	if err != nil || rel == nil {
		return
	}
	if !selfupdate.Newer(rel.Version, u.Version) {
		return
	}

	if runtime.GOOS == "android" {
		if apk, ok := rel.Assets[selfupdate.APKAsset()]; ok && apk.URL != "" && u.OnAndroidAPK != nil {
			u.OnAndroidAPK(rel.Version, apk.URL)
		}
		return
	}

	u.mu.Lock()
	bundle := u.bundle
	exe := u.exe
	alreadyStaged := u.staged != "" && u.latest != nil && u.latest.Version == rel.Version
	u.mu.Unlock()
	if alreadyStaged || (bundle == "" && exe == "") {
		return
	}

	var staged string
	if bundle != "" {
		staged, err = selfupdate.StageApp(ctx, rel, bundle)
	} else {
		staged, err = selfupdate.StageBinary(ctx, rel, exe)
	}
	if err != nil {
		log.Printf("byspace update stage failed: %v", err)
		return
	}

	u.mu.Lock()
	u.staged = staged
	u.latest = rel
	u.mu.Unlock()

	if u.OnReady != nil {
		u.OnReady(rel.Version)
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
