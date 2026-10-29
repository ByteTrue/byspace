//go:build windows && !nogui

package gui

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// frameOnlyResizeJS disables Wails' in-page edge resize zone on framed Windows windows so the
// top of the page under the title bar does not turn into a vertical resize handle (ported from
// magpie's mainwindow.go).
const frameOnlyResizeJS = `(()=>{const w=window._wails;if(!w||typeof w.setResizable!=="function")return;` +
	`if(!w.setResizable.frameOnly){const f=w.setResizable;w.setResizable=()=>f(false);w.setResizable.frameOnly=true}` +
	`w.setResizable(false)})();`

// tintWindowsTitleBar paints the Windows native title bar with the page's own background color
// and flips its caption buttons/text between light and dark so the title bar blends seamlessly
// into the app surface (ported from magpie's titletint_windows.go).
func tintWindowsTitleBar(w *application.WebviewWindow, rgb [3]uint8, dark bool) bool {
	if !w32.SupportsCustomThemes() || w == nil {
		return false
	}
	application.InvokeAsync(func() {
		hwnd := uintptr(w.NativeWindow())
		if hwnd == 0 {
			return
		}
		w32.SetTheme(hwnd, dark)
		w32.SetTitleBarColour(hwnd, uint32(rgb[0])|uint32(rgb[1])<<8|uint32(rgb[2])<<16)
		w.SetBackgroundColour(application.NewRGB(rgb[0], rgb[1], rgb[2]))
	})
	return true
}

func initialWindowsChrome(s DesktopSettings) (application.WindowsWindow, application.RGBA) {
	dark := w32.IsCurrentlyDarkMode()
	if s.TitleBarColor != nil {
		dark = s.TitleBarDark
	}
	rgb := [3]uint8{0xf7, 0xf7, 0xf8}
	if dark {
		rgb = [3]uint8{0x0f, 0x0f, 0x10}
	}
	if s.TitleBarColor != nil {
		rgb = *s.TitleBarColor
	}
	col := application.NewRGBPtr(rgb[0], rgb[1], rgb[2])
	opts := application.WindowsWindow{
		Theme: application.Light,
		CustomTheme: application.ThemeSettings{
			LightModeActive:   &application.WindowTheme{TitleBarColour: col},
			LightModeInactive: &application.WindowTheme{TitleBarColour: col},
			DarkModeActive:    &application.WindowTheme{TitleBarColour: col},
			DarkModeInactive:  &application.WindowTheme{TitleBarColour: col},
		},
	}
	if dark {
		opts.Theme = application.Dark
	}
	return opts, application.NewRGB(rgb[0], rgb[1], rgb[2])
}
