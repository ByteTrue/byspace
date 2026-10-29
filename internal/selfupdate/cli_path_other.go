//go:build !windows

package selfupdate

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
)

type shellSpec struct {
	Name    string
	Path    string
	Default bool
}

func detectInstalledShells() []shellSpec {
	login := filepath.Base(os.Getenv("SHELL"))
	var out []shellSpec
	for _, name := range []string{"zsh", "bash", "fish"} {
		p, err := exec.LookPath(name)
		if err != nil || p == "" {
			continue
		}
		out = append(out, shellSpec{
			Name:    name,
			Path:    p,
			Default: login == name,
		})
	}
	if len(out) > 0 && !slices.ContainsFunc(out, func(s shellSpec) bool { return s.Default }) {
		out[0].Default = true
	}
	return out
}

func readShellPathDirs(shellPath string) []string {
	var dirs []string
	seen := map[string]bool{}
	add := func(d string) {
		d = strings.TrimSpace(d)
		if d == "" || seen[d] {
			return
		}
		seen[d] = true
		dirs = append(dirs, d)
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		localBin := filepath.Join(h, ".local", "bin")
		// Check if the shell profile already exports ~/.local/bin
		prof := cliProfilePath(filepath.Base(shellPath))
		if prof != "" {
			if raw, readErr := os.ReadFile(prof); readErr == nil && strings.Contains(string(raw), ".local/bin") {
				add(localBin)
			}
		}
	}
	for _, p := range filepath.SplitList(os.Getenv("PATH")) {
		add(p)
	}
	for _, common := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		add(common)
	}
	return dirs
}

func targetCLIDir(_ string) string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".local", "bin")
	}
	return "/usr/local/bin"
}

func cliProfilePath(shell string) string {
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return ""
	}
	switch shell {
	case "zsh":
		if z := os.Getenv("ZDOTDIR"); filepath.IsAbs(z) {
			return filepath.Join(z, ".zshrc")
		}
		return filepath.Join(h, ".zshrc")
	case "bash":
		if runtime.GOOS == "darwin" {
			return filepath.Join(h, ".bash_profile")
		}
		return filepath.Join(h, ".bashrc")
	case "fish":
		cfg := os.Getenv("XDG_CONFIG_HOME")
		if !filepath.IsAbs(cfg) {
			cfg = filepath.Join(h, ".config")
		}
		return filepath.Join(cfg, "fish", "config.fish")
	default:
		return ""
	}
}

func profileLine(shell string) string {
	if shell == "fish" {
		return "set -gx PATH $HOME/.local/bin $PATH"
	}
	return `export PATH="$HOME/.local/bin:$PATH"`
}

const profileMark = "# added by BySpace (Settings > Command line)"

func addToProfile(path, line string) error {
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if strings.Contains(string(b), ".local/bin") {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	add := "\n" + profileMark + "\n" + line + "\n"
	if len(b) > 0 && b[len(b)-1] != '\n' {
		add = "\n" + add
	}
	if _, err := f.WriteString(add); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func installCLIToUserPath(exe string) error {
	dir := targetCLIDir(exe)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	dst := filepath.Join(dir, "byspace")
	if !sameFile(dst, exe) {
		tmp := dst + ".byspace-new"
		_ = os.Remove(tmp)
		if err := os.Symlink(exe, tmp); err != nil {
			return err
		}
		if err := os.Rename(tmp, dst); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	for _, sh := range detectInstalledShells() {
		if prof := cliProfilePath(sh.Name); prof != "" {
			_ = addToProfile(prof, profileLine(sh.Name))
		}
	}
	return nil
}
