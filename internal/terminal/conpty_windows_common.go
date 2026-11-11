//go:build windows && (amd64 || arm64)

package terminal

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

var (
	conptyMu     sync.Mutex
	conptyReady  bool
	conptyLogged bool
)

// ensureConptyRuntime extracts the bundled ConPTY payload and points the PTY backend at it.
//
// The inbox ConPTY swallows the mouse-mode DECSETs a TUI writes, so the terminal never turns the
// wheel into mouse reports (microsoft/terminal#4856). The bundled OpenConsole forwards them. The
// payload goes to a cache directory named after its own bytes so two app versions cannot share a
// directory while OpenConsole is still running from it.
//
// Not a sync.Once: if extraction fails (an antivirus lock, a sharing violation while another
// process replaces the file), the next StartSession tries again instead of giving up for the whole
// daemon lifetime. Every failure falls back to the inbox implementation, which still works.
func ensureConptyRuntime() {
	conptyMu.Lock()
	defer conptyMu.Unlock()
	if conptyReady {
		return
	}
	dllBytes, consoleBytes, err := conptyPayloadFiles()
	if err != nil {
		conptyFailure(err)
		return
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		conptyFailure(err)
		return
	}
	sum := sha256.Sum256(append(append([]byte(nil), dllBytes...), consoleBytes...))
	dir := filepath.Join(cacheDir, "byspace", "conpty", hex.EncodeToString(sum[:8]))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		conptyFailure(err)
		return
	}
	dllPath := filepath.Join(dir, "conpty.dll")
	consolePath := filepath.Join(dir, "OpenConsole.exe")
	if err := writeConptyFile(dllPath, dllBytes); err != nil {
		conptyFailure(err)
		return
	}
	if err := writeConptyFile(consolePath, consoleBytes); err != nil {
		conptyFailure(err)
		return
	}
	if err := os.Setenv("BYSPACE_CONPTY_DLL", dllPath); err != nil {
		conptyFailure(err)
		return
	}
	conptyReady = true
}

// writeConptyFile replaces the file atomically. A reader must never see a half-written DLL:
// another app instance can load this path while this one is extracting.
func writeConptyFile(path string, data []byte) error {
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, data) {
		return nil
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".conpty-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return nil
}

func conptyFailure(err error) {
	if conptyLogged {
		return
	}
	conptyLogged = true
	fmt.Fprintf(os.Stderr, "conpty: bundled OpenConsole unavailable, using the inbox implementation: %v\n", err)
}
