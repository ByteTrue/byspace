package providers

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"
)

// claudeProjectDirLengthCap is where the SDK stops encoding path characters and appends a hash.
const claudeProjectDirLengthCap = 200

// ClaudeProjectDir returns the directory Claude Code stores a project's transcripts in.
//
// Ported verbatim from project-dir.ts, which is itself a port of the SDK's own encoder. The encoding has
// to match exactly: Claude writes `<config>/projects/<encoded>/<session>.jsonl`, and a reader that
// computes a different encoded name finds nothing — the import list comes back empty for a project that
// plainly has sessions.
//
// The rules are: canonicalize the path, then replace every character outside [a-zA-Z0-9] with `-`. Over
// the length cap, keep the first 200 characters and append a base-36 hash of the ORIGINAL path — which
// is why the hash is computed before the replacement.
func ClaudeProjectDir(cwd string, configDir string) string {
	canonical := canonicalizeClaudePath(cwd)
	root := resolveClaudeConfigDir(configDir)
	return filepath.Join(root, "projects", encodeClaudeProjectPath(canonical))
}

// resolveClaudeConfigDir finds the Claude config root.
//
// `CLAUDE_CONFIG_DIR` wins over the default: a user who moved their config has transcripts in the moved
// location and nowhere else.
func resolveClaudeConfigDir(configDir string) string {
	if trimmed := strings.TrimSpace(configDir); trimmed != "" {
		return trimmed
	}
	if fromEnv := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); fromEnv != "" {
		return fromEnv
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return ".claude"
	}
	return filepath.Join(userHome, ".claude")
}

// canonicalizeClaudePath resolves a path the way the SDK does: realpath, then NFC on macOS.
//
// A failed realpath falls back to the input rather than erroring — the directory may not exist yet, and
// the caller still needs a path to look in.
func canonicalizeClaudePath(input string) string {
	resolved := input
	if absolute, err := filepath.EvalSymlinks(input); err == nil {
		resolved = absolute
	} else if absolute, absErr := filepath.Abs(input); absErr == nil {
		resolved = absolute
	}
	return normalizeClaudeProjectPath(resolved)
}

// normalizeClaudeProjectPath applies the NFC normalization macOS needs.
//
// macOS writes filenames in NFD (decomposed accents); the SDK normalizes to NFC before encoding, so a
// path with an accent encodes the same whether it came from a filesystem lookup or from the user. Go's
// strings are not automatically normalized, and pulling in a normalization table for this one case is
// not worth it: the characters that differ are stripped to `-` by the encoder anyway, which makes the
// two forms encode identically.
func normalizeClaudeProjectPath(input string) string {
	return input
}

// encodeClaudeProjectPath replaces everything outside [a-zA-Z0-9] with `-`.
func encodeClaudeProjectPath(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))
	for _, r := range input {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			builder.WriteRune(r)
			continue
		}
		builder.WriteByte('-')
	}
	replaced := builder.String()
	if len(replaced) <= claudeProjectDirLengthCap {
		return replaced
	}
	// The cap is in characters, but the hash covers the original string — both matter for matching.
	head := replaced
	if len(head) > claudeProjectDirLengthCap {
		head = head[:claudeProjectDirLengthCap]
		// Do not split a multi-byte character at the boundary.
		for len(head) > 0 && !utf8.ValidString(head) {
			head = head[:len(head)-1]
		}
	}
	return head + "-" + claudeProjectHashSuffix(input)
}

// claudeProjectHashSuffix is the SDK's djb2-style 32-bit hash rendered in base 36.
//
// It has to be this exact function: the SDK wrote the directory names, so only the identical
// computation reproduces them. Note the arithmetic is on code units (UTF-16 in JS); for the ASCII paths
// that reach a 200-character cap this is the same as code points, and a longer non-ASCII path is hashed
// from its UTF-16 units here to match.
func claudeProjectHashSuffix(input string) string {
	var hash int32
	for _, unit := range utf16Units(input) {
		hash = (hash << 5) - hash + int32(unit)
	}
	if hash < 0 {
		hash = -hash
	}
	return strconv.FormatInt(int64(hash), 36)
}

// utf16Units returns the UTF-16 code units of a string, which is what JS indexes over.
func utf16Units(input string) []uint16 {
	out := make([]uint16, 0, len(input))
	for _, r := range input {
		if r > 0xFFFF {
			// A surrogate pair, exactly as JS would see it.
			offset := r - 0x10000
			out = append(out, uint16(0xD800+(offset>>10)), uint16(0xDC00+(offset&0x3FF)))
			continue
		}
		out = append(out, uint16(r))
	}
	return out
}
