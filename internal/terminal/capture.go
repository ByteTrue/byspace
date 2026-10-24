package terminal

import (
	"regexp"
	"strings"
)

// Terminal line capture, ported from terminal-capture.ts.
//
// A caller can ask for a slice of the screen ("the last 20 lines", "lines 3 to 10", "with ANSI
// codes stripped") because it is feeding the text to something that cannot render a terminal —
// an agent reading build output, a test asserting on a prompt. Returning the whole backlog and
// letting the caller slice it is not equivalent: the backlog is bytes, so a partial line at the
// boundary and a line that wrapped on screen are both wrong.

// ansiPattern matches CSI, OSC and simple two-byte escape sequences.
var ansiPattern = regexp.MustCompile(
	`\x1b\[[0-9;?]*[a-zA-Z]` + // CSI: colours, cursor movement, modes
		`|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)` + // OSC: titles, hyperlinks
		`|\x1b[()][0-9A-B]` + // charset selection
		`|\x1b[=>]`, // keypad modes
)

// StripANSI removes escape sequences from captured text.
func StripANSI(text string) string {
	return ansiPattern.ReplaceAllString(text, "")
}

// CaptureOptions selects the lines to return.
type CaptureOptions struct {
	// Start is inclusive and accepts negative values counted from the end (-1 is the last line).
	Start *int
	// End is inclusive, also accepting negatives.
	End *int
	// StripANSI removes colour and cursor sequences.
	StripANSI bool
}

// CaptureResult is the captured slice.
type CaptureResult struct {
	Lines      []string
	TotalLines int
}

// CaptureLines returns a slice of the terminal's lines.
//
// A missing start defaults to the beginning and a missing end to the last line, so the common
// "give me everything" call needs no options. Out-of-range values clamp rather than erroring: a
// caller asking for the last 100 lines of a 10-line screen wants the 10, not a failure.
func CaptureLines(allLines []string, options CaptureOptions) CaptureResult {
	total := len(allLines)
	if total == 0 {
		return CaptureResult{Lines: []string{}, TotalLines: 0}
	}

	start := resolveCaptureIndex(options.Start, total, true)
	end := resolveCaptureIndex(options.End, total, false)
	if end < start {
		// An inverted range is empty, not a crash.
		return CaptureResult{Lines: []string{}, TotalLines: total}
	}

	lines := make([]string, 0, end-start+1)
	for _, line := range allLines[start : end+1] {
		trimmed := strings.TrimRight(line, " \t")
		if options.StripANSI {
			trimmed = StripANSI(trimmed)
		}
		lines = append(lines, trimmed)
	}
	return CaptureResult{Lines: lines, TotalLines: total}
}

// resolveCaptureIndex maps a possibly-negative line number onto a slice index.
func resolveCaptureIndex(lineNumber *int, total int, isStart bool) int {
	fallback := 0
	if !isStart {
		fallback = total - 1
	}
	if lineNumber == nil {
		return fallback
	}
	value := *lineNumber
	if value < 0 {
		value = total + value
	}
	if value < 0 {
		return 0
	}
	if value >= total {
		return total - 1
	}
	return value
}
