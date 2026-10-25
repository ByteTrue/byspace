package terminal

import "regexp"

// ansiEscapeRe matches CSI, OSC and single-character ESC sequences emitted by shells and TUIs.
var ansiEscapeRe = regexp.MustCompile(
	`\x1b\[[0-9;?]*[ -/]*[@-~]` + // CSI
		`|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)` + // OSC ... BEL / ST
		`|\x1b[@-Z\\-_]`, // single-char escapes
)

// StripAnsi removes ANSI escape sequences from a terminal line or buffer,
// leaving the printable text that `capture_terminal_request` should return.
func StripAnsi(s string) string {
	if s == "" {
		return s
	}
	return ansiEscapeRe.ReplaceAllString(s, "")
}
