//go:build !nogui

package gui

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/ByteTrue/byspace/internal/gui/autostart"
	"github.com/ByteTrue/byspace/internal/gui/awake"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/home/backup"
	"github.com/ByteTrue/byspace/internal/selfupdate"
	"github.com/ByteTrue/byspace/internal/server"
	"github.com/ByteTrue/byspace/internal/webui"
)

//go:embed icon.png
var appIcon []byte

//go:embed tray.png
var trayIcon []byte

//go:embed tray-template.png
var trayTemplateIcon []byte

func buildDesktopStatusPayload(homeDir string, sup *DaemonSupervisor, updater *ClientUpdater) map[string]any {
	var upd UpdateStatusSnapshot
	if updater != nil {
		upd = updater.Status()
	}
	prefs := LoadDesktopSettings(homeDir)
	prefs.KeepAwake = string(prefs.EffectiveKeepAwake())
	prefs.DockMode = prefs.EffectiveDockMode()
	prefs.UpdateEvery = prefs.EffectiveUpdateEvery()
	var daemonSt DaemonHostStatus
	if sup != nil {
		daemonSt = sup.Status()
	}
	return map[string]any{
		"desktop":          runtime.GOOS != "android",
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
	sup *DaemonSupervisor,
	updater *ClientUpdater,
	onDockChanged func(DesktopSettings),
	onTintTitleBar func([3]uint8, bool),
	onWindowAction func(string) map[string]any,
	onOpenConfigFolder func(),
	onNotify func(id, title, body string, data map[string]any) bool,
	onAuthorizeNotifications func() bool,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_byspace/desktop/notify/authorize" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(map[string]any{"authorized": onAuthorizeNotifications != nil && onAuthorizeNotifications()})
			return
		}
		if r.URL.Path == "/_byspace/desktop/notify" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			var req struct {
				ID    string         `json:"id"`
				Title string         `json:"title"`
				Body  string         `json:"body"`
				Data  map[string]any `json:"data"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			delivered := onNotify != nil && onNotify(req.ID, req.Title, req.Body, req.Data)
			_ = json.NewEncoder(w).Encode(map[string]any{"delivered": delivered})
			return
		}
		if r.URL.Path == "/_byspace/desktop/window" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			var req struct {
				Action string `json:"action"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			response := map[string]any{"accepted": true}
			if onWindowAction != nil {
				if result := onWindowAction(req.Action); result != nil {
					response = result
				}
			}
			_ = json.NewEncoder(w).Encode(response)
			return
		}
		if r.URL.Path == "/_byspace/desktop/settings" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			switch r.Method {
			case http.MethodGet:
				_ = json.NewEncoder(w).Encode(buildDesktopStatusPayload(homeDir, sup, updater))
				return
			case http.MethodPost:
				current := LoadDesktopSettings(homeDir)
				var patch struct {
					KeepAwake        *string   `json:"keepAwake"`
					DockMode         *string   `json:"dockMode"`
					HideFromDock     *bool     `json:"hideFromDock"`
					OpenAtLogin      *bool     `json:"openAtLogin"`
					Lightweight      *bool     `json:"lightweight"`
					NoAutoUpdate     *bool     `json:"noAutoUpdate"`
					UpdateEvery      *int      `json:"updateEvery"`
					NoAutoDownload   *bool     `json:"noAutoDownload"`
					AutoRestart      *bool     `json:"autoRestart"`
					LinkCLI          bool      `json:"linkCLI"`
					AddCLIToPath     bool      `json:"addCLIToPath"`
					OpenConfigFolder bool      `json:"openConfigFolder"`
					CheckForUpdates  bool      `json:"checkForUpdates"`
					DownloadUpdate   bool      `json:"downloadUpdate"`
					RestartToUpdate  bool      `json:"restartToUpdate"`
					TakeOverDaemon   bool      `json:"takeOverDaemon"`
					CreateBackup     bool      `json:"createBackup"`
					TitleBarColor    *[3]uint8 `json:"titleBarColor"`
					TitleBarDark     *bool     `json:"titleBarDark"`
				}
				if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if patch.KeepAwake != nil {
					current.KeepAwake = string(awake.NormalizeLevel(*patch.KeepAwake))
					awake.Notify()
				}
				if patch.DockMode != nil {
					current.DockMode = *patch.DockMode
					current.HideFromDock = (*patch.DockMode != "show")
				} else if patch.HideFromDock != nil {
					current.HideFromDock = *patch.HideFromDock
					if *patch.HideFromDock {
						current.DockMode = "window"
					} else {
						current.DockMode = "show"
					}
				}
				if patch.Lightweight != nil {
					current.Lightweight = *patch.Lightweight
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
				if patch.TitleBarColor != nil {
					c := *patch.TitleBarColor
					current.TitleBarColor = &c
					if patch.TitleBarDark != nil {
						current.TitleBarDark = *patch.TitleBarDark
					}
					if onTintTitleBar != nil {
						onTintTitleBar(c, current.TitleBarDark)
					}
				}
				if err := SaveDesktopSettings(homeDir, current); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if patch.OpenAtLogin != nil {
					_ = autostart.Set(*patch.OpenAtLogin)
				}
				if (patch.DockMode != nil || patch.HideFromDock != nil) && onDockChanged != nil {
					onDockChanged(current)
				}
				if patch.LinkCLI || patch.AddCLIToPath {
					_, _ = selfupdate.AddCLIToPath()
				}
				if patch.OpenConfigFolder && onOpenConfigFolder != nil {
					go onOpenConfigFolder()
				}
				if patch.TakeOverDaemon && sup != nil {
					sup.TakeOver()
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
				_ = json.NewEncoder(w).Encode(buildDesktopStatusPayload(homeDir, sup, updater))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
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

// Run launches the Wails v3 native application.
func Run(version string, showMain bool, initialLink string) error {
	isAndroid := runtime.GOOS == "android"
	homeDir, _ := home.Resolve("")
	if !isAndroid {
		webkitDefaults()
		selfupdate.AwaitPredecessor()
		if acquireOrHandOverGUILock(homeDir, showMain, initialLink) {
			return nil
		}
		if logFile := setupDesktopLogFile(homeDir); logFile != nil {
			defer logFile.Close()
		}
		log.Printf("byspace desktop %s starting (os=%s arch=%s home=%s)", version, runtime.GOOS, runtime.GOARCH, homeDir)
		selfupdate.EnsureAppCLISymlink(false)
		_ = autostart.Refresh()
	}

	bgCtx, cancelBg := context.WithCancel(context.Background())
	defer cancelBg()

	var sup *DaemonSupervisor
	var assetHandler http.Handler
	updater := &ClientUpdater{
		Version: version,
		HomeDir: homeDir,
	}

	var app *application.App
	var quitting atomic.Bool
	var appStarted atomic.Bool
	// mainWin is read and mutated exclusively on the main UI thread (via InvokeAsync / InvokeSync)
	// so it never deadlocks with Wails' main-thread tray/window callbacks (mirroring magpie's
	// lightweight.go invariant: "never hold a lock on the main thread around InvokeSync").
	var mainWin *application.WebviewWindow
	var showMainWindow func(targetURL string)
	// A clicked notification brings the window forward and opens what it is about; a window the
	// lightweight mode released loads that route directly.
	notifier := newDesktopNotifier(func(data map[string]any) {
		route, _ := data["route"].(string)
		application.InvokeAsync(func() {
			if mainWin == nil {
				go showMainWindow(route)
				return
			}
			mainWin.Show().Focus()
			mainWin.ExecJS(notificationClickScript(data))
		})
	})
	var releasedWin atomic.Pointer[application.WebviewWindow]

	syncDockPolicy := func(s DesktopSettings, front bool) {
		if runtime.GOOS != "darwin" || !appStarted.Load() {
			return
		}
		shown, full := false, false
		if mainWin != nil {
			shown = mainWin.IsVisible()
			full = mainWin.IsFullscreen()
		}
		setDock(ShouldShowInDock(s, shown, full), front)
	}

	webDir := strings.TrimSpace(os.Getenv("BYSPACE_WEB_DIR"))
	baseUI := webui.NewHandler(webDir).WithoutPrecompression()
	if baseUI == nil {
		baseUI = webui.NewHandler("").WithoutPrecompression()
	}

	if isAndroid {
		if baseUI != nil {
			assetHandler = baseUI
		} else {
			assetHandler = http.NotFoundHandler()
		}
	} else {
		sup = &DaemonSupervisor{
			Addr:    ResolveDesktopDaemonAddr(),
			HomeDir: homeDir,
			Version: version,
		}
		localToken := server.EnsureCLICredential(homeDir)
		localHostname, _ := os.Hostname()
		var uiHandler http.Handler = http.NotFoundHandler()
		if baseUI != nil {
			uiHandler = baseUI.
				WithExplicitConnectionHint(sup.Addr, localHostname).
				WithLocalCredential(localToken)
		}
		assetHandler = withDesktopSettingsAPI(
			uiHandler,
			homeDir,
			sup,
			updater,
			func(s DesktopSettings) {
				syncDockPolicy(s, true)
			},
			func(rgb [3]uint8, dark bool) {
				application.InvokeAsync(func() {
					if mainWin != nil {
						tintWindowsTitleBar(mainWin, rgb, dark)
					}
				})
			},
			func(action string) map[string]any {
				result := make(chan map[string]any, 1)
				application.InvokeAsync(func() {
					defer close(result)
					if mainWin == nil {
						return
					}
					if action == "query" {
						result <- map[string]any{"maximized": mainWin.IsMaximised()}
						return
					}
					switch action {
					case "minimize":
						mainWin.Minimise()
					case "maximize":
						if mainWin.IsMaximised() {
							mainWin.UnMaximise()
						} else {
							mainWin.Maximise()
						}
					case "close":
						// Same hide-to-tray semantics as the WindowClosing hook.
						mainWin.Hide()
						s := LoadDesktopSettings(homeDir)
						setDock(ShouldShowInDock(s, false, false), false)
					}
				})
				if action == "query" {
					return <-result
				}
				return nil
			},
			func() {
				_ = openFolder(app, homeDir)
			},
			func(id, title, body string, data map[string]any) bool {
				return notifier.send(id, title, body, data)
			},
			func() bool {
				return notifier.ready.Load() && notifier.authorized()
			},
		)

		// Start intelligent sleep inhibition (Keep Awake while agents work + 10m grace)
		go awake.Keep(bgCtx, func() awake.Level {
			return LoadDesktopSettings(homeDir).EffectiveKeepAwake()
		}, func() awake.State {
			if sup == nil {
				return awake.State{}
			}
			busy, last := sup.BusyState()
			return awake.State{Busy: busy, Last: last}
		})

		// Start periodic rolling backups of core $BYSPACE_HOME config files
		go backup.StartPeriodic(bgCtx, homeDir)
	}

	sum := sha256.Sum256([]byte(homeDir))
	uniqueID := "com.bytetrue.byspace." + hex.EncodeToString(sum[:6])

	makeMainWindow := func(url string, hidden bool) *application.WebviewWindow {
		if url == "" {
			url = "/"
		}
		prefs := LoadDesktopSettings(homeDir)
		width, height := 1280, 820
		if prefs.WindowWidth >= 800 && prefs.WindowHeight >= 560 {
			width, height = prefs.WindowWidth, prefs.WindowHeight
		}
		winOpts, winBg := initialWindowsChrome(prefs)
		w := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             "main",
			Title:            "BySpace",
			URL:              url,
			Width:            width,
			Height:           height,
			MinWidth:         800,
			MinHeight:        560,
			Frameless:        runtime.GOOS == "windows",
			Hidden:           hidden,
			Mac:              mainMacWindowOptions(),
			Windows:          winOpts,
			BackgroundColour: winBg,
		})

		if !isAndroid {
			var resizeTimer *time.Timer
			w.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
				if resizeTimer != nil {
					resizeTimer.Stop()
				}
				resizeTimer = time.AfterFunc(500*time.Millisecond, func() {
					application.InvokeAsync(func() {
						if w.IsFullscreen() || w.IsMinimised() {
							return
						}
						wd, ht := w.Size()
						if wd >= 800 && ht >= 560 {
							s := LoadDesktopSettings(homeDir)
							if s.WindowWidth != wd || s.WindowHeight != ht {
								s.WindowWidth, s.WindowHeight = wd, ht
								_ = SaveDesktopSettings(homeDir, s)
							}
						}
					})
				})
			})

			w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
				if quitting.Load() || releasedWin.Load() == w {
					return
				}
				e.Cancel()
				if runtime.GOOS == "darwin" && w.IsFullscreen() {
					w.UnFullscreen()
				}
				w.Hide()
				s := LoadDesktopSettings(homeDir)
				setDock(ShouldShowInDock(s, false, false), false)
			})

			if runtime.GOOS == "windows" {
				w.OnWindowEvent(events.Windows.WindowMaximise, func(*application.WindowEvent) {
					w.EmitEvent("byspace:window-maximized", true)
				})
				w.OnWindowEvent(events.Windows.WindowRestore, func(*application.WindowEvent) {
					w.EmitEvent("byspace:window-maximized", false)
				})
				w.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(*application.WindowEvent) {
					if inPageResizeJS != "" {
						w.ExecJS(inPageResizeJS)
					}
					s := LoadDesktopSettings(homeDir)
					if s.TitleBarColor != nil {
						tintWindowsTitleBar(w, *s.TitleBarColor, s.TitleBarDark)
					}
				})
			} else if appStarted.Load() {
				configureNativeTitlebar(w)
			}
		}
		return w
	}

	showMainWindow = func(targetURL string) {
		s := LoadDesktopSettings(homeDir)
		setDock(ShouldShowInDock(s, true, false), true)
		application.InvokeAsync(func() {
			if mainWin == nil {
				mainWin = makeMainWindow(targetURL, false)
				mainWin.Show().Focus()
				return
			}
			if targetURL != "" {
				mainWin.SetURL(targetURL)
			}
			mainWin.Show().Focus()
		})
	}

	initialPrefs := LoadDesktopSettings(homeDir)
	initialActivationPolicy := application.ActivationPolicyRegular
	if !ShouldShowInDock(initialPrefs, showMain, false) {
		initialActivationPolicy = application.ActivationPolicyAccessory
	}

	app = application.New(application.Options{
		Name:        "BySpace",
		Description: "Your dev environment, in your pocket",
		Icon:        appIcon,
		Assets:      application.AssetOptions{Handler: assetHandler},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: uniqueID,
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				var link string
				var trayOnly bool
				for _, arg := range data.Args[1:] {
					if strings.HasPrefix(arg, "byspace://") || strings.HasPrefix(arg, "#offer=") {
						link = arg
					} else if arg == "tray" {
						trayOnly = true
					}
				}
				if trayOnly && link == "" {
					return
				}
				target := ""
				if link != "" {
					target = NormalizeDeepLink(link)
				}
				go showMainWindow(target)
			},
		},
		Mac: application.MacOptions{
			ActivationPolicy: initialActivationPolicy,
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
			ProgramName:                   "byspace",
		},
		OnShutdown: func() {
			quitting.Store(true)
			cancelBg()
			updater.Stop()
			closeDaemonBounded(sup)
			updater.InstallStaged()
		},
		ErrorHandler: func(err error) {
			log.Println("byspace gui:", err)
		},
	})

	// The daemon starts only now, after application.New has settled single-instance handoff. When a
	// second instance finds the lock held it hands over and calls os.Exit inside New, so a daemon
	// bound before that would have taken over port and PID lock on its way out and left the machine
	// with no daemon at all.
	if sup != nil {
		if err := sup.Start(); err != nil {
			log.Printf("byspace gui: daemon supervisor warning: %v", err)
		}
	}

	if !checkWebView2Runtime(app) {
		return nil
	}

	startURL := NormalizeDeepLink(initialLink)
	mainWin = makeMainWindow(startURL, !showMain && !isAndroid)

	if !isAndroid {
		registerDockFullscreenObserver()

		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			appStarted.Store(true)
			go notifier.start()
			if mainWin != nil {
				configureNativeTitlebar(mainWin)
			}
		})

		app.Event.RegisterApplicationEventHook(events.Mac.ApplicationShouldHandleReopen, func(e *application.ApplicationEvent) {
			go showMainWindow("")
			e.Cancel()
		})

		tray := app.SystemTray.New()
		tray.SetTooltip("BySpace")
		if runtime.GOOS == "darwin" && len(trayTemplateIcon) > 0 {
			tray.SetTemplateIcon(trayTemplateIcon)
		} else if len(trayIcon) > 0 {
			tray.SetIcon(trayIcon)
		} else if len(appIcon) > 0 {
			tray.SetIcon(appIcon)
		}

		menu := app.NewMenu()
		menu.Add("Open BySpace").OnClick(func(*application.Context) {
			go showMainWindow("")
		})
		menu.AddSeparator()
		menu.Add("BySpace " + version).SetEnabled(false)
		if sup != nil {
			menu.Add("Daemon: " + sup.Addr).SetEnabled(false)
		}
		downloadItem := menu.Add("Download update").SetHidden(true)
		downloadItem.OnClick(func(*application.Context) {
			downloadItem.SetLabel("Downloading update…")
			downloadItem.SetEnabled(false)
			menu.Update()
			updater.DownloadFound()
		})
		triggerRelaunch := func() {
			shown := application.InvokeSyncWithResult(func() bool {
				return mainWin != nil && mainWin.IsVisible()
			})
			if !updater.InstallAndRelaunch(shown) {
				return
			}
			quitting.Store(true)
			cancelBg()
			updater.Stop()
			closeDaemonBounded(sup)
			// Exit directly instead of tearing down through app.Quit. Wails closes a Windows window
			// with a synchronous SendMessage(WM_CLOSE) whose handler hands the real close to the
			// windowEvents goroutine, which then waits back on the main thread; the main thread wedged
			// in user32 also stalls ExitProcess. A wedged old process keeps holding the single-instance
			// mutex the relaunched process needs, so the update leaves a frozen window and no app.
			os.Exit(0)
		}

		restartItem := menu.Add("Restart to update").SetHidden(true)
		restartItem.OnClick(func(*application.Context) {
			go triggerRelaunch()
		})
		menu.Add("Check for Updates…").OnClick(func(*application.Context) {
			go updater.CheckNow()
		})
		menu.AddSeparator()
		menu.Add("Quit BySpace").OnClick(func(*application.Context) {
			quitting.Store(true)
			app.Quit()
		})
		tray.SetMenu(menu)
		tray.OnClick(func() {
			s := LoadDesktopSettings(homeDir)
			application.InvokeAsync(func() {
				if mainWin == nil {
					setDock(ShouldShowInDock(s, true, false), true)
					mainWin = makeMainWindow("/", false)
					mainWin.Show().Focus()
					return
				}
				if mainWin.IsVisible() {
					mainWin.Hide()
					setDock(ShouldShowInDock(s, false, false), false)
				} else {
					setDock(ShouldShowInDock(s, true, false), true)
					mainWin.Show().Focus()
				}
			})
		})

		updater.OnFound = func(newVer string) {
			application.InvokeSync(func() {
				downloadItem.SetLabel("Download update v" + newVer)
				downloadItem.SetEnabled(true)
				downloadItem.SetHidden(false)
				menu.Update()
			})
		}
		updater.OnReady = func(newVer string) {
			application.InvokeSync(func() {
				downloadItem.SetHidden(true)
				restartItem.SetLabel("Restart to update to v" + newVer)
				restartItem.SetHidden(false)
				menu.Update()
			})
		}
		updater.IsIdle = func() bool {
			agentBusy, lastBusy := false, time.Time{}
			if sup != nil {
				agentBusy, lastBusy = sup.BusyState()
			}
			focused := application.InvokeSyncWithResult(func() bool {
				return isWindowFocusedOnMain(mainWin)
			})
			return IdleAt(agentBusy, focused, lastBusy, time.Now(), IdleSettle)
		}
		updater.AutoRelaunch = triggerRelaunch

		go func() {
			var ticks int
			ticker := time.NewTicker(LightEvery)
			defer ticker.Stop()
			for {
				select {
				case <-bgCtx.Done():
					return
				case <-ticker.C:
					if quitting.Load() {
						return
					}
					on := LoadDesktopSettings(homeDir).Lightweight
					var toClose *application.WebviewWindow
					application.InvokeSync(func() {
						if mainWin == nil {
							ticks = 0
							return
						}
						shown := mainWin.IsVisible()
						var release bool
						ticks, release = LightStep(on, shown, ticks)
						if !release {
							return
						}
						ticks = 0
						w := mainWin
						dropWebView(w)
						mainWin = nil
						releasedWin.Store(w)
						toClose = w
					})
					if toClose != nil {
						log.Println("byspace lightweight: released hidden main window WebView")
						toClose.Close()
					}
				}
			}
		}()
	} else {
		updater.OnAndroidAPK = func(newVer, apkURL string) {
			application.InvokeAsync(func() {
				d := app.Dialog.Question().
					SetTitle("Update Available").
					SetMessage("BySpace v" + newVer + " is available. Download and install the update APK?")
				dlBtn := d.AddButton("Download APK")
				dlBtn.OnClick(func() {
					_ = app.Browser.OpenURL(apkURL)
				})
				d.AddButton("Later")
				d.Show()
			})
		}
	}

	updater.Start()

	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(e *application.ApplicationEvent) {
		u := strings.TrimSpace(e.Context().URL())
		if u == "" {
			return
		}
		target := NormalizeDeepLink(u)
		go showMainWindow(target)
	})

	return app.Run()
}
