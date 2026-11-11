// Package execres locates provider CLIs on PATH.
//
// Ported from executable-resolution.ts. `exec.LookPath` returns the first match on PATH, which
// is not the same as a working binary: a stale or broken install earlier in PATH shadows a good
// one later, and the daemon then reports "provider not installed" for a machine where it plainly
// is. The node implementation enumerates every candidate and probes each until one runs.
package execres

import (
	"context"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/proc"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ProbeTimeout bounds one `--version` probe. A hung binary must not block provider discovery.
const ProbeTimeout = 2 * time.Second

// Find returns the first working candidate for a command, or "".
//
// A name containing a path separator is used literally (and probed). A bare name is looked up
// across PATH, probing each match in order.
func Find(ctx context.Context, name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	if strings.ContainsAny(trimmed, `/\`) {
		if Probe(ctx, trimmed) {
			return trimmed
		}
		return ""
	}
	for _, candidate := range Enumerate(trimmed) {
		if Probe(ctx, candidate) {
			return candidate
		}
	}
	return ""
}

// StandardDirs returns conventional install locations, after the process PATH.
// These are lookup candidates, not an instruction to run a login shell.
//
// Pi 1.5.1+ ships a managed install whose launcher lives under ~/.pi and is not added to the
// desktop app's PATH. Both spellings are listed: the managed install writes `agent`, and the
// standalone installer has used `agents`.
func StandardDirs() []string {
	home, _ := os.UserHomeDir()
	dirs := make([]string, 0, 5)
	if home != "" {
		dirs = append(dirs,
			filepath.Join(home, ".pi", "agent", "bin"),
			filepath.Join(home, ".pi", "agents", "bin"),
		)
	}
	if runtime.GOOS == "windows" {
		return dirs
	}
	dirs = append(dirs, "/usr/local/bin")
	if home != "" {
		dirs = append(dirs, filepath.Join(home, ".local", "bin"))
	}
	return append(dirs, "/opt/homebrew/bin")
}

// AppendStandardDirs adds the same executable locations to a provider subprocess's PATH.
// A JS CLI's `#!/usr/bin/env node` needs this even after the CLI itself was resolved absolutely.
// Keep it scoped to provider children rather than changing the daemon's own environment.
func AppendStandardDirs(env []string) []string {
	if len(env) == 0 {
		env = os.Environ()
	}
	dirs := StandardDirs()
	if len(dirs) == 0 {
		return env
	}
	out := append([]string(nil), env...)
	pathIndex := -1
	pathKey := "PATH"
	existing := ""
	for i, entry := range out {
		if key, value, ok := strings.Cut(entry, "="); ok && strings.EqualFold(key, "PATH") {
			pathIndex = i
			pathKey = key
			existing = value
			break
		}
	}
	seen := make(map[string]bool)
	for _, dir := range strings.Split(existing, string(os.PathListSeparator)) {
		seen[dir] = true
	}
	for _, dir := range dirs {
		if !seen[dir] {
			if existing != "" {
				existing += string(os.PathListSeparator)
			}
			existing += dir
			seen[dir] = true
		}
	}
	if pathIndex >= 0 {
		// Keep the spelling the caller's block already uses. Appending a second `PATH` beside a
		// Windows `Path` entry is how a child ended up with only the directories added here.
		out[pathIndex] = pathKey + "=" + existing
	} else {
		out = append(out, "PATH="+existing)
	}
	return out
}

// Enumerate lists every PATH match for a bare command name, in search order, deduplicated.
// Desktop apps start with the OS PATH rather than the user's shell PATH. Look in the standard
// Unix install locations as well, without changing the daemon's environment.
func Enumerate(name string) []string {
	dirs := append(strings.Split(os.Getenv("PATH"), string(os.PathListSeparator)), StandardDirs()...)
	return enumerate(name, dirs)
}

func enumerate(name string, dirs []string) []string {
	seen := make(map[string]bool, 4)
	out := make([]string, 0, 4)

	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, name)
		if runtime.GOOS == "windows" && filepath.Ext(candidate) == "" {
			// Windows resolves executables by extension; PATHEXT decides which.
			if resolved := resolveWindowsCandidate(candidate); resolved != "" {
				candidate = resolved
			}
		}
		if seen[candidate] {
			continue
		}
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			continue
		}
		// A non-executable file on PATH is not a candidate; on Windows the extension decides
		// and the platform check handles it.
		if !isExecutable(info) {
			continue
		}
		seen[candidate] = true
		out = append(out, candidate)
	}
	return out
}

// Probe reports whether a binary actually runs.
//
// `--version` is the least common denominator: every provider CLI accepts it. The output is
// discarded — only the successful exit matters.
func Probe(ctx context.Context, executablePath string) bool {
	if strings.TrimSpace(executablePath) == "" {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, ProbeTimeout)
	defer cancel()

	cmd := proc.CommandContext(probeCtx, executablePath, "--version")
	// Some CLIs write version output to stderr; both streams must be drained or the process can
	// block on a full pipe before it exits.
	cmd.Stdout = nil
	cmd.Stderr = nil
	err := cmd.Run()
	if err == nil {
		return true
	}

	// The question is "does this binary run", not "does --version exit 0". Node's
	// classifyProbeError answers it the same way: a process that started and exited non-zero is
	// available, and one killed for exceeding the timeout is available too (slow, not absent).
	// Only a failure to start counts as absent — ENOENT, EACCES, ENOEXEC.
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) || probeCtx.Err() != nil {
		// Timed out: the binary exists and started, it just did not answer in time.
		return true
	}
	return false
}

// resolveWindowsCandidate appends each PATHEXT extension until one exists.
func resolveWindowsCandidate(base string) string {
	pathext := os.Getenv("PATHEXT")
	if pathext == "" {
		pathext = ".COM;.EXE;.BAT;.CMD"
	}
	for _, ext := range strings.Split(pathext, ";") {
		if strings.TrimSpace(ext) == "" {
			continue
		}
		candidate := base + strings.ToLower(ext)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

// isExecutable reports whether a file is a program.
//
// Windows has no executable bit: every regular file reports mode 0666 (or 0444 when read-only), so a
// permission check finds nothing and every provider CLI looks uninstalled. There the extension is the
// executable bit, and PATHEXT is what defines it.
func isExecutable(info os.FileInfo) bool {
	if runtime.GOOS == "windows" {
		return isWindowsExecutableExtension(filepath.Ext(info.Name()))
	}
	return info.Mode()&0o111 != 0
}

// isWindowsExecutableExtension reports whether ext is one of PATHEXT's entries.
func isWindowsExecutableExtension(ext string) bool {
	if ext == "" {
		return false
	}
	pathext := os.Getenv("PATHEXT")
	if pathext == "" {
		pathext = ".COM;.EXE;.BAT;.CMD"
	}
	for _, candidate := range strings.Split(pathext, ";") {
		if strings.EqualFold(strings.TrimSpace(candidate), ext) {
			return true
		}
	}
	return false
}

// IsCommandAvailable reports whether a working binary exists for a command.
func IsCommandAvailable(ctx context.Context, command string) bool {
	return Find(ctx, command) != ""
}

// Lookup returns the first existing executable for a command without running it.
//
// Launchers use this instead of Find: probing `--version` on every spawn would execute a provider
// once before it is launched, and a fake or slow binary on the test path would pay the probe
// timeout. A name with a path separator is returned as given, preserving a missing-file error at
// start instead of turning it into "empty command".
func Lookup(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	if strings.ContainsAny(trimmed, `/\`) {
		return trimmed
	}
	if candidates := Enumerate(trimmed); len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

// Version reports the output of `<binary> --version`, or an error when it does not run.
//
// The daemon status report shows this next to each provider's path: "(--version failed)" is the
// difference between "not installed" and "installed but broken", which need different fixes.
func Version(ctx context.Context, executablePath string) (string, error) {
	if strings.TrimSpace(executablePath) == "" {
		return "", fmt.Errorf("no executable")
	}
	probeCtx, cancel := context.WithTimeout(ctx, ProbeTimeout)
	defer cancel()

	cmd := proc.CommandContext(probeCtx, executablePath, "--version")
	var combined strings.Builder
	cmd.Stdout = &combined
	cmd.Stderr = &combined
	if err := cmd.Run(); err != nil {
		return "", err
	}
	// Only the first line: some CLIs print a changelog after the version.
	first := strings.SplitN(strings.TrimSpace(combined.String()), "\n", 2)[0]
	return strings.TrimSpace(first), nil
}

// EnumerateWindows adds the winget package directories to the PATH candidates.
//
// winget installs into %LOCALAPPDATA%\Microsoft\WinGet\Packages\<pkg>\ and does not necessarily add
// itself to PATH, so a CLI installed that way is invisible to a PATH-only lookup. Node's
// enumerateWingetPackageCandidates exists for exactly this case.
func EnumerateWindows(name string, localAppData string) []string {
	if strings.TrimSpace(localAppData) == "" {
		localAppData = os.Getenv("LOCALAPPDATA")
	}
	if strings.TrimSpace(localAppData) == "" {
		return nil
	}
	packagesDir := filepath.Join(localAppData, "Microsoft", "WinGet", "Packages")
	entries, err := os.ReadDir(packagesDir)
	if err != nil {
		return nil
	}

	exeName := name + ".exe"
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate := filepath.Join(packagesDir, entry.Name(), exeName)
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			out = append(out, candidate)
		}
	}
	return out
}
