//go:build !nogui

package gui

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// desktopNotifier shows the web UI's agent notifications as the system's own (macOS Notification
// Center, Windows toasts, freedesktop notifications on Linux). WKWebView has no web Notification
// API, so in the desktop app nothing was shown at all.
//
// The Wails service is started by hand instead of registered with the app: a service whose startup
// fails stops the app, and on macOS startup fails outside a bundle (a dev binary).
type desktopNotifier struct {
	svc     *notifications.NotificationService
	ready   atomic.Bool
	authMu  sync.Mutex
	authed  *bool
	onClick func(data map[string]any)
}

func newDesktopNotifier(onClick func(data map[string]any)) *desktopNotifier {
	n := &desktopNotifier{svc: notifications.New(), onClick: onClick}
	n.svc.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error != nil {
			log.Printf("byspace notifications: response error: %v", result.Error)
			return
		}
		n.onClick(result.Response.UserInfo)
	})
	return n
}

// start runs once the app has started (the macOS delegate needs NSApp).
func (n *desktopNotifier) start() {
	if runtime.GOOS == "darwin" && !strings.Contains(executablePath(), ".app/Contents/MacOS/") {
		log.Println("byspace notifications: not inside an app bundle; using the web fallback")
		return
	}
	// Windows needs a COM apartment on the thread that starts the service, and the apartment has
	// to outlive this call; on the other platforms this is a no-op.
	if !prepareNotificationPlatform() {
		return
	}
	if err := n.svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		log.Printf("byspace notifications: unavailable: %v", err)
		return
	}
	n.ready.Store(true)
	log.Println("byspace notifications: using the system's notifications")
	// Ask at launch, when the user is at the app, not when the first agent finishes and they
	// may be away from it.
	n.authorized()
	// Blocks on Windows (message loop for click activations).
	pumpNotificationPlatform()
}

// authorized asks once; later calls reuse the answer (the system remembers it anyway).
func (n *desktopNotifier) authorized() bool {
	n.authMu.Lock()
	defer n.authMu.Unlock()
	if n.authed != nil {
		return *n.authed
	}
	ok, err := n.svc.CheckNotificationAuthorization()
	if err == nil && !ok {
		ok, err = n.svc.RequestNotificationAuthorization()
	}
	if err != nil {
		log.Printf("byspace notifications: authorization: %v", err)
		return false
	}
	n.authed = &ok
	return ok
}

// send reports whether the system took the notification; false leaves it to the web fallback.
func (n *desktopNotifier) send(id, title, body string, data map[string]any) bool {
	if !n.ready.Load() || !n.authorized() {
		return false
	}
	err := n.svc.SendNotification(notifications.NotificationOptions{
		ID:    id,
		Title: title,
		Body:  body,
		Data:  data,
	})
	if err != nil {
		log.Printf("byspace notifications: send: %v", err)
		return false
	}
	return true
}

func executablePath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	return p
}

// notificationClickScript hands a clicked notification to the page, as a click on a web
// Notification does (WEB_NOTIFICATION_CLICK_EVENT in web/src/core/utils/os-notifications.ts).
func notificationClickScript(data map[string]any) string {
	detail, err := json.Marshal(map[string]any{"data": data})
	if err != nil {
		detail = []byte("{}")
	}
	return "window.dispatchEvent(new CustomEvent(\"byspace:web-notification-click\", {detail: " +
		string(detail) + ", cancelable: true}));"
}
