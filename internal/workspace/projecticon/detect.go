// Package projecticon finds a project's icon in its own files and validates icon bytes.
//
// Ported from utils/project-icon.ts. A project almost always ships a favicon or logo already;
// asking the user to upload one for a repository that has `public/favicon.svg` is busywork, and
// the sidebar looks unfinished until they do. The search order, the ignored directories and the
// acceptance rules (32 KB, sniffed type, square) are Node's: a different rule set picks a different
// file, so the same repository showed a different icon (or none) than it did under Node.
package projecticon

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Icon is an icon's bytes as the wire carries them.
type Icon struct {
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// IconPatterns is the search order, most specific first.
var IconPatterns = []string{
	"favicon.svg",
	"favicon.png",
	"favicon-*.svg",
	"favicon-*.png",
	"favico.svg",
	"favico.png",
	"icon.svg",
	"icon.png",
	"app-icon.svg",
	"app-icon.png",
	"apple-touch-icon.png",
	"apple-touch-icon-*.png",
	"icon-*.png",
	"android-chrome-*.png",
	"safari-pinned-tab.svg",
	"mstile-*.png",
	"logo.svg",
	"logo.png",
	"favicon.ico",
	"favico.ico",
}

// PriorityDirs are searched first, in this order: web projects keep their assets here.
var PriorityDirs = []string{"public", "static", "priv/static", "assets", "images", "img"}

// MonorepoDirs hold the actual apps (packages/app, apps/web).
var MonorepoDirs = []string{"packages", "apps"}

// IgnoredDirs are never descended into. Source and test trees are skipped too: an icon there is a
// fixture or an imported asset, not the project's.
var IgnoredDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true, ".next": true, ".nuxt": true,
	".output": true, "coverage": true, ".cache": true, "vendor": true, "src": true, "lib": true,
	"test": true, "tests": true, "__tests__": true,
}

// maxDetectedIconBytes bounds a detected icon (Node's MAX_ICON_SIZE): it travels in every icon
// response, and a large logo is not what a 16px sidebar tile needs.
const maxDetectedIconBytes = 32 * 1024

// Get finds and reads a project's own icon, or nil. Only square images up to 32 KB qualify.
func Get(projectDir string) *Icon {
	path := Find(projectDir)
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxDetectedIconBytes {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	mimeType := SniffMimeType(raw)
	if mimeType == "" {
		mimeType = mimeTypeForName(path)
	}
	if mimeType == "image/x-icon" {
		if frame := ExtractIcoPngFrame(raw); frame != nil {
			raw = frame
			mimeType = "image/png"
		}
	}
	width, height, ok := ImageDimensions(raw, mimeType)
	if !ok || width != height {
		return nil
	}
	return &Icon{Data: base64.StdEncoding.EncodeToString(raw), MimeType: mimeType}
}

// Find returns the path of the best icon for a project directory, or "".
//
// Search order: the priority directories (each searched three levels deep), then each monorepo
// package's priority directories and its own top level, then the project's top level. Nothing else
// under the root is scanned.
func Find(projectDir string) string {
	if strings.TrimSpace(projectDir) == "" {
		return ""
	}
	const maxDepth = 3
	if found := searchPriorityDirs(projectDir, maxDepth-1); found != "" {
		return found
	}
	for _, monoDir := range MonorepoDirs {
		monoPath := filepath.Join(projectDir, monoDir)
		names, err := readDirNames(monoPath)
		if err != nil {
			continue
		}
		for _, name := range names {
			packagePath := filepath.Join(monoPath, name)
			if !isDir(packagePath) {
				continue
			}
			if found := searchPriorityDirs(packagePath, maxDepth-1); found != "" {
				return found
			}
			if found := findInDir(packagePath); found != "" {
				return found
			}
		}
	}
	return findInDir(projectDir)
}

func searchPriorityDirs(base string, maxDepth int) string {
	for _, dir := range PriorityDirs {
		path := filepath.Join(base, dir)
		if !isDir(path) {
			continue
		}
		if found := searchRecursively(path, maxDepth, 0); found != "" {
			return found
		}
	}
	return ""
}

// searchRecursively checks dir, then each subdirectory in name order, down to maxDepth levels.
func searchRecursively(dir string, maxDepth, depth int) string {
	if depth > maxDepth {
		return ""
	}
	if found := findInDir(dir); found != "" {
		return found
	}
	names, err := readDirNames(dir)
	if err != nil {
		return ""
	}
	for _, name := range names {
		if IgnoredDirs[name] {
			continue
		}
		child := filepath.Join(dir, name)
		if !isDir(child) {
			continue
		}
		if found := searchRecursively(child, maxDepth, depth+1); found != "" {
			return found
		}
	}
	return ""
}

// findInDir returns the first file matching the patterns in pattern order, then name order.
func findInDir(dir string) string {
	names, err := readDirNames(dir)
	if err != nil {
		return ""
	}
	for _, pattern := range IconPatterns {
		for _, name := range names {
			if !matchesPattern(name, pattern) {
				continue
			}
			candidate := filepath.Join(dir, name)
			if isFile(candidate) {
				return candidate
			}
		}
	}
	return ""
}

var patternRegexps = map[string]*regexp.Regexp{}

func init() {
	for _, pattern := range IconPatterns {
		if strings.Contains(pattern, "*") {
			expr := strings.ReplaceAll(regexp.QuoteMeta(pattern), `\*`, ".*")
			patternRegexps[pattern] = regexp.MustCompile("^" + expr + "$")
		}
	}
}

func matchesPattern(name, pattern string) bool {
	if re, ok := patternRegexps[pattern]; ok {
		return re.MatchString(name)
	}
	return name == pattern
}

// readDirNames lists a directory's entries sorted by name, which is the order Node's readdir
// returns (libuv sorts scandir results).
func readDirNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names, nil
}

// isDir and isFile follow symlinks, as Node's stat does.
func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func mimeTypeForName(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".ico":
		return "image/x-icon"
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

var pngSignature = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

// SniffMimeType reads the type from the magic bytes, or "". Extensions lie: many favicon.ico files
// are PNG data renamed, and a client that keys off the reported type would drop them.
func SniffMimeType(b []byte) string {
	switch {
	case len(b) >= 8 && bytes.Equal(b[:8], pngSignature):
		return "image/png"
	case len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "image/jpeg"
	case len(b) >= 6 && string(b[:3]) == "GIF":
		return "image/gif"
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	case len(b) >= 6 && binary.LittleEndian.Uint16(b[0:]) == 0 && binary.LittleEndian.Uint16(b[2:]) == 1 && binary.LittleEndian.Uint16(b[4:]) > 0:
		return "image/x-icon"
	}
	return ""
}

// ExtractIcoPngFrame returns the widest PNG-encoded frame of an ICO container, or nil.
func ExtractIcoPngFrame(b []byte) []byte {
	if len(b) < 6 || binary.LittleEndian.Uint16(b[0:]) != 0 || binary.LittleEndian.Uint16(b[2:]) != 1 {
		return nil
	}
	frames := int(binary.LittleEndian.Uint16(b[4:]))
	var best []byte
	bestWidth := -1
	for i := range frames {
		entry := 6 + i*16
		if entry+16 > len(b) {
			break
		}
		width := int(b[entry])
		if width == 0 {
			width = 256
		}
		size := int(binary.LittleEndian.Uint32(b[entry+8:]))
		offset := int(binary.LittleEndian.Uint32(b[entry+12:]))
		if offset < 0 || size < 0 || offset+size > len(b) {
			continue
		}
		frame := b[offset : offset+size]
		if len(frame) >= 8 && bytes.Equal(frame[:8], pngSignature) && width > bestWidth {
			best = frame
			bestWidth = width
		}
	}
	return best
}

// ImageDimensions reads an image's size from its header. ICO and SVG are trusted to be square
// (reported as 1×1), as in Node.
func ImageDimensions(b []byte, mimeType string) (int, int, bool) {
	switch mimeType {
	case "image/png":
		if len(b) < 24 || b[0] != 0x89 || b[1] != 0x50 || b[2] != 0x4e || b[3] != 0x47 {
			return 0, 0, false
		}
		return int(binary.BigEndian.Uint32(b[16:])), int(binary.BigEndian.Uint32(b[20:])), true
	case "image/jpeg":
		return jpegDimensions(b)
	case "image/gif":
		if len(b) < 10 || b[0] != 0x47 || b[1] != 0x49 || b[2] != 0x46 {
			return 0, 0, false
		}
		return int(binary.LittleEndian.Uint16(b[6:])), int(binary.LittleEndian.Uint16(b[8:])), true
	case "image/webp":
		return webpDimensions(b)
	case "image/x-icon", "image/svg+xml":
		return 1, 1, true
	}
	return 0, 0, false
}

func jpegDimensions(b []byte) (int, int, bool) {
	if len(b) < 4 || b[0] != 0xff || b[1] != 0xd8 {
		return 0, 0, false
	}
	offset := 2
	for offset < len(b)-8 {
		if b[offset] != 0xff {
			offset++
			continue
		}
		marker := b[offset+1]
		// SOF0-SOF2 carry the frame size.
		if marker >= 0xc0 && marker <= 0xc2 {
			height := int(binary.BigEndian.Uint16(b[offset+5:]))
			width := int(binary.BigEndian.Uint16(b[offset+7:]))
			return width, height, true
		}
		offset += 2 + int(binary.BigEndian.Uint16(b[offset+2:]))
	}
	return 0, 0, false
}

func webpDimensions(b []byte) (int, int, bool) {
	if len(b) < 30 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0, false
	}
	switch string(b[12:16]) {
	case "VP8 ":
		return int(binary.LittleEndian.Uint16(b[26:]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:]) & 0x3fff), true
	case "VP8L":
		bits := binary.LittleEndian.Uint32(b[21:])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
	}
	return 0, 0, false
}
