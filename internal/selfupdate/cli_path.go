package selfupdate

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
)

// CLIShell describes whether one terminal shell can find the `byspace` command.
type CLIShell struct {
	Name    string `json:"name"`
	Default bool   `json:"default,omitempty"`
	Command string `json:"command,omitempty"`
	Ours    bool   `json:"ours"`
	Profile string `json:"profile,omitempty"`
}

// CLIStatus describes the current state of the `byspace` CLI command across user shells
// (ported from magpie's internal/update/cli_path.go).
type CLIStatus struct {
	Exe     string     `json:"exe"`
	Command string     `json:"command,omitempty"`
	Ours    bool       `json:"ours"`
	Dir     string     `json:"dir,omitempty"`
	Shells  []CLIShell `json:"shells"`
	Windows bool       `json:"windows,omitempty"`
}

var cliMu sync.Mutex

// TildePath formats path with a leading ~ when it resides under the user's home directory.
func TildePath(p string) string {
	if p == "" {
		return ""
	}
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return p
	}
	sep := string(filepath.Separator)
	if strings.EqualFold(p, h) {
		return "~"
	}
	if len(p) > len(h) && strings.EqualFold(p[:len(h)], h) && (p[len(h)] == '/' || p[len(h)] == '\\') {
		return "~" + sep + strings.TrimLeft(p[len(h):], "/\\")
	}
	return p
}

// ReadCLIStatus inspects the user's shells and reports whether `byspace` resolves to this binary.
func ReadCLIStatus() *CLIStatus {
	st := &CLIStatus{
		Windows: runtime.GOOS == "windows",
		Shells:  []CLIShell{},
	}
	exe, err := Executable()
	if err != nil || exe == "" {
		return st
	}
	st.Exe = exe
	shells := detectInstalledShells()
	for _, sh := range shells {
		dirs := readShellPathDirs(sh.Path)
		cmd := findBySpaceInDirs(dirs)
		ours := cmd != "" && (sameFile(cmd, exe) || shimRuns(cmd, exe))
		cs := CLIShell{
			Name:    sh.Name,
			Default: sh.Default,
			Command: TildePath(cmd),
			Ours:    ours,
			Profile: TildePath(cliProfilePath(sh.Name)),
		}
		if sh.Default {
			st.Command = cs.Command
			st.Ours = ours
		}
		st.Shells = append(st.Shells, cs)
	}
	if len(st.Shells) > 0 && !slices.ContainsFunc(st.Shells, func(s CLIShell) bool { return s.Default }) {
		st.Shells[0].Default = true
		st.Command = st.Shells[0].Command
		st.Ours = st.Shells[0].Ours
	}
	if !st.Ours && slices.ContainsFunc(st.Shells, func(s CLIShell) bool { return !s.Ours }) {
		st.Dir = TildePath(targetCLIDir(exe))
	}
	return st
}

// AddCLIToPath installs or links this binary onto the user's PATH across shells.
func AddCLIToPath() (*CLIStatus, error) {
	cliMu.Lock()
	defer cliMu.Unlock()

	exe, err := Executable()
	if err != nil || exe == "" {
		return nil, fmt.Errorf("could not determine running executable: %w", err)
	}
	if err := installCLIToUserPath(exe); err != nil {
		return nil, err
	}
	return ReadCLIStatus(), nil
}

func cliNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"byspace.com", "byspace.exe", "byspace.cmd", "byspace.bat"}
	}
	return []string{"byspace"}
}

func findBySpaceInDirs(dirs []string) string {
	for _, d := range dirs {
		d = strings.TrimSpace(d)
		if d == "" || !filepath.IsAbs(d) {
			continue
		}
		for _, n := range cliNames() {
			p := filepath.Join(d, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() && (runtime.GOOS == "windows" || st.Mode()&0o111 != 0) {
				return p
			}
		}
	}
	return ""
}

func sameFile(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	sa, err := os.Stat(a)
	if err != nil {
		return false
	}
	sb, err := os.Stat(b)
	return err == nil && os.SameFile(sa, sb)
}

const shimName = "byspace.cmd"

func shimText(exe string) string {
	name := filepath.Base(strings.ReplaceAll(exe, `\`, "/"))
	return "@echo off\r\nrem added by BySpace (Settings > Command line): runs " + name + " in this folder\r\n\"%~dp0" + name + "\" %*\r\n"
}

func needsShim(exe string) bool {
	return !strings.EqualFold(filepath.Base(strings.ReplaceAll(exe, `\`, "/")), "byspace.exe")
}

func writeShim(exe string) (string, error) {
	if !needsShim(exe) {
		return "", nil
	}
	p := filepath.Join(filepath.Dir(exe), shimName)
	want := shimText(exe)
	if b, err := os.ReadFile(p); err == nil && string(b) == want {
		return p, nil
	}
	if err := os.WriteFile(p, []byte(want), 0o755); err != nil {
		return "", fmt.Errorf("writing %s: %w", p, err)
	}
	return p, nil
}

func shimRuns(cmd, exe string) bool {
	if !strings.EqualFold(filepath.Base(cmd), shimName) || !strings.EqualFold(filepath.Dir(cmd), filepath.Dir(exe)) {
		return false
	}
	b, err := os.ReadFile(cmd)
	return err == nil && string(b) == shimText(exe)
}

func pathFirst(v, dir string) string {
	same := func(d string) bool {
		return strings.EqualFold(strings.TrimRight(strings.TrimSpace(d), `\`), strings.TrimRight(dir, `\`))
	}
	out := []string{dir}
	for _, d := range strings.Split(v, ";") {
		if strings.TrimSpace(d) != "" && !same(d) {
			out = append(out, d)
		}
	}
	return strings.Join(out, ";")
}
