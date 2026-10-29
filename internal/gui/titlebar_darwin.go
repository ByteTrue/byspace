//go:build darwin && !nogui

package gui

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <crt_externs.h>
#import <mach-o/loader.h>
#import <objc/runtime.h>

static const NSWindowButton lightKinds[3] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};

// BySpaceLights keeps a window's traffic lights vertically centered in the 36pt
// sidebar/content header row and removes the empty toolbar on macOS 26 so the
// window keeps standard corner radii (ported from magpie's MagpieLights).
@interface BySpaceLights : NSObject {
@public
	NSWindow *win;
	CGFloat height;
	CGFloat x[3], top[3];
	BOOL busy, pending;
}
@end

@implementation BySpaceLights
- (void)apply {
	if (busy || win == nil || (win.styleMask & NSWindowStyleMaskFullScreen)) return;
	NSView *bar = [win standardWindowButton:NSWindowCloseButton].superview, *box = bar.superview, *frame = box.superview;
	if (frame == nil) return;
	busy = YES;
	BOOL moved = NO;
	NSRect f = box.frame;
	NSRect want = NSMakeRect(f.origin.x, frame.isFlipped ? 0 : NSHeight(frame.bounds) - height, f.size.width, height);
	if (!NSEqualRects(f, want)) {
		box.frame = want;
		moved = YES;
	}
	for (int i = 0; i < 3; i++) {
		NSButton *b = [win standardWindowButton:lightKinds[i]];
		if (b.superview != bar) continue;
		NSAutoresizingMaskOptions keepTop = bar.isFlipped ? NSViewMaxYMargin : NSViewMinYMargin;
		if (b.autoresizingMask != keepTop) b.autoresizingMask = keepTop;
		NSPoint o = NSMakePoint(x[i], bar.isFlipped ? top[i] : NSHeight(bar.bounds) - top[i] - NSHeight(b.frame));
		if (!NSEqualPoints(b.frame.origin, o)) {
			[b setFrameOrigin:o];
			moved = YES;
		}
	}
	if (moved && !frame.inLiveResize) [frame viewDidEndLiveResize];
	busy = NO;
}

- (void)later {
	if (pending) return;
	pending = YES;
	CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{
		pending = NO;
		[self apply];
	});
	CFRunLoopWakeUp(CFRunLoopGetMain());
}
- (void)changed:(NSNotification *)n {
	if (!busy) [self later];
}
- (void)resized:(NSNotification *)n {
	[self apply];
	[self later];
}
- (void)closing:(NSNotification *)n {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
	win = nil;
}
- (void)dealloc {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
	[super dealloc];
}
@end

static char lightsKey;

static NSRect sheetBelowTitlebar(id self, SEL _cmd, NSWindow *w, NSWindow *sheet, NSRect r) {
	BySpaceLights *l = objc_getAssociatedObject(w, &lightsKey);
	if (l != nil && l->win != nil && !(w.styleMask & NSWindowStyleMaskFullScreen)) r.origin.y = NSHeight(w.frame) - l->height;
	return r;
}

static NSEvent *firstPress(NSEvent *e) {
	NSWindow *w = e.window;
	BySpaceLights *l = w == nil ? nil : objc_getAssociatedObject(w, &lightsKey);
	if (l == nil || l->win == nil || w.isKeyWindow || !w.isMovable || e.clickCount != 1 || (w.styleMask & NSWindowStyleMaskFullScreen)) return e;
	NSView *frame = w.contentView.superview;
	NSPoint p = e.locationInWindow;
	if (frame == nil || !NSPointInRect(p, w.contentLayoutRect) || NSHeight(frame.bounds) - p.y >= l->height) return e;
	NSView *hit = [frame hitTest:p];
	if (hit == nil || [hit acceptsFirstMouse:e]) return e;
	[w performWindowDragWithEvent:e];
	return e;
}

static void insetLights(void *p) {
	NSWindow *w = (NSWindow *)p;
	if (w == nil || objc_getAssociatedObject(w, &lightsKey) != nil) return;
	if (w.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft) return;
	NSButton *closeBtn = [w standardWindowButton:NSWindowCloseButton];
	if (closeBtn == nil) return;
	NSView *bar = closeBtn.superview, *box = bar.superview, *frame = box.superview;
	if (frame == nil) return;
	[frame layoutSubtreeIfNeeded];
	BySpaceLights *l = [[[BySpaceLights alloc] init] autorelease];
	l->win = w;
	// Match BySpace's 36pt HEADER_INNER_HEIGHT so the traffic lights sit dead-center
	// on the same horizontal rail as the sidebar collapse toggle and BySpace menu button.
	l->height = 36.0;
	NSView *views[5] = {box, bar};
	for (int i = 0; i < 3; i++) {
		NSButton *b = [w standardWindowButton:lightKinds[i]];
		if (b == nil || b.superview != bar) return;
		l->x[i] = 13.0 + i * 20.0;
		l->top[i] = (36.0 - NSHeight(b.frame)) / 2.0;
		views[2 + i] = b;
	}
	objc_setAssociatedObject(w, &lightsKey, l, OBJC_ASSOCIATION_RETAIN);
	NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
	for (int i = 0; i < 5; i++) {
		views[i].postsFrameChangedNotifications = YES;
		[nc addObserver:l selector:@selector(changed:) name:NSViewFrameDidChangeNotification object:views[i]];
	}
	[nc addObserver:l selector:@selector(resized:) name:NSWindowDidResizeNotification object:w];
	[nc addObserver:l selector:@selector(closing:) name:NSWindowWillCloseNotification object:w];
	static BOOL watchingPresses;
	if (!watchingPresses) {
		watchingPresses = YES;
		[NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^NSEvent *(NSEvent *e) { return firstPress(e); }];
	}
	SEL s = @selector(window:willPositionSheet:usingRect:);
	id d = w.delegate;
	if (d != nil && ![d respondsToSelector:s])
		class_addMethod([d class], s, (IMP)sheetBelowTitlebar, protocol_getMethodDescription(@protocol(NSWindowDelegate), s, NO, YES).types);
	w.toolbar = nil;
	[l apply];
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func mainMacWindowOptions() application.MacWindow {
	return application.MacWindow{
		TitleBar: application.MacTitleBarHiddenInset,
		CollectionBehavior: application.MacWindowCollectionBehaviorMoveToActiveSpace |
			application.MacWindowCollectionBehaviorFullScreenPrimary,
	}
}

func configureNativeTitlebar(w *application.WebviewWindow) {
	application.InvokeSync(func() {
		if p := w.NativeWindow(); p != nil {
			C.insetLights(p)
		}
	})
}
