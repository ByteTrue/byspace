package gui

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/gui/autostart"
	"github.com/ByteTrue/byspace/internal/gui/awake"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/home/backup"
	"github.com/ByteTrue/byspace/internal/selfupdate"
	"github.com/ByteTrue/byspace/internal/server"
)

//go:embed tray.png
var trayIconPNG []byte

//go:embed tray-template.png
var trayTemplatePNG []byte

type trayCallbacks struct {
	onOpen     func()
	onOpenURL  func(url string)
	onDownload func()
	onRestart  func()
	onCheck    func()
	onQuit     func()
}

type trayViewState struct {
	version      string
	daemonLabel  string
	updateLabel  string
	updateAction int // 0 = hidden, 1 = download, 2 = restart
}

func buildDesktopStatusPayload(homeDir string, daemonSt DaemonHostStatus, updater *ClientUpdater) map[string]any {
	var upd UpdateStatusSnapshot
	if updater != nil {
		upd = updater.Status()
	}
	prefs := LoadDesktopSettings(homeDir)
	prefs.KeepAwake = string(prefs.EffectiveKeepAwake())
	prefs.UpdateEvery = prefs.EffectiveUpdateEvery()
	return map[string]any{
		"desktop":          true,
		"platform":         runtime.GOOS,
		"settings":         prefs,
		"openAtLogin":      autostart.Enabled() == autostart.On,
		"daemonStatus":     daemonSt,
		"backupCount":      len(backup.List(homeDir)),
		"configFolder":     selfupdate.TildePath(homeDir),
		"configFolderFull": homeDir,
		"cliStatus":        selfupdate.ReadCLIStatus(),
		"update":           upd,
		"updateState":      upd.State,
		"latestVersion":    upd.LatestVersion,
	}
}

func withDesktopSettingsAPI(
	next http.Handler,
	homeDir string,
	daemonStatus func() DaemonHostStatus,
	onTakeOver func(),
	updater *ClientUpdater,
	onOpenConfigFolder func(),
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_byspace/desktop/settings" {
			if next != nil {
				next.ServeHTTP(w, r)
			} else {
				http.NotFound(w, r)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		readDaemonStatus := func() DaemonHostStatus {
			if daemonStatus != nil {
				return daemonStatus()
			}
			return DaemonHostStatus{}
		}
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(buildDesktopStatusPayload(homeDir, readDaemonStatus(), updater))
			return
		case http.MethodPost:
			current := LoadDesktopSettings(homeDir)
			var patch struct {
				KeepAwake        *string `json:"keepAwake"`
				OpenAtLogin      *bool   `json:"openAtLogin"`
				NoAutoUpdate     *bool   `json:"noAutoUpdate"`
				UpdateEvery      *int    `json:"updateEvery"`
				NoAutoDownload   *bool   `json:"noAutoDownload"`
				AutoRestart      *bool   `json:"autoRestart"`
				LinkCLI          bool    `json:"linkCLI"`
				AddCLIToPath     bool    `json:"addCLIToPath"`
				OpenConfigFolder bool    `json:"openConfigFolder"`
				CheckForUpdates  bool    `json:"checkForUpdates"`
				DownloadUpdate   bool    `json:"downloadUpdate"`
				RestartToUpdate  bool    `json:"restartToUpdate"`
				TakeOverDaemon   bool    `json:"takeOverDaemon"`
				CreateBackup     bool    `json:"createBackup"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&patch); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if patch.KeepAwake != nil {
				current.KeepAwake = string(awake.NormalizeLevel(*patch.KeepAwake))
				awake.Notify()
			}
			if patch.NoAutoUpdate != nil {
				current.NoAutoUpdate = *patch.NoAutoUpdate
			}
			if patch.UpdateEvery != nil {
				current.UpdateEvery = *patch.UpdateEvery
			}
			if patch.NoAutoDownload != nil {
				current.NoAutoDownload = *patch.NoAutoDownload
			}
			if patch.AutoRestart != nil {
				current.AutoRestart = *patch.AutoRestart
			}
			if err := SaveDesktopSettings(homeDir, current); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if patch.OpenAtLogin != nil {
				_ = autostart.Set(*patch.OpenAtLogin)
			}
			if patch.LinkCLI || patch.AddCLIToPath {
				_, _ = selfupdate.AddCLIToPath()
			}
			if patch.OpenConfigFolder && onOpenConfigFolder != nil {
				go onOpenConfigFolder()
			}
			if patch.TakeOverDaemon && onTakeOver != nil {
				onTakeOver()
			}
			if patch.CreateBackup {
				_, _, _ = backup.Snapshot(homeDir)
			}
			if updater != nil {
				if patch.CheckForUpdates {
					go updater.Check(false)
				} else if patch.DownloadUpdate {
					updater.DownloadFound()
				} else if patch.RestartToUpdate && updater.AutoRelaunch != nil {
					go updater.AutoRelaunch()
				} else {
					if patch.NoAutoDownload != nil && !*patch.NoAutoDownload {
						updater.DownloadFound()
					}
					if patch.AutoRestart != nil && *patch.AutoRestart {
						go updater.AutoTick()
					}
				}
			}
			_ = json.NewEncoder(w).Encode(buildDesktopStatusPayload(homeDir, readDaemonStatus(), updater))
			return
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}

// NewStandaloneSettingsHandler builds a /_byspace/desktop/settings handler for a standalone
// `byspace serve` daemon process so the Local Web Settings screen works even when launched
// directly via `byspace serve`.
func NewStandaloneSettingsHandler(homeDir, version, listenAddr string, hasActiveWork func() bool, requestRestart func(reason string)) (http.Handler, func()) {
	bgCtx, cancelBg := context.WithCancel(context.Background())

	var busyMu sync.Mutex
	var lastBusy time.Time
	isBusy := func() (bool, time.Time) {
		if hasActiveWork != nil && hasActiveWork() {
			now := time.Now()
			busyMu.Lock()
			lastBusy = now
			busyMu.Unlock()
			return true, now
		}
		busyMu.Lock()
		last := lastBusy
		busyMu.Unlock()
		return false, last
	}

	go awake.Keep(bgCtx, func() awake.Level {
		return LoadDesktopSettings(homeDir).EffectiveKeepAwake()
	}, func() awake.State {
		if isBusy == nil {
			return awake.State{}
		}
		busy, last := isBusy()
		return awake.State{Busy: busy, Last: last}
	})

	if os.Getenv("BYSPACE_E2E") != "1" {
		go backup.StartPeriodic(bgCtx, homeDir)
	}

	var relaunchOnce sync.Once
	updater := &ClientUpdater{
		Version: version,
		HomeDir: homeDir,
		IsIdle: func() bool {
			busy, last := false, time.Time{}
			if isBusy != nil {
				busy, last = isBusy()
			}
			return IdleAt(busy, last, time.Now(), IdleSettle)
		},
	}
	updater.AutoRelaunch = func() {
		relaunchOnce.Do(func() {
			if !updater.InstallStaged() {
				return
			}
			if requestRestart != nil {
				requestRestart("desktop_update")
			}
		})
	}
	updater.Start()

	dialAddr := daemon.DialAddress(listenAddr)
	statusFn := func() DaemonHostStatus {
		return DaemonHostStatus{
			InProcess:      true,
			Healthy:        true,
			Addr:           dialAddr,
			RunningVersion: version,
		}
	}
	h := withDesktopSettingsAPI(
		nil,
		homeDir,
		statusFn,
		nil,
		updater,
		func() { _ = openFolder(homeDir) },
	)
	cleanup := func() {
		cancelBg()
		updater.Stop()
	}
	return h, cleanup
}

func setupDesktopLogFile(homeDir string) *os.File {
	if homeDir == "" {
		return nil
	}
	_ = os.MkdirAll(homeDir, 0o700)
	logPath := filepath.Join(homeDir, "daemon.log")
	if fi, err := os.Stat(logPath); err == nil && fi.Size() > 10<<20 {
		_ = os.Rename(logPath, logPath+".old")
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil
	}
	if runtime.GOOS == "windows" {
		log.SetOutput(f)
	} else {
		log.SetOutput(io.MultiWriter(os.Stderr, f))
	}
	return f
}

func formatDaemonTrayLabel(st DaemonHostStatus) string {
	switch {
	case st.InProcess:
		return fmt.Sprintf("Daemon: %s", st.Addr)
	case st.Healthy:
		return fmt.Sprintf("Daemon: %s (external)", st.Addr)
	default:
		return fmt.Sprintf("Daemon: %s (starting…)", st.Addr)
	}
}

// Run starts the BySpace desktop supervisor and system tray, and opens the Local Web UI (or
// installed desktop PWA) when showMain is true or initialLink is non-empty.
func Run(version string, showMain bool, initialLink string) error {
	selfupdate.AwaitPredecessor()
	homeDir, err := home.Resolve("")
	if err != nil {
		return fmt.Errorf("resolve byspace home: %w", err)
	}
	if acquireOrHandOverGUILock(homeDir, showMain, initialLink) {
		return nil
	}

	if logFile := setupDesktopLogFile(homeDir); logFile != nil {
		defer logFile.Close()
	}
	_ = autostart.Refresh()

	bgCtx, cancelBg := context.WithCancel(context.Background())
	defer cancelBg()

	listenAddr := ResolveDesktopListenAddr(homeDir)
	sup := &DaemonSupervisor{
		Addr:       daemon.DialAddress(listenAddr),
		ListenAddr: listenAddr,
		HomeDir:    homeDir,
		Version:    version,
	}

	go awake.Keep(bgCtx, func() awake.Level {
		return LoadDesktopSettings(homeDir).EffectiveKeepAwake()
	}, func() awake.State {
		busy, last := sup.BusyState()
		return awake.State{Busy: busy, Last: last}
	})

	if os.Getenv("BYSPACE_E2E") != "1" {
		go backup.StartPeriodic(bgCtx, homeDir)
	}

	var relaunchOnce sync.Once
	exitForRelaunch := func() {
		cancelBg()
		closeDaemonBounded(sup)
		os.Exit(0)
	}

	var updater *ClientUpdater
	triggerRelaunch := func(reopenWeb bool) {
		relaunchOnce.Do(func() {
			sup.StopExternalDaemon()
			if updater == nil || !updater.InstallAndRelaunch(reopenWeb) {
				return
			}
			exitForRelaunch()
		})
	}

	sup.SetControlHandler(func(req server.ControlRequest) {
		action := "stop"
		if req.Restart {
			action = "restart"
		}
		log.Printf("byspace gui: daemon %s requested by a client: %s", action, req.Reason)
		if !req.Restart {
			stopPlatformTray()
			return
		}
		relaunchOnce.Do(func() {
			if !relaunchApp(false) {
				return
			}
			exitForRelaunch()
		})
	})

	var trayMu sync.Mutex
	curTray := trayViewState{
		version:     version,
		daemonLabel: "Daemon: " + sup.Addr,
	}
	syncTray := func() {
		st := sup.Status()
		var updState, updVer string
		if updater != nil {
			updState, updVer = updater.State()
		}
		trayMu.Lock()
		curTray.daemonLabel = formatDaemonTrayLabel(st)
		switch updState {
		case "found":
			curTray.updateLabel = "Download update v" + updVer
			curTray.updateAction = 1
		case "ready":
			curTray.updateLabel = "Restart to update to v" + updVer
			curTray.updateAction = 2
		default:
			curTray.updateLabel = ""
			curTray.updateAction = 0
		}
		snap := curTray
		trayMu.Unlock()
		updatePlatformTray(snap)
	}

	updater = &ClientUpdater{
		Version: version,
		HomeDir: homeDir,
		OnFound: func(_ string) {
			syncTray()
		},
		OnReady: func(_ string) {
			syncTray()
		},
		IsIdle: func() bool {
			agentBusy, lastBusy := sup.BusyState()
			return IdleAt(agentBusy, lastBusy, time.Now(), IdleSettle)
		},
		AutoRelaunch: func() {
			triggerRelaunch(false)
		},
	}

	sup.DesktopSettingsHandler = withDesktopSettingsAPI(
		nil,
		homeDir,
		sup.Status,
		func() {
			sup.TakeOver()
			syncTray()
		},
		updater,
		func() { _ = openFolder(homeDir) },
	)

	if err := sup.Start(); err != nil {
		log.Printf("byspace gui: daemon supervisor warning: %v", err)
	}
	updater.Start()
	syncTray()

	if showMain || strings.TrimSpace(initialLink) != "" {
		_ = OpenLocalWebApp(BuildLocalWebURL(sup.Addr, initialLink))
	}

	stopPoll := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopPoll:
				return
			case <-ticker.C:
				syncTray()
			}
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case <-stopPoll:
		case <-sigCh:
			stopPlatformTray()
		}
	}()

	trayMu.Lock()
	initialSnap := curTray
	trayMu.Unlock()

	runErr := runPlatformTray(initialSnap, trayCallbacks{
		onOpen: func() {
			_ = OpenLocalWebApp(BuildLocalWebURL(sup.Addr, ""))
		},
		onOpenURL: func(rawURL string) {
			_ = OpenLocalWebApp(BuildLocalWebURL(sup.Addr, rawURL))
		},
		onDownload: func() {
			updater.DownloadFound()
			syncTray()
		},
		onRestart: func() {
			triggerRelaunch(true)
		},
		onCheck: func() {
			go func() {
				updater.CheckNow()
				syncTray()
			}()
		},
		onQuit: func() {
			stopPlatformTray()
		},
	})

	close(stopPoll)
	signal.Stop(sigCh)
	cancelBg()
	updater.Stop()
	closeDaemonBounded(sup)
	updater.InstallStaged()
	return runErr
}
