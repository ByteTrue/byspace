//go:build !nogui

package gui

import (
	_ "embed"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/ByteTrue/byspace/internal/selfupdate"
	"github.com/ByteTrue/byspace/internal/webui"
)

//go:embed icon.png
var appIcon []byte

//go:embed tray.png
var trayIcon []byte

// Run launches the Wails v3 native application (Desktop with tray + daemon takeover, or Android client).
func Run(version string, showMain bool, initialLink string) error {
	isAndroid := runtime.GOOS == "android"
	if !isAndroid {
		selfupdate.AwaitPredecessor()
	}

	var sup *DaemonSupervisor
	var assetHandler http.Handler

	webDir := strings.TrimSpace(os.Getenv("BYSPACE_WEB_DIR"))
	baseUI := webui.NewHandler(webDir).WithoutPrecompression()
	if baseUI == nil {
		baseUI = webui.NewHandler("").WithoutPrecompression()
	}

	if isAndroid {
		// On Android, the app is a pure remote client shell: serve the embedded web UI in-process
		// via WebViewAssetLoader without starting a local daemon or injecting a localhost hint.
		if baseUI != nil {
			assetHandler = baseUI
		} else {
			assetHandler = http.NotFoundHandler()
		}
	} else {
		sup = &DaemonSupervisor{
			Addr:    ResolveDesktopDaemonAddr(),
			Version: version,
		}
		if err := sup.Start(); err != nil {
			log.Printf("byspace gui: daemon supervisor warning: %v", err)
		}
		if baseUI != nil {
			assetHandler = baseUI.WithExplicitConnectionHint(sup.Addr, "BySpace")
		} else {
			assetHandler = http.NotFoundHandler()
		}
	}

	var quitting atomic.Bool
	var mainWin *application.WebviewWindow
	updater := &ClientUpdater{Version: version}

	app := application.New(application.Options{
		Name:        "BySpace",
		Description: "Your dev environment, in your pocket",
		Icon:        appIcon,
		Assets:      application.AssetOptions{Handler: assetHandler},
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
			// Like Magpie: any update staged in the background is installed on the way out so the
			// next launch starts on the new version.
			updater.InstallStaged()
		},
		ErrorHandler: func(err error) {
			log.Println("byspace gui:", err)
		},
	})

	startURL := NormalizeDeepLink(initialLink)
	mainWin = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "BySpace",
		URL:       startURL,
		Width:     1280,
		Height:    820,
		MinWidth:  800,
		MinHeight: 560,
		Hidden:    !showMain && !isAndroid,
	})

	if !isAndroid {
		// Closing the desktop window hides it to the system tray so running agents stay alive.
		mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
			if quitting.Load() {
				return
			}
			e.Cancel()
			mainWin.Hide()
		})

		app.Event.RegisterApplicationEventHook(events.Mac.ApplicationShouldHandleReopen, func(e *application.ApplicationEvent) {
			application.InvokeSync(func() {
				mainWin.Show().Focus()
			})
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
			application.InvokeSync(func() {
				mainWin.Show().Focus()
			})
		})
		menu.AddSeparator()
		menu.Add("BySpace " + version).SetEnabled(false)
		if sup != nil {
			menu.Add("Daemon: " + sup.Addr).SetEnabled(false)
		}
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
			application.InvokeSync(func() {
				if mainWin.IsVisible() {
					mainWin.Hide()
				} else {
					mainWin.Show().Focus()
				}
			})
		})

		updater.OnReady = func(newVer string) {
			application.InvokeSync(func() {
				restartItem.SetLabel("Restart to update to v" + newVer)
				restartItem.SetHidden(false)
				menu.Update()
			})
		}
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
		application.InvokeAsync(func() {
			if mainWin != nil {
				mainWin.SetURL(target)
				mainWin.Show().Focus()
			}
		})
	})

	return app.Run()
}
