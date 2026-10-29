//go:build windows && !nogui

package gui

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/ByteTrue/byspace/internal/proc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// openFolder starts Explorer on path without blocking the GUI thread (ported from
// magpie's internal/gui/folder_windows.go).
func openFolder(_ *application.App, path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	cmd := proc.Command(resolveExplorerExe())
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CmdLine = fmt.Sprintf(`explorer.exe "%s"`, path)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("explorer: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func resolveExplorerExe() string {
	for _, v := range []string{"SystemRoot", "windir"} {
		if dir := os.Getenv(v); dir != "" {
			p := filepath.Join(dir, "explorer.exe")
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return "explorer.exe"
}
