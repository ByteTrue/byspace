//go:build !darwin && !windows && !android

package autostart

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

func record() string {
	dir := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME"))
	if dir == "" {
		h, _ := os.UserHomeDir()
		dir = filepath.Join(h, ".config")
	}
	return filepath.Join(dir, "autostart", "byspace.desktop")
}

var (
	entryType = regexp.MustCompile(`(?m)^Type=Application$`)
	entryExec = regexp.MustCompile(`(?m)^Exec=\s*\S`)
)

func enabled() bool {
	b, err := os.ReadFile(record())
	return err == nil && entryType.Match(b) && entryExec.Match(b)
}

func enable(exe string) error {
	p := record()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	q := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", `$`, `\$`).Replace(exe)
	body := "[Desktop Entry]\nType=Application\nName=BySpace\nComment=Your dev environment, in your pocket\n" +
		"Exec=\"" + q + "\" " + Arg + "\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
	return home.WriteAtomic(p, []byte(body), 0o644)
}

func disable() error {
	if err := os.Remove(record()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func refresh() error { return nil }
func heldBack() bool { return false }
