//go:build darwin

package autostart

import (
	"bytes"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"

	"github.com/ByteTrue/byspace/internal/home"
)

const label = "com.bytetrue.byspace"

func record() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Library", "LaunchAgents", label+".plist")
}

var (
	ourLabel = regexp.MustCompile(`<key>Label</key>\s*<string>` + regexp.QuoteMeta(label) + `</string>`)
	program  = regexp.MustCompile(`<key>ProgramArguments</key>\s*<array><string>([^<]+)</string>`)
	bundleID = regexp.MustCompile(`<key>CFBundleIdentifier</key>\s*<string>([^<]+)</string>`)
)

func enabled() bool {
	b, err := os.ReadFile(record())
	return err == nil && ourLabel.Match(b) && program.Match(b)
}

func heldBack() bool { return false }

func enable(exe string) error {
	p := record()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return home.WriteAtomic(p, plist(exe), 0o644)
}

func plist(exe string) []byte {
	return []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>%s</string>
	<key>ProgramArguments</key>
	<array><string>%s</string><string>%s</string></array>
	<key>RunAtLoad</key><true/>
	<key>LimitLoadToSessionType</key><string>Aqua</string>
	<key>ProcessType</key><string>Interactive</string>
	<key>AbandonProcessGroup</key><true/>
%s</dict>
</plist>
`, label, html.EscapeString(exe), Arg, associated(exe)))
}

func associated(exe string) string {
	macos := filepath.Dir(exe)
	if filepath.Base(macos) != "MacOS" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(macos), "Info.plist"))
	if err != nil {
		return ""
	}
	m := bundleID.FindSubmatch(b)
	if m == nil {
		return ""
	}
	return fmt.Sprintf("\t<key>AssociatedBundleIdentifiers</key>\n\t<array><string>%s</string></array>\n",
		html.EscapeString(html.UnescapeString(string(m[1]))))
}

func refresh() error {
	p := record()
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	m := program.FindSubmatch(b)
	if m == nil {
		return nil
	}
	exe := html.UnescapeString(string(m[1]))
	if associated(exe) == "" && bytes.Contains(b, []byte("<key>AssociatedBundleIdentifiers</key>")) {
		return nil
	}
	want := plist(exe)
	if bytes.Equal(b, want) {
		return nil
	}
	return home.WriteAtomic(p, want, 0o644)
}

func disable() error {
	if err := os.Remove(record()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
