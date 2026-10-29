//go:build windows

package selfupdate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

type shellSpec struct {
	Name    string
	Path    string
	Default bool
}

func detectInstalledShells() []shellSpec {
	return []shellSpec{
		{Name: "PowerShell", Default: true},
		{Name: "cmd", Default: false},
	}
}

func readShellPathDirs(_ string) []string {
	var dirs []string
	seen := map[string]bool{}
	add := func(raw string) {
		for _, p := range strings.Split(raw, ";") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			expanded, err := registry.ExpandString(p)
			if err == nil && expanded != "" {
				p = expanded
			}
			key := strings.ToLower(strings.TrimRight(p, `\`))
			if !seen[key] {
				seen[key] = true
				dirs = append(dirs, p)
			}
		}
	}
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE); err == nil {
		if v, _, valErr := k.GetStringValue("Path"); valErr == nil {
			add(v)
		}
		_ = k.Close()
	}
	add(os.Getenv("PATH"))
	return dirs
}

func targetCLIDir(exe string) string {
	return filepath.Dir(exe)
}

func cliProfilePath(_ string) string { return "" }

func installCLIToUserPath(exe string) error {
	dir := filepath.Dir(exe)
	if _, err := writeShim(exe); err != nil {
		return err
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	v, typ, err := k.GetStringValue("Path")
	if err != nil && err != registry.ErrNotExist {
		return err
	}
	nv := pathFirst(v, dir)
	if nv != v {
		if err == registry.ErrNotExist || typ == registry.EXPAND_SZ {
			err = k.SetExpandStringValue("Path", nv)
		} else {
			err = k.SetStringValue("Path", nv)
		}
		if err != nil {
			return fmt.Errorf("adding %s to your PATH: %w", dir, err)
		}
	}
	_ = os.Setenv("PATH", dir+";"+os.Getenv("PATH"))
	broadcastSettingChanged()
	return nil
}

func broadcastSettingChanged() {
	const hwndBroadcast, wmSettingChange, smtoAbortIfHung = 0xffff, 0x001A, 0x0002
	env, _ := windows.UTF16PtrFromString("Environment")
	var res uintptr
	_, _, _ = windows.NewLazySystemDLL("user32.dll").NewProc("SendMessageTimeoutW").Call(
		hwndBroadcast, wmSettingChange, 0, uintptr(unsafe.Pointer(env)), smtoAbortIfHung, 5000, uintptr(unsafe.Pointer(&res)))
}
