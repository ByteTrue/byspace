package gui

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/proc"
)

// ResolveLocalWebURL builds the http://<listenAddr>/<deepLink> URL for the local daemon's web UI.
func ResolveLocalWebURL(homeDir, initialLink string) string {
	addr := daemon.DialAddress(ResolveDesktopListenAddr(homeDir))
	return BuildLocalWebURL(addr, initialLink)
}

// BuildLocalWebURL combines a dialable host:port with an optional byspace:// or #offer= deep link.
func BuildLocalWebURL(addr, initialLink string) string {
	hostPort := strings.TrimSpace(addr)
	if hostPort == "" {
		hostPort = defaultDesktopDaemonAddr
	}
	suffix := NormalizeDeepLink(initialLink)
	if !strings.HasPrefix(suffix, "/") {
		suffix = "/" + suffix
	}
	return "http://" + hostPort + suffix
}

// OpenLocalWebApp opens the local web UI: if a browser-installed BySpace PWA exists on this
// machine (and the URL does not carry a one-time pairing fragment that requires URL navigation),
// it launches/focuses the standalone PWA window; otherwise it opens targetURL in the default browser.
func OpenLocalWebApp(targetURL string) error {
	trimmed := strings.TrimSpace(targetURL)
	if trimmed == "" {
		trimmed = "http://" + defaultDesktopDaemonAddr + "/"
	}
	hasDeepLink := strings.Contains(trimmed, "#")
	if !hasDeepLink {
		if launched := tryLaunchInstalledPWA(); launched {
			return nil
		}
	}
	return OpenDefaultBrowser(trimmed)
}

// OpenDefaultBrowser opens targetURL in the operating system's default web browser.
func OpenDefaultBrowser(targetURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = proc.Command("open", targetURL)
	case "windows":
		cmd = proc.Command("rundll32", "url.dll,FileProtocolHandler", targetURL)
	default:
		cmd = proc.Command("xdg-open", targetURL)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func tryLaunchInstalledPWA() bool {
	switch runtime.GOOS {
	case "darwin":
		userHome, err := os.UserHomeDir()
		if err != nil || userHome == "" {
			return false
		}
		appPath := FindInstalledPWAMac(userHome)
		if appPath == "" {
			return false
		}
		cmd := proc.Command("open", "-a", appPath)
		if err := cmd.Start(); err != nil {
			return false
		}
		go func() { _ = cmd.Wait() }()
		return true
	case "windows":
		lnkPath := FindInstalledPWAWindows(os.Getenv("APPDATA"))
		if lnkPath == "" {
			return false
		}
		cmd := proc.Command("rundll32", "url.dll,FileProtocolHandler", lnkPath)
		if err := cmd.Start(); err != nil {
			return false
		}
		go func() { _ = cmd.Wait() }()
		return true
	default:
		userHome, err := os.UserHomeDir()
		if err != nil || userHome == "" {
			return false
		}
		argv := FindInstalledPWALinux(userHome)
		if len(argv) == 0 {
			return false
		}
		cmd := proc.Command(argv[0], argv[1:]...)
		if err := cmd.Start(); err != nil {
			return false
		}
		go func() { _ = cmd.Wait() }()
		return true
	}
}

var macPWAMarkers = []string{
	"CrAppMode",
	"com.google.Chrome.app.",
	"com.microsoft.edgemac.app.",
	"com.brave.Browser.app.",
	"org.chromium.Chromium.app.",
	"com.vivaldi.Vivaldi.app.",
	"com.apple.Safari.WebApp",
}

// FindInstalledPWAMac searches ~/Applications (and browser Apps.localized subfolders) for a
// browser-installed BySpace Web App bundle, excluding the native com.bytetrue.byspace bundle.
func FindInstalledPWAMac(userHomeDir string) string {
	if strings.TrimSpace(userHomeDir) == "" {
		return ""
	}
	appsRoot := filepath.Join(userHomeDir, "Applications")
	candidates := []string{
		filepath.Join(appsRoot, "Chrome Apps.localized", "BySpace.app"),
		filepath.Join(appsRoot, "Edge Apps.localized", "BySpace.app"),
		filepath.Join(appsRoot, "Brave Browser Apps.localized", "BySpace.app"),
		filepath.Join(appsRoot, "Vivaldi Apps.localized", "BySpace.app"),
		filepath.Join(appsRoot, "BySpace.app"),
	}
	if entries, err := os.ReadDir(appsRoot); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(name, ".localized") {
				candidates = append(candidates, filepath.Join(appsRoot, name, "BySpace.app"))
			}
		}
	}
	seen := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		if seen[candidate] {
			continue
		}
		seen[candidate] = true
		if isMacPWABundle(candidate) {
			return candidate
		}
	}
	return ""
}

func isMacPWABundle(bundlePath string) bool {
	plistBytes, err := os.ReadFile(filepath.Join(bundlePath, "Contents", "Info.plist"))
	if err != nil || len(plistBytes) == 0 {
		return false
	}
	if bytes.Contains(plistBytes, []byte("com.bytetrue.byspace")) {
		return false
	}
	for _, marker := range macPWAMarkers {
		if bytes.Contains(plistBytes, []byte(marker)) {
			return true
		}
	}
	return false
}

// FindInstalledPWAWindows searches the user's Start Menu Programs directory for a browser-created
// BySpace.lnk PWA shortcut containing --app-id=.
func FindInstalledPWAWindows(appDataDir string) string {
	if strings.TrimSpace(appDataDir) == "" {
		return ""
	}
	programsRoot := filepath.Join(appDataDir, "Microsoft", "Windows", "Start Menu", "Programs")
	candidates := []string{
		filepath.Join(programsRoot, "Chrome Apps", "BySpace.lnk"),
		filepath.Join(programsRoot, "Edge Apps", "BySpace.lnk"),
		filepath.Join(programsRoot, "Brave Apps", "BySpace.lnk"),
		filepath.Join(programsRoot, "BySpace.lnk"),
	}
	for _, candidate := range candidates {
		if isWindowsPWAShortcut(candidate) {
			return candidate
		}
	}
	return ""
}

func isWindowsPWAShortcut(lnkPath string) bool {
	data, err := os.ReadFile(lnkPath)
	if err != nil || len(data) == 0 {
		return false
	}
	return bytes.Contains(data, []byte("--app-id=")) || bytes.Contains(data, asciiToUTF16LE("--app-id="))
}

func asciiToUTF16LE(s string) []byte {
	out := make([]byte, len(s)*2)
	for i := 0; i < len(s); i++ {
		out[i*2] = s[i]
		out[i*2+1] = 0
	}
	return out
}

// FindInstalledPWALinux searches ~/.local/share/applications for a browser-installed BySpace
// .desktop file containing Name=BySpace and --app-id=, returning its parsed Exec argv.
func FindInstalledPWALinux(userHomeDir string) []string {
	if strings.TrimSpace(userHomeDir) == "" {
		return nil
	}
	appsDir := filepath.Join(userHomeDir, ".local", "share", "applications")
	entries, err := os.ReadDir(appsDir)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".desktop") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(appsDir, entry.Name()))
		if err != nil {
			continue
		}
		if argv := parseLinuxPWADesktopFile(string(raw)); len(argv) > 0 {
			return argv
		}
	}
	return nil
}

func parseLinuxPWADesktopFile(content string) []string {
	hasBySpaceName := false
	var execLine string
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		if line == "Name=BySpace" {
			hasBySpaceName = true
		} else if strings.HasPrefix(line, "Exec=") && strings.Contains(line, "--app-id=") {
			execLine = strings.TrimSpace(strings.TrimPrefix(line, "Exec="))
		}
	}
	if !hasBySpaceName || execLine == "" {
		return nil
	}
	fields := splitDesktopExecArgs(execLine)
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if strings.HasPrefix(f, "%") && len(f) == 2 {
			continue
		}
		out = append(out, f)
	}
	return out
}

func splitDesktopExecArgs(line string) []string {
	var args []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '"':
			inQuote = !inQuote
		case (ch == ' ' || ch == '\t') && !inQuote:
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteByte(ch)
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}
