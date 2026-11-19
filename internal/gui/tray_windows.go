//go:build windows

package gui

import (
	"os"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmUserTray = 0x0400 + 1
	wmClose    = 0x0010
	wmDestroy  = 0x0002
	wmCommand  = 0x0111
	wmLBtnUp   = 0x0202
	wmRBtnUp   = 0x0205

	nimAdd    = 0x00000000
	nimModify = 0x00000001
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	mfString    = 0x00000000
	mfGrayed    = 0x00000001
	mfDisabled  = 0x00000002
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100
	tpmNonotify    = 0x0080

	cmdOpen     = 1001
	cmdDownload = 1002
	cmdRestart  = 1003
	cmdCheck    = 1004
	cmdQuit     = 1005
)

type notifyIconDataW struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID
	hBalloonIcon     uintptr
}

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type point struct {
	x, y int32
}

type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

var (
	user32                     = windows.NewLazySystemDLL("user32.dll")
	shell32                    = windows.NewLazySystemDLL("shell32.dll")
	kernel32                   = windows.NewLazySystemDLL("kernel32.dll")
	procRegisterClassExW       = user32.NewProc("RegisterClassExW")
	procCreateWindowExW        = user32.NewProc("CreateWindowExW")
	procDefWindowProcW         = user32.NewProc("DefWindowProcW")
	procDestroyWindow          = user32.NewProc("DestroyWindow")
	procGetMessageW            = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessageW       = user32.NewProc("DispatchMessageW")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procAppendMenuW            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procCreateIconFromResource = user32.NewProc("CreateIconFromResourceEx")
	procLoadIconW              = user32.NewProc("LoadIconW")
	procShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW       = kernel32.NewProc("GetModuleHandleW")

	winTrayMu    sync.Mutex
	winTrayState trayViewState
	winTrayCB    trayCallbacks
	winTrayHWND  uintptr
	winStopChan  chan struct{}
)

func runPlatformTray(initial trayViewState, cb trayCallbacks) error {
	winTrayMu.Lock()
	winTrayState = initial
	winTrayCB = cb
	winStopChan = make(chan struct{})
	stopCh := winStopChan
	winTrayMu.Unlock()

	if os.Getenv("BYSPACE_HEADLESS_TRAY") == "1" {
		<-stopCh
		return nil
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hInst, _, _ := procGetModuleHandleW.Call(0)
	className, _ := windows.UTF16PtrFromString("BySpaceTrayWindowClass")
	wc := wndClassExW{
		cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		lpfnWndProc:   windows.NewCallback(trayWndProc),
		hInstance:     hInst,
		lpszClassName: className,
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	winName, _ := windows.UTF16PtrFromString("BySpace")
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(winName)),
		0,
		0, 0, 0, 0,
		0, 0, hInst, 0,
	)
	if hwnd == 0 {
		<-stopCh
		return nil
	}
	winTrayMu.Lock()
	winTrayHWND = hwnd
	winTrayMu.Unlock()

	hIcon := loadTrayIcon(hInst)
	var nid notifyIconDataW
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = hwnd
	nid.uID = 1
	nid.uFlags = nifMessage | nifIcon | nifTip
	nid.uCallbackMessage = wmUserTray
	nid.hIcon = hIcon
	copy(nid.szTip[:], windows.StringToUTF16("BySpace"))
	procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	defer procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))

	var m winMsg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return nil
}

func loadTrayIcon(hInst uintptr) uintptr {
	if len(trayIconPNG) > 0 {
		h, _, _ := procCreateIconFromResource.Call(
			uintptr(unsafe.Pointer(&trayIconPNG[0])),
			uintptr(len(trayIconPNG)),
			1,
			0x00030000,
			32, 32, 0,
		)
		if h != 0 {
			return h
		}
	}
	h, _, _ := procLoadIconW.Call(hInst, 1)
	if h != 0 {
		return h
	}
	h, _, _ = procLoadIconW.Call(0, 32512)
	return h
}

func trayWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmUserTray:
		switch uint32(lParam) {
		case wmLBtnUp:
			winTrayMu.Lock()
			cb := winTrayCB
			winTrayMu.Unlock()
			if cb.onOpen != nil {
				go cb.onOpen()
			}
			return 0
		case wmRBtnUp:
			showWinTrayMenu(hwnd)
			return 0
		}
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

func appendMenuItem(hMenu uintptr, flags uintptr, id uintptr, label string) {
	p, _ := windows.UTF16PtrFromString(label)
	procAppendMenuW.Call(hMenu, flags, id, uintptr(unsafe.Pointer(p)))
}

func showWinTrayMenu(hwnd uintptr) {
	winTrayMu.Lock()
	st := winTrayState
	cb := winTrayCB
	winTrayMu.Unlock()

	hMenu, _, _ := procCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hMenu)

	appendMenuItem(hMenu, mfString, cmdOpen, "Open BySpace")
	procAppendMenuW.Call(hMenu, mfSeparator, 0, 0)
	appendMenuItem(hMenu, mfString|mfGrayed|mfDisabled, 0, "Version "+st.version)
	appendMenuItem(hMenu, mfString|mfGrayed|mfDisabled, 0, st.daemonLabel)
	if st.updateAction == 1 && st.updateLabel != "" {
		appendMenuItem(hMenu, mfString, cmdDownload, st.updateLabel)
	} else if st.updateAction == 2 && st.updateLabel != "" {
		appendMenuItem(hMenu, mfString, cmdRestart, st.updateLabel)
	}
	appendMenuItem(hMenu, mfString, cmdCheck, "Check for Updates…")
	procAppendMenuW.Call(hMenu, mfSeparator, 0, 0)
	appendMenuItem(hMenu, mfString, cmdQuit, "Quit BySpace")

	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(
		hMenu,
		tpmRightButton|tpmReturnCmd|tpmNonotify,
		uintptr(pt.x),
		uintptr(pt.y),
		0,
		hwnd,
		0,
	)
	switch cmd {
	case cmdOpen:
		if cb.onOpen != nil {
			go cb.onOpen()
		}
	case cmdDownload:
		if cb.onDownload != nil {
			go cb.onDownload()
		}
	case cmdRestart:
		if cb.onRestart != nil {
			go cb.onRestart()
		}
	case cmdCheck:
		if cb.onCheck != nil {
			go cb.onCheck()
		}
	case cmdQuit:
		if cb.onQuit != nil {
			go cb.onQuit()
		}
	}
}

func updatePlatformTray(state trayViewState) {
	winTrayMu.Lock()
	winTrayState = state
	winTrayMu.Unlock()
}

func stopPlatformTray() {
	winTrayMu.Lock()
	ch := winStopChan
	winStopChan = nil
	hwnd := winTrayHWND
	winTrayHWND = 0
	winTrayMu.Unlock()
	if ch != nil {
		close(ch)
	}
	if hwnd != 0 {
		procPostMessageW.Call(hwnd, wmClose, 0, 0)
	}
}
