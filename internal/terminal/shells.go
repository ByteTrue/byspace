package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Shell detection, ported from shell-detect.ts.
//
// Discovery order matters: the environment's shell is the strongest signal of what this user
// actually runs, then the macOS login shell, then /etc/shells, then well-known paths. Only
// entries that exist are returned, because the picker must not offer a shell that will fail to
// spawn.

// DetectedShell is one entry for the shell picker.
type DetectedShell struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Source    string `json:"source"` // "env" | "login" | "etc-shells" | "well-known"
	IsDefault bool   `json:"isDefault"`
}

var wellKnownUnixShells = []string{
	"/bin/bash", "/bin/zsh",
	"/usr/bin/bash", "/usr/bin/zsh",
	"/usr/local/bin/bash", "/usr/local/bin/zsh", "/usr/local/bin/fish", "/usr/local/bin/nu",
	"/opt/homebrew/bin/bash", "/opt/homebrew/bin/zsh", "/opt/homebrew/bin/fish", "/opt/homebrew/bin/nu",
}

var wellKnownWindowsShells = []string{"pwsh.exe", "powershell.exe", "cmd.exe"}

// DetectInstalledShells lists usable shells, default first.
func DetectInstalledShells() []DetectedShell {
	type candidate struct {
		path   string
		source string
	}

	var candidates []candidate
	if runtime.GOOS == "windows" {
		if comspec := firstNonEmpty(os.Getenv("ComSpec"), os.Getenv("COMSPEC")); comspec != "" {
			candidates = append(candidates, candidate{comspec, "env"})
		}
		for _, sh := range wellKnownWindowsShells {
			candidates = append(candidates, candidate{sh, "well-known"})
		}
	} else {
		if sh := strings.TrimSpace(os.Getenv("SHELL")); sh != "" {
			candidates = append(candidates, candidate{sh, "env"})
		}
		if runtime.GOOS == "darwin" {
			if login := readMacLoginShell(); login != "" {
				candidates = append(candidates, candidate{login, "login"})
			}
		}
		for _, sh := range readEtcShells() {
			candidates = append(candidates, candidate{sh, "etc-shells"})
		}
		for _, sh := range wellKnownUnixShells {
			candidates = append(candidates, candidate{sh, "well-known"})
		}
	}

	seen := make(map[string]bool, len(candidates))
	out := make([]DetectedShell, 0, len(candidates))
	for _, c := range candidates {
		resolved := resolveShellPath(c.path)
		if resolved == "" || seen[resolved] {
			continue
		}
		seen[resolved] = true
		shell := DetectedShell{
			Path:   resolved,
			Name:   shellDisplayName(resolved),
			Source: c.source,
		}
		if len(out) == 0 {
			// The first surviving candidate is what "Auto" resolves to.
			shell.IsDefault = true
		}
		out = append(out, shell)
	}
	return out
}

// ResolveDefaultShell returns the shell "Auto" should launch, honouring an explicit config.
func ResolveDefaultShell(configured string) string {
	if trimmed := strings.TrimSpace(configured); trimmed != "" {
		if resolved := resolveShellPath(trimmed); resolved != "" {
			return resolved
		}
	}
	if shells := DetectInstalledShells(); len(shells) > 0 {
		return shells[0].Path
	}
	if runtime.GOOS == "windows" {
		return "cmd.exe"
	}
	return "/bin/sh"
}

// resolveShellPath returns an absolute path to an existing executable, or "".
func resolveShellPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if !strings.ContainsRune(trimmed, filepath.Separator) && runtime.GOOS != "windows" {
		// A bare name: look it up on PATH.
		if found, err := exec.LookPath(trimmed); err == nil {
			return found
		}
		return ""
	}
	if info, err := os.Stat(trimmed); err != nil || info.IsDir() {
		return ""
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		return abs
	}
	return trimmed
}

func shellDisplayName(path string) string {
	base := filepath.Base(path)
	name := strings.TrimSuffix(base, ".exe")
	if name == "" {
		return base
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

// readEtcShells parses /etc/shells, skipping comments and blanks.
func readEtcShells() []string {
	raw, err := os.ReadFile("/etc/shells")
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out = append(out, line)
	}
	return out
}

// readMacLoginShell asks dscl for the user's configured login shell.
func readMacLoginShell() string {
	user := strings.TrimSpace(os.Getenv("USER"))
	if user == "" {
		return ""
	}
	out, err := exec.Command("dscl", ".", "-read", "/Users/"+user, "UserShell").Output()
	if err != nil {
		return ""
	}
	// `UserShell: /bin/zsh`
	if _, value, ok := strings.Cut(string(out), ":"); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// SortShells orders by default first, then by name, for stable presentation.
func SortShells(shells []DetectedShell) {
	sort.SliceStable(shells, func(i, j int) bool {
		if shells[i].IsDefault != shells[j].IsDefault {
			return shells[i].IsDefault
		}
		return shells[i].Name < shells[j].Name
	})
}
