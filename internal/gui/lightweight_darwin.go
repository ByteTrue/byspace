//go:build darwin && !nogui

package gui

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static WKWebView *findWebView(NSView *v) {
	if (v == nil) return nil;
	if ([v isKindOfClass:[WKWebView class]]) return (WKWebView *)v;
	for (NSView *s in v.subviews) {
		WKWebView *w = findWebView(s);
		if (w) return w;
	}
	return nil;
}

// dropWebView detaches and tears down the window's WKWebView on the main thread before closing
// the window so macOS terminates the com.apple.WebKit.WebContent process and reclaims its memory
// (ported from magpie's lightweight_darwin.go).
static void dropWebView(void *win) {
	NSWindow *w = (NSWindow *)win;
	if (w == nil) return;
	WKWebView *web = findWebView(w.contentView);
	if (!web) return;
	if ([w respondsToSelector:@selector(setWebView:)]) {
		[w performSelector:@selector(setWebView:) withObject:nil];
	}
	[web stopLoading];
	web.navigationDelegate = nil;
	web.UIDelegate = nil;
	[web.configuration.userContentController removeAllScriptMessageHandlers];
	[web removeFromSuperview];
}

static int isWindowKeyAndAppActive(void *win) {
	NSWindow *w = (NSWindow *)win;
	if (w == nil) return 0;
	return ([NSApp isActive] && [w isVisible] && [w isKeyWindow]) ? 1 : 0;
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func dropWebView(w *application.WebviewWindow) {
	if w == nil {
		return
	}
	if p := w.NativeWindow(); p != nil {
		C.dropWebView(p)
	}
}

func isWindowFocusedOnMain(w *application.WebviewWindow) bool {
	if w == nil {
		return false
	}
	p := w.NativeWindow()
	if p == nil {
		return false
	}
	return C.isWindowKeyAndAppActive(p) != 0
}
