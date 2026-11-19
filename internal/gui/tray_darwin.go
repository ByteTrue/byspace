//go:build darwin && cgo

package gui

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>
#include <stdlib.h>

extern void byspaceTrayAction(int action);
extern void byspaceTrayOpenURL(char *url);

static NSStatusItem *gStatusItem = nil;
static NSMenuItem *gVersionItem = nil;
static NSMenuItem *gDaemonItem = nil;
static NSMenuItem *gUpdateItem = nil;
static int gUpdateAction = 0;

static void handleOpen(id self, SEL _cmd, id sender) {
	byspaceTrayAction(1);
}

static void handleUpdate(id self, SEL _cmd, id sender) {
	if (gUpdateAction == 1) {
		byspaceTrayAction(2);
	} else if (gUpdateAction == 2) {
		byspaceTrayAction(3);
	}
}

static void handleCheck(id self, SEL _cmd, id sender) {
	byspaceTrayAction(4);
}

static void handleQuit(id self, SEL _cmd, id sender) {
	byspaceTrayAction(5);
}

static void handleOpenURLs(id self, SEL _cmd, NSApplication *app, NSArray<NSURL *> *urls) {
	for (NSURL *u in urls) {
		NSString *s = [u absoluteString];
		if (s != nil) {
			byspaceTrayOpenURL((char *)[s UTF8String]);
		}
	}
}

static id createTrayDelegate(void) {
	Class cls = objc_getClass("BySpaceTrayDelegate");
	if (cls == nil) {
		cls = objc_allocateClassPair([NSObject class], "BySpaceTrayDelegate", 0);
		class_addMethod(cls, @selector(onOpen:), (IMP)handleOpen, "v@:@");
		class_addMethod(cls, @selector(onUpdate:), (IMP)handleUpdate, "v@:@");
		class_addMethod(cls, @selector(onCheck:), (IMP)handleCheck, "v@:@");
		class_addMethod(cls, @selector(onQuit:), (IMP)handleQuit, "v@:@");
		class_addMethod(cls, @selector(application:openURLs:), (IMP)handleOpenURLs, "v@:@@");
		objc_registerClassPair(cls);
	}
	return [[cls alloc] init];
}

static void byspaceTrayUpdate(const char *daemonLabel, const char *updateLabel, int updateAction) {
	NSString *dStr = daemonLabel ? [NSString stringWithUTF8String:daemonLabel] : @"";
	NSString *uStr = updateLabel ? [NSString stringWithUTF8String:updateLabel] : @"";
	dispatch_async(dispatch_get_main_queue(), ^{
		if (gDaemonItem != nil && dStr != nil) {
			[gDaemonItem setTitle:dStr];
		}
		gUpdateAction = updateAction;
		if (gUpdateItem != nil) {
			if (updateAction == 0 || uStr == nil || [uStr length] == 0) {
				[gUpdateItem setHidden:YES];
			} else {
				[gUpdateItem setTitle:uStr];
				[gUpdateItem setHidden:NO];
			}
		}
	});
}

static void byspaceTrayStop(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (gStatusItem != nil) {
			[[NSStatusBar systemStatusBar] removeStatusItem:gStatusItem];
			gStatusItem = nil;
		}
		[NSApp stop:nil];
		NSEvent *ev = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
		                                 location:NSMakePoint(0, 0)
		                            modifierFlags:0
		                                timestamp:0
		                             windowNumber:0
		                                  context:nil
		                                  subtype:0
		                                    data1:0
		                                    data2:0];
		if (ev != nil) {
			[NSApp postEvent:ev atStart:YES];
		}
	});
}

static void byspaceTrayRun(const void *iconBytes, int iconLen, const char *versionLabel, const char *daemonLabel) {
	@autoreleasepool {
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

		id delegate = createTrayDelegate();
		[NSApp setDelegate:delegate];

		NSStatusItem *item = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
		gStatusItem = item;

		if (iconBytes != NULL && iconLen > 0 && item.button != nil) {
			NSData *data = [NSData dataWithBytes:iconBytes length:(NSUInteger)iconLen];
			NSImage *img = [[NSImage alloc] initWithData:data];
			if (img != nil) {
				[img setSize:NSMakeSize(18, 18)];
				[img setTemplate:YES];
				item.button.image = img;
			}
			item.button.toolTip = @"BySpace";
		}

		NSMenu *menu = [[NSMenu alloc] initWithTitle:@"BySpace"];
		[menu setAutoenablesItems:NO];

		NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"Open BySpace" action:@selector(onOpen:) keyEquivalent:@""];
		[openItem setTarget:delegate];
		[openItem setEnabled:YES];
		[menu addItem:openItem];

		[menu addItem:[NSMenuItem separatorItem]];

		NSString *vStr = versionLabel ? [NSString stringWithUTF8String:versionLabel] : @"Version dev";
		NSMenuItem *vItem = [[NSMenuItem alloc] initWithTitle:vStr action:nil keyEquivalent:@""];
		[vItem setEnabled:NO];
		[menu addItem:vItem];
		gVersionItem = vItem;

		NSString *dStr = daemonLabel ? [NSString stringWithUTF8String:daemonLabel] : @"Daemon: starting…";
		NSMenuItem *dItem = [[NSMenuItem alloc] initWithTitle:dStr action:nil keyEquivalent:@""];
		[dItem setEnabled:NO];
		[menu addItem:dItem];
		gDaemonItem = dItem;

		NSMenuItem *uItem = [[NSMenuItem alloc] initWithTitle:@"" action:@selector(onUpdate:) keyEquivalent:@""];
		[uItem setTarget:delegate];
		[uItem setEnabled:YES];
		[uItem setHidden:YES];
		[menu addItem:uItem];
		gUpdateItem = uItem;

		NSMenuItem *checkItem = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…" action:@selector(onCheck:) keyEquivalent:@""];
		[checkItem setTarget:delegate];
		[checkItem setEnabled:YES];
		[menu addItem:checkItem];

		[menu addItem:[NSMenuItem separatorItem]];

		NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"Quit BySpace" action:@selector(onQuit:) keyEquivalent:@"q"];
		[quitItem setTarget:delegate];
		[quitItem setEnabled:YES];
		[menu addItem:quitItem];

		item.menu = menu;
		[NSApp run];
	}
}
*/
import "C"

import (
	"os"
	"runtime"
	"sync"
	"unsafe"
)

var (
	darwinTrayMu   sync.Mutex
	darwinTrayCB   trayCallbacks
	darwinStopChan chan struct{}
)

func init() {
	// Lock the main goroutine to the OS main thread (m0 / pthread_main_np() == 1)
	// during package initialization before runtime.main() unlocks it, as required
	// by AppKit/Cocoa for NSStatusBar and NSApplication.
	runtime.LockOSThread()
}

//export byspaceTrayAction
func byspaceTrayAction(action C.int) {
	darwinTrayMu.Lock()
	cb := darwinTrayCB
	darwinTrayMu.Unlock()

	switch int(action) {
	case 1:
		if cb.onOpen != nil {
			go cb.onOpen()
		}
	case 2:
		if cb.onDownload != nil {
			go cb.onDownload()
		}
	case 3:
		if cb.onRestart != nil {
			go cb.onRestart()
		}
	case 4:
		if cb.onCheck != nil {
			go cb.onCheck()
		}
	case 5:
		if cb.onQuit != nil {
			go cb.onQuit()
		}
	}
}

//export byspaceTrayOpenURL
func byspaceTrayOpenURL(cURL *C.char) {
	if cURL == nil {
		return
	}
	raw := C.GoString(cURL)
	darwinTrayMu.Lock()
	cb := darwinTrayCB
	darwinTrayMu.Unlock()
	if cb.onOpenURL != nil {
		go cb.onOpenURL(raw)
	}
}

func runPlatformTray(initial trayViewState, cb trayCallbacks) error {
	darwinTrayMu.Lock()
	darwinTrayCB = cb
	darwinStopChan = make(chan struct{})
	stopCh := darwinStopChan
	darwinTrayMu.Unlock()

	if os.Getenv("BYSPACE_E2E") == "1" || os.Getenv("BYSPACE_HEADLESS_TRAY") == "1" {
		<-stopCh
		return nil
	}

	vStr := C.CString("Version " + initial.version)
	defer C.free(unsafe.Pointer(vStr))
	dStr := C.CString(initial.daemonLabel)
	defer C.free(unsafe.Pointer(dStr))

	var iconPtr unsafe.Pointer
	var iconLen C.int
	if len(trayTemplatePNG) > 0 {
		iconPtr = unsafe.Pointer(&trayTemplatePNG[0])
		iconLen = C.int(len(trayTemplatePNG))
	}
	updatePlatformTray(initial)
	C.byspaceTrayRun(iconPtr, iconLen, vStr, dStr)
	return nil
}

func updatePlatformTray(st trayViewState) {
	if os.Getenv("BYSPACE_E2E") == "1" || os.Getenv("BYSPACE_HEADLESS_TRAY") == "1" {
		return
	}
	dStr := C.CString(st.daemonLabel)
	uStr := C.CString(st.updateLabel)
	C.byspaceTrayUpdate(dStr, uStr, C.int(st.updateAction))
	C.free(unsafe.Pointer(dStr))
	C.free(unsafe.Pointer(uStr))
}

func stopPlatformTray() {
	darwinTrayMu.Lock()
	ch := darwinStopChan
	darwinTrayMu.Unlock()
	if ch != nil {
		select {
		case <-ch:
		default:
			close(ch)
		}
	}
	if os.Getenv("BYSPACE_E2E") == "1" || os.Getenv("BYSPACE_HEADLESS_TRAY") == "1" {
		return
	}
	C.byspaceTrayStop()
}
