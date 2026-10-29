//go:build !nogui

package gui

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/selfupdate"
	"github.com/ByteTrue/byspace/internal/server"
	"github.com/ByteTrue/byspace/internal/webui"
)

//go:embed icon.png
var appIcon []byte

//go:embed tray.png
var trayIcon []byte

func withDesktopSettingsAPI(next http.Handler, homeDir string, updater *ClientUpdater) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_byspace/desktop/settings" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			switch r.Method {
			case http.MethodGet:
				st, latest := "", ""
				if updater != nil {
					st, latest = updater.State()
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"desktop":       runtime.GOOS != "android",
					"settings":      LoadDesktopSettings(homeDir),
					"updateState":   st,
					"latestVersion": latest,
				})
				return
			case http.MethodPost:
				current := LoadDesktopSettings(homeDir)
				var patch struct {
					Lightweight    *bool `json:"lightweight"`
					NoAutoUpdate   *bool `json:"noAutoUpdate"`
					NoAutoDownload *bool `json:"noAutoDownload"`
					AutoRestart    *bool `json:"autoRestart"`
				}
				if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if patch.Lightweight != nil {
					current.Lightweight = *patch.Lightweight
				}
				if patch.NoAutoUpdate != nil {
					current.NoAutoUpdate = *patch.NoAutoUpdate
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
				if updater != nil {
					if !current.NoAutoDownload {
						updater.DownloadFound()
					}
					if current.AutoRestart {
						go updater.AutoTick()
					}
				}
				st, latest := "", ""
				if updater != nil {
					st, latest = updater.State()
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"desktop":       runtime.GOOS != "android",
					"settings":      current,
					"updateState":   st,
					"latestVersion": latest,
				})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Run launches the Wails v3 native application (Desktop with tray + daemon takeover + lightweight
// mode + idle auto-update, or Android client).
func Run(version string, showMain bool, initialLink string) error {
	isAndroid := runtime.GOOS == "android"
	homeDir, _ := home.Resolve("")
	if !isAndroid {
		selfupdate.AwaitPredecessor()
		if acquireOrHandOverGUILock(homeDir, showMain, initialLink) {
			return nil
		}
	}

	var sup *DaemonSupervisor
	var assetHandler http.Handler
	updater := &ClientUpdater{
		Version: version,
		HomeDir: homeDir,
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
		if err := sup.Start(); err != nil {
			log.Printf("byspace gui: daemon supervisor warning: %v", err)
		}
		localToken := server.EnsureCLICredential(homeDir)
		var uiHandler http.Handler = http.NotFoundHandler()
		if baseUI != nil {
			uiHandler = baseUI.
				WithExplicitConnectionHint(sup.Addr, "BySpace").
				WithLocalCredential(localToken)
		}
		assetHandler = withDesktopSettingsAPI(uiHandler, homeDir, updater)
	}

	var quitting atomic.Bool
	var appStarted atomic.Bool
	var winMu sync.Mutex
	var mainWin *application.WebviewWindow
	var releasedWin atomic.Pointer[application.WebviewWindow]

	sum := sha256.Sum256([]byte(homeDir))
	uniqueID := "com.bytetrue.byspace." + hex.EncodeToString(sum[:6])

	var app *application.App

	// makeMainWindow creates (or recreates after lightweight mode released it) the main WebviewWindow.
	// Must be called on the main thread (via application.InvokeSync / InvokeAsync).
	makeMainWindow := func(url string, hidden bool) *application.WebviewWindow {
		if url == "" {
			url = "/"
		}
		prefs := LoadDesktopSettings(homeDir)
		width, height := 1280, 820
		if prefs.WindowWidth >= 800 && prefs.WindowHeight >= 560 {
			width, height = prefs.WindowWidth, prefs.WindowHeight
		}
		startHidden := hidden || runtime.GOOS == "windows"
		w := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:      "main",
			Title:     "BySpace",
			URL:       url,
			Width:     width,
			Height:    height,
			MinWidth:  800,
			MinHeight: 560,
			Hidden:    startHidden,
			Mac:       mainMacWindowOptions(),
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
			})

			if runtime.GOOS == "windows" {
				var shownOnce atomic.Bool
				w.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(*application.WindowEvent) {
					if !hidden && shownOnce.CompareAndSwap(false, true) {
						application.InvokeAsync(func() {
							w.Show().Focus()
						})
					}
				})
			} else if appStarted.Load() {
				configureNativeTitlebar(w)
			}
		}
		return w
	}

	// showMainWindow opens the main window (recreating its WebView if lightweight mode released it).
	showMainWindow := func(targetURL string) {
		winMu.Lock()
		defer winMu.Unlock()
		application.InvokeSync(func() {
			if mainWin == nil {
				mainWin = makeMainWindow(targetURL, false)
				if runtime.GOOS != "windows" {
					mainWin.Show().Focus()
				}
				return
			}
			if targetURL != "" {
				mainWin.SetURL(targetURL)
			}
			mainWin.Show().Focus()
		})
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
			ActivationPolicy: application.ActivationPolicyRegular,
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
			updater.Stop()
			if sup != nil {
				_ = sup.Close()
			}
			updater.InstallStaged()
		},
		ErrorHandler: func(err error) {
			log.Println("byspace gui:", err)
		},
	})

	startURL := NormalizeDeepLink(initialLink)
	mainWin = makeMainWindow(startURL, !showMain && !isAndroid)

	if !isAndroid {
		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			appStarted.Store(true)
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
		if len(trayIcon) > 0 {
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
		restartItem := menu.Add("Restart to update").SetHidden(true)
		restartItem.OnClick(func(*application.Context) {
			shown := application.InvokeSyncWithResult(func() bool {
				return mainWin != nil && mainWin.IsVisible()
			})
			if updater.InstallAndRelaunch(shown) {
				quitting.Store(true)
				app.Quit()
			}
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
			winMu.Lock()
			defer winMu.Unlock()
			application.InvokeSync(func() {
				if mainWin == nil {
					mainWin = makeMainWindow("/", false)
					if runtime.GOOS != "windows" {
						mainWin.Show().Focus()
					}
					return
				}
				if mainWin.IsVisible() {
					mainWin.Hide()
				} else {
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
		updater.AutoRelaunch = func() {
			shown := application.InvokeSyncWithResult(func() bool {
				return mainWin != nil && mainWin.IsVisible()
			})
			if updater.InstallAndRelaunch(shown) {
				quitting.Store(true)
				app.Quit()
			}
		}

		// Lightweight mode background loop (ported from magpie's lighten()):
		// checks every 30s and drops the hidden window's WebView after 2 consecutive hidden ticks.
		go func() {
			var ticks int
			ticker := time.NewTicker(LightEvery)
			defer ticker.Stop()
			for range ticker.C {
				if quitting.Load() {
					return
				}
				on := LoadDesktopSettings(homeDir).Lightweight
				var toClose *application.WebviewWindow
				winMu.Lock()
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
				winMu.Unlock()
				if toClose != nil {
					log.Println("byspace lightweight: released hidden main window WebView")
					toClose.Close()
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
