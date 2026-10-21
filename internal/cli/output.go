package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

// Output formatting, ported from packages/cli/src/output.
//
// Three modes, because the same command is used by a person reading a terminal and by a script
// parsing the result:
//
//	--json   machine readable, stable shape
//	--yaml   machine readable, stable shape (hand-rolled below: a full YAML encoder is a large
//	         dependency for a CLI that only ever emits flat objects and arrays)
//	-q       ids only, so `byspace ls -q | xargs byspace logs` works
//
// The table is the default: column widths follow content and the terminal, because a fixed-width
// table either wastes half the screen or truncates the field the user needs.

// OutputMode is how a command renders its result.
type OutputMode int

const (
	// ModeTable is the default for a terminal.
	ModeTable OutputMode = iota
	// ModeJSON emits indented JSON.
	ModeJSON
	// ModeYAML emits YAML.
	ModeYAML
	// ModeQuiet emits one id per line.
	ModeQuiet
)

// resolveOutputMode reads the shared output flags.
func resolveOutputMode(asJSON, asYAML, quiet bool) OutputMode {
	switch {
	case asJSON:
		return ModeJSON
	case asYAML:
		return ModeYAML
	case quiet:
		return ModeQuiet
	default:
		return ModeTable
	}
}

// writeJSON emits indented JSON.
func writeJSON(w io.Writer, value any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

// writeYAML emits a minimal YAML rendering of the same data.
//
// Deliberately not a general encoder: the CLI emits maps, slices and scalars only, and pulling in
// a YAML library for that would be a dependency the daemon binary carries forever.
func writeYAML(w io.Writer, value any) error {
	return writeYAMLAt(w, value, 0)
}

func writeYAMLAt(w io.Writer, value any, indent int) error {
	pad := strings.Repeat("  ", indent)
	switch v := value.(type) {
	case nil:
		_, err := fmt.Fprintln(w, "null")
		return err
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			entry := v[key]
			if isYAMLScalar(entry) {
				if _, err := fmt.Fprintf(w, "%s%s: %s\n", pad, key, yamlScalar(entry)); err != nil {
					return err
				}
				continue
			}
			if _, err := fmt.Fprintf(w, "%s%s:\n", pad, key); err != nil {
				return err
			}
			if err := writeYAMLAt(w, entry, indent+1); err != nil {
				return err
			}
		}
		return nil
	case []any:
		for _, entry := range v {
			if isYAMLScalar(entry) {
				if _, err := fmt.Fprintf(w, "%s- %s\n", pad, yamlScalar(entry)); err != nil {
					return err
				}
				continue
			}
			if _, err := fmt.Fprintf(w, "%s-\n", pad); err != nil {
				return err
			}
			if err := writeYAMLAt(w, entry, indent+1); err != nil {
				return err
			}
		}
		return nil
	default:
		// Anything that arrived through encoding/json is already in the shapes above; a typed
		// value falls back to JSON so the output is never empty.
		raw, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		_, err = fmt.Fprintln(w, string(raw))
		return err
	}
}

func isYAMLScalar(value any) bool {
	switch value.(type) {
	case nil, string, bool, float64, int, int64:
		return true
	default:
		return false
	}
}

func yamlScalar(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		if v == "" {
			return `""`
		}
		// Quote when the value could be read as something else (or contains YAML syntax).
		if strings.ContainsAny(v, ":#\n\"'{}[]&*!|>%@`") || strings.TrimSpace(v) != v {
			encoded, _ := json.Marshal(v)
			return string(encoded)
		}
		return v
	default:
		return fmt.Sprintf("%v", v)
	}
}

// writeQuiet prints one id per line.
func writeQuiet(w io.Writer, ids []string) error {
	for _, id := range ids {
		if _, err := fmt.Fprintln(w, id); err != nil {
			return err
		}
	}
	return nil
}

// renderTable prints rows with widths derived from the content and the terminal.
//
// Fixed widths either waste the screen or truncate the field the user needs, so the last column
// absorbs the remaining space and is the only one allowed to wrap.
func renderTable(w io.Writer, header []string, rows [][]string) error {
	// Widths are measured in display cells, not bytes: a CJK character occupies two columns and
	// a three-byte UTF-8 sequence, so byte arithmetic both misaligns the table and can truncate
	// mid-character, printing a replacement glyph.
	widths := make([]int, len(header))
	for i, cell := range header {
		widths[i] = displayWidth(cell)
	}
	for _, row := range rows {
		for i, cell := range row {
			if i < len(widths) && displayWidth(cell) > widths[i] {
				widths[i] = displayWidth(cell)
			}
		}
	}

	// Cap the total at the terminal width, giving the slack to the last column.
	if total := sumInts(widths) + 2*(len(widths)-1); total > 0 {
		if limit := terminalWidth(); limit > 0 && total > limit && len(widths) > 1 {
			widths[len(widths)-1] = max(8, widths[len(widths)-1]-(total-limit))
		}
	}

	if _, err := fmt.Fprintln(w, formatRow(header, widths)); err != nil {
		return err
	}
	separator := make([]string, len(widths))
	for i := range separator {
		separator[i] = strings.Repeat("-", widths[i])
	}
	if _, err := fmt.Fprintln(w, formatRow(separator, widths)); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := fmt.Fprintln(w, formatRow(row, widths)); err != nil {
			return err
		}
	}
	return nil
}

// formatRow pads every column except the last, which is left free to wrap.
func formatRow(row []string, widths []int) string {
	var b strings.Builder
	for i, cell := range row {
		if i >= len(widths) {
			b.WriteString(cell)
			continue
		}
		if i == len(widths)-1 {
			b.WriteString(cell)
			continue
		}
		truncated, width := truncateToWidth(cell, widths[i])
		b.WriteString(truncated)
		b.WriteString(strings.Repeat(" ", widths[i]-width))
		b.WriteString("  ")
	}
	return strings.TrimRight(b.String(), " ")
}

// terminalWidth reports the usable width, or 0 when the output is not a terminal.
//
// COLUMNS first (what a shell exports), then `stty size`: asking the terminal directly needs a
// syscall wrapper that behaves differently on every platform, and the daemon binary should not
// carry a dependency for a table's column width.
func terminalWidth() int {
	if raw := strings.TrimSpace(os.Getenv("COLUMNS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return parsed
		}
	}
	cmd := exec.Command("stty", "size")
	cmd.Stdin = os.Stdin
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	// `stty size` prints "<rows> <cols>".
	fields := strings.Fields(string(out))
	if len(fields) != 2 {
		return 0
	}
	cols, err := strconv.Atoi(fields[1])
	if err != nil || cols <= 0 {
		return 0
	}
	return cols
}

func sumInts(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

// toYAMLValue round-trips a typed value through JSON so writeYAML sees only the kinds it handles.
//
// Reusing the JSON tags also means the YAML keys match the JSON keys, which is what a script
// switching between --json and --yaml expects.
func toYAMLValue(value any) any {
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var out any
	if json.Unmarshal(raw, &out) != nil {
		return value
	}
	return out
}

// displayWidth counts terminal columns, treating East Asian wide runes as two.
func displayWidth(text string) int {
	width := 0
	for _, r := range text {
		width += runeWidth(r)
	}
	return width
}

// runeWidth is the terminal column count for one rune.
//
// The ranges are the common East Asian wide/fullwidth blocks; anything else counts as one. A
// full Unicode width table would be a dependency for a table's alignment.
func runeWidth(r rune) int {
	switch {
	case r < 0x1100:
		return 1
	case r >= 0x1100 && r <= 0x115F, // Hangul Jamo
		r >= 0x2E80 && r <= 0xA4CF, // CJK radicals … Yi
		r >= 0xAC00 && r <= 0xD7A3, // Hangul syllables
		r >= 0xF900 && r <= 0xFAFF, // CJK compatibility ideographs
		r >= 0xFE30 && r <= 0xFE6F, // CJK compatibility forms
		r >= 0xFF00 && r <= 0xFF60, // fullwidth forms
		r >= 0xFFE0 && r <= 0xFFE6,
		r >= 0x1F300 && r <= 0x1F5FF, // emoji: symbols & pictographs
		r >= 0x1F600 && r <= 0x1F64F, // emoji: emoticons
		r >= 0x1F680 && r <= 0x1F6FF, // emoji: transport & map
		r >= 0x1F900 && r <= 0x1F9FF, // emoji: supplemental
		r >= 0x1FA70 && r <= 0x1FAFF, // emoji: extended-A
		r >= 0x20000 && r <= 0x3FFFD: // CJK extensions
		return 2
	default:
		return 1
	}
}

// truncateToWidth cuts text to at most `limit` columns without splitting a rune.
func truncateToWidth(text string, limit int) (string, int) {
	if limit <= 0 {
		return "", 0
	}
	width := 0
	for index, r := range text {
		next := width + runeWidth(r)
		if next > limit {
			return text[:index], width
		}
		width = next
	}
	return text, width
}
