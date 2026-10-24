// Package imageout turns a provider's inline image output into a file the UI can display.
//
// Ported from agent/providers/provider-image-output.ts. Providers return generated images as a
// base64 blob inside an event; the conversation renders an image by path, so without this the
// model's image output is invisible even though the daemon received it.
package imageout

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// AttachmentDirName is the directory under the home dir where images land.
const AttachmentDirName = "byspace-attachments"

// privateDirMode keeps the directory readable only by the user: generated images can contain
// anything the model saw.
const privateDirMode = 0o700

// fileMode is the same reasoning for the files themselves.
const fileMode = 0o600

// Materialize writes an inline image and returns its path.
//
// The filename is the SHA-256 of the bytes, so materialising the same image twice (a repeated
// block, or a history replay) reuses the file instead of leaving a fresh copy each time. Without
// that, replaying a conversation with images would grow the directory on every replay.
func Materialize(homeDir, data, mimeType string) (string, error) {
	if strings.TrimSpace(homeDir) == "" {
		return "", fmt.Errorf("no home directory for attachments")
	}
	normalizedMime, normalizedData := normalizeImageData(data, mimeType)
	if normalizedData == "" {
		return "", fmt.Errorf("image has no data")
	}
	bytes, err := base64.StdEncoding.DecodeString(normalizedData)
	if err != nil {
		// A provider may emit unpadded base64; try the raw alphabet before failing.
		bytes, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(normalizedData, "="))
		if err != nil {
			return "", fmt.Errorf("image data is not base64: %w", err)
		}
	}

	dir := filepath.Join(homeDir, AttachmentDirName)
	if err := ensurePrivateDir(dir); err != nil {
		return "", err
	}

	digest := sha256.Sum256(bytes)
	path := filepath.Join(dir, hex.EncodeToString(digest[:])+"."+extensionFor(normalizedMime))
	if _, statErr := os.Stat(path); statErr == nil {
		return path, nil
	}
	if err := os.WriteFile(path, bytes, fileMode); err != nil {
		return "", err
	}
	// WriteFile's mode is masked by the umask; chmod makes the intent explicit.
	_ = os.Chmod(path, fileMode)
	return path, nil
}

// ensurePrivateDir creates the attachment directory with private permissions.
func ensurePrivateDir(dir string) error {
	info, err := os.Stat(dir)
	if err == nil {
		if !info.IsDir() {
			return fmt.Errorf("%s exists and is not a directory", dir)
		}
		// An older run may have created it with a wider mode; re-assert.
		_ = os.Chmod(dir, privateDirMode)
		return nil
	}
	if err := os.MkdirAll(dir, privateDirMode); err != nil {
		return err
	}
	_ = os.Chmod(dir, privateDirMode)
	return nil
}

// normalizeImageData accepts both a bare base64 payload and a data: URL.
func normalizeImageData(data, mimeType string) (string, string) {
	trimmed := strings.TrimSpace(data)
	if strings.HasPrefix(trimmed, "data:") {
		// data:<mime>;base64,<payload>
		comma := strings.Index(trimmed, ",")
		if comma > 0 {
			header := trimmed[len("data:"):comma]
			payload := trimmed[comma+1:]
			if idx := strings.Index(header, ";"); idx > 0 {
				return header[:idx], payload
			}
			if header != "" {
				return header, payload
			}
			return mimeType, payload
		}
	}
	return mimeType, trimmed
}

// extensionFor maps a MIME type onto a file extension.
//
// An unknown type becomes "bin" rather than being refused: the bytes are still the model's
// output, and refusing to write them would lose it entirely.
func extensionFor(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return "png"
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	case "image/svg+xml":
		return "svg"
	default:
		return "bin"
	}
}

// RenderAsMarkdown turns a provider image into an assistant message the client can display.
//
// Ported from renderProviderImageOutputAsAssistantMarkdown. Without this a provider that returns an image produces
// a transcript entry the client cannot render: Go materialized the bytes to disk and then said nothing about them,
// so a screenshot a model generated never appeared.
//
// Three sources, in order:
//
//   - A path or non-data URL is used as the markdown target directly. It is already addressable and re-encoding it
//     would only make the message longer.
//   - A data: URL is kept as the source, which the client renders without a round trip.
//   - Raw base64 is written to disk and referenced by path, because an inline data URL for a multi-megabyte image
//     bloats every timeline fetch that carries it.
func RenderAsMarkdown(image ProviderImage, homeDir string) (string, bool) {
	source := strings.TrimSpace(image.Path)
	if source == "" {
		source = strings.TrimSpace(image.URL)
	}
	alt := strings.TrimSpace(image.AltText)
	if alt == "" {
		alt = "Image"
	}

	if source != "" && !isDataImageSource(source) {
		return "![" + escapeMarkdownAlt(alt) + "](" + escapeMarkdownSource(source) + ")", true
	}

	data := strings.TrimSpace(image.Data)
	if data == "" && isDataImageSource(source) {
		data = source
	}
	if data == "" {
		return "", false
	}

	// A data URL is already both source and payload.
	if isDataImageSource(data) {
		return "![" + escapeMarkdownAlt(alt) + "](" + escapeMarkdownSource(data) + ")", true
	}

	if strings.TrimSpace(homeDir) == "" {
		return "", false
	}
	path, err := Materialize(homeDir, data, image.MimeType)
	if err != nil || path == "" {
		return "", false
	}
	return "![" + escapeMarkdownAlt(alt) + "](" + escapeMarkdownSource(path) + ")", true
}

// ProviderImage is one image a provider returned.
type ProviderImage struct {
	// Path is a file the provider already wrote.
	Path string
	// URL is an addressable source, possibly a data: URL.
	URL string
	// Data is raw base64, used when there is no path.
	Data     string
	MimeType string
	AltText  string
}

// isDataImageSource reports whether a source is an inline data image.
func isDataImageSource(source string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(source)), "data:image/")
}

// escapeMarkdownAlt escapes the characters that end an alt text.
func escapeMarkdownAlt(value string) string {
	return strings.NewReplacer(`\`, `\\`, "]", `\]`).Replace(value)
}

// escapeMarkdownSource percent-encodes a path segment by segment.
//
// Segment by segment rather than the whole string: encoding the slashes too would produce a URL the client cannot
// resolve against the file route. Windows paths are separators-first: their backslashes become slashes and would
// otherwise be percent-encoded into one opaque segment no client can resolve.
func escapeMarkdownSource(value string) string {
	trimmed := strings.TrimSpace(value)
	if isDataImageSource(trimmed) {
		// A data URL is already encoded; re-encoding it would corrupt the payload.
		return trimmed
	}
	if strings.Contains(trimmed, "://") {
		return trimmed
	}
	segments := strings.Split(filepath.ToSlash(trimmed), "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}
