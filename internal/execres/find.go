// Package execres locates provider CLIs on PATH.
//
// Ported from executable-resolution.ts. `exec.LookPath` returns the first match on PATH, which
// is not the same as a working binary: a stale or broken install earlier in PATH shadows a good
// one later, and the daemon then reports "provider not installed" for a machine where it plainly
// is. The node implementation enumerates every candidate and probes each until one runs.
package execres

import (
	"context"
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

// Enumerate lists every PATH match for a bare command name, in PATH order, deduplicated.
func Enumerate(name string) []string {
	seen := make(map[string]bool, 4)
	out := make([]string, 0, 4)
	pathEnv := os.Getenv("PATH")
	separator := string(os.PathListSeparator)

	for _, dir := range strings.Split(pathEnv, separator) {
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

	cmd := exec.CommandContext(probeCtx, executablePath, "--version")
	// Some CLIs write version output to stderr; both streams must be drained or the process can
	// block on a full pipe before it exits.
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
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

// isExecutable reports whether a file has an executable bit.
func isExecutable(info os.FileInfo) bool {
	return info.Mode()&0o111 != 0
}

// IsCommandAvailable reports whether a working binary exists for a command.
func IsCommandAvailable(ctx context.Context, command string) bool {
	return Find(ctx, command) != ""
}
