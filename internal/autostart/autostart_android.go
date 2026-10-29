//go:build android

package autostart

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

func record() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".termux", "boot", "byspace")
}

func enabled() bool {
	info, err := os.Stat(record())
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

func enable(exe string) error {
	p := record()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	q := "'" + strings.ReplaceAll(exe, "'", "'\\''") + "'"
	body := "#!/system/bin/sh\nexec " + q + " serve </dev/null >/dev/null 2>&1 &\n"
	return home.WriteAtomic(p, []byte(body), 0o700)
}

func disable() error {
	if err := os.Remove(record()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func refresh() error { return nil }
func heldBack() bool { return false }
