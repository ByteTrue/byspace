//go:build linux && !android && !nogui

package gui

import (
	"os"
	"path/filepath"
)

// webkitDefaults disables WebKitGTK accelerated compositing before the first window is created
// when running under Wayland (where accelerated compositing flickers on click/hover) or under X11
// without an accessible DRM render node (where Mesa llvmpipe burns 400%+ CPU), ported from
// magpie's internal/gui/webkit_linux.go.
func webkitDefaults() {
	if os.Getenv("WEBKIT_DISABLE_COMPOSITING_MODE") != "" || os.Getenv("WEBKIT_DISABLE_DMABUF_RENDERER") != "" {
		return
	}
	wayland := os.Getenv("XDG_SESSION_TYPE") == "wayland" || os.Getenv("WAYLAND_DISPLAY") != ""
	if !wayland && gpuReachable() {
		return
	}
	_ = os.Setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
}

func gpuReachable() bool {
	nodes, _ := filepath.Glob("/dev/dri/renderD*")
	for _, n := range nodes {
		if f, err := os.OpenFile(n, os.O_RDWR, 0); err == nil {
			_ = f.Close()
			return true
		}
	}
	return false
}
