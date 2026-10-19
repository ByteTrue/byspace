// Package daemon renders and manages user-level OS service definitions
// (macOS launchd plist and Linux systemd user unit) for `byspace serve`.
package daemon

import (
	"html"
	"os"
	"path/filepath"
	"strings"
)

const (
	ServiceName  = "byspace"
	LaunchdLabel = "com.bytetrue.byspace.serve"
	SystemdUnit  = "byspace.service"
)

var carriedEnvVars = []string{
	"PATH",
	"BYSPACE_HOME",
	"BYSPACE_LISTEN",
	"BYSPACE_RELAY_URL",
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
	"http_proxy", "https_proxy", "all_proxy", "no_proxy",
}

// CarriedEnviron collects the current process environment variables that should be
// preserved inside a launchd or systemd service definition.
func CarriedEnviron() []string {
	var out []string
	for _, k := range carriedEnvVars {
		if v, ok := os.LookupEnv(k); ok && strings.TrimSpace(v) != "" {
			out = append(out, k+"="+v)
		}
	}
	return out
}

// LaunchdPlistPath returns ~/Library/LaunchAgents/com.bytetrue.byspace.serve.plist.
func LaunchdPlistPath(userHome string) string {
	return filepath.Join(userHome, "Library", "LaunchAgents", LaunchdLabel+".plist")
}

// SystemdUnitPath returns ~/.config/systemd/user/byspace.service.
func SystemdUnitPath(userHome string) string {
	xdg := os.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		xdg = filepath.Join(userHome, ".config")
	}
	return filepath.Join(xdg, "systemd", "user", SystemdUnit)
}

// RenderLaunchdPlist generates the macOS LaunchAgent XML plist for running `byspace serve`.
func RenderLaunchdPlist(exe string, args, env []string, logFile string) string {
	s := func(v string) string { return "<string>" + html.EscapeString(v) + "</string>" }
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by byspace daemon install -->
<plist version="1.0">
<dict>
	<key>Label</key>` + s(LaunchdLabel) + `
	<key>ProgramArguments</key>
	<array>` + s(exe))
	for _, a := range args {
		b.WriteString(s(a))
	}
	b.WriteString(`</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key>
	<dict><key>SuccessfulExit</key><false/></dict>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>ProcessType</key><string>Background</string>
`)
	if logFile != "" {
		b.WriteString("\t<key>StandardOutPath</key>" + s(logFile) + "\n")
		b.WriteString("\t<key>StandardErrorPath</key>" + s(logFile) + "\n")
	}
	if len(env) > 0 {
		b.WriteString("\t<key>EnvironmentVariables</key>\n\t<dict>\n")
		for _, kv := range env {
			k, v, _ := strings.Cut(kv, "=")
			b.WriteString("\t\t<key>" + html.EscapeString(k) + "</key>" + s(v) + "\n")
		}
		b.WriteString("\t</dict>\n")
	}
	b.WriteString("</dict>\n</plist>\n")
	return b.String()
}

// RenderSystemdUnit generates the Linux systemd user unit text for running `byspace serve`.
func RenderSystemdUnit(exe string, args, env []string) string {
	var b strings.Builder
	b.WriteString("# Written by byspace daemon install\n")
	b.WriteString("[Unit]\nDescription=BySpace AI coding agent daemon\nWants=network-online.target\nAfter=network-online.target\n\n")
	b.WriteString("[Service]\nType=simple\n")
	b.WriteString("ExecStart=" + unitQuote(exe))
	for _, a := range args {
		if a == "serve" {
			b.WriteString(" serve")
		} else {
			b.WriteString(" " + unitQuote(a))
		}
	}
	b.WriteString("\nRestart=on-failure\nRestartSec=5\n")
	for _, kv := range env {
		b.WriteString("Environment=" + unitQuote(kv) + "\n")
	}
	b.WriteString("\n[Install]\nWantedBy=default.target\n")
	return b.String()
}

func unitQuote(s string) string {
	s = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "\n", " ").Replace(s)
	return `"` + s + `"`
}
