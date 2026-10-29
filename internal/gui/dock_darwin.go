//go:build darwin && !nogui

package gui

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static int appRegular(void) {
	return [NSApp activationPolicy] == NSApplicationActivationPolicyRegular ? 1 : 0;
}

static void setRegular(int on) {
	[NSApp setActivationPolicy:on ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory];
}

static void activateApp(void) {
	[NSApp activateIgnoringOtherApps:YES];
}

static void activateAgain(void) {
	NSRunningApplication *dock = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.dock"].firstObject;
	if (dock != nil) [dock activateWithOptions:0];
	[NSApp activateIgnoringOtherApps:YES];
}

static void dockOnFullscreen(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		__block BOOL again = NO;
		[[NSNotificationCenter defaultCenter] addObserverForName:NSWindowWillEnterFullScreenNotification object:nil queue:nil usingBlock:^(NSNotification *n) {
			if ([NSApp activationPolicy] == NSApplicationActivationPolicyRegular) return;
			again = [NSApp isActive];
			[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
		}];
		[[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidEnterFullScreenNotification object:nil queue:nil usingBlock:^(NSNotification *n) {
			if (!again) return;
			again = NO;
			activateAgain();
		}];
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func setDock(on, front bool) {
	application.InvokeAsync(func() {
		m := DockStep(C.appRegular() != 0, on, front)
		if !m.policy {
			return
		}
		if on {
			C.setRegular(1)
		} else {
			C.setRegular(0)
		}
		switch {
		case m.again:
			C.activateAgain()
		case m.front:
			C.activateApp()
		}
	})
}

func registerDockFullscreenObserver() {
	C.dockOnFullscreen()
}
