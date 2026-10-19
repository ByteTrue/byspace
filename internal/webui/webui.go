package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed all:dist
var embeddedDist embed.FS

var hashedAssetRe = regexp.MustCompile(`(?i)[-.][0-9a-f]{16,}[-.]`)

var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "application/javascript; charset=utf-8",
	".mjs":   "application/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".eot":   "application/vnd.ms-fontobject",
	".map":   "application/json",
}

// Handler serves the BySpace web UI from an external directory (if provided and valid)
// or from the Go-embedded dist/ filesystem (if built with assets).
type Handler struct {
	fsys fs.FS
}

// NewHandler resolves a web UI asset source: explicit dir wins, then embedded dist/.
// Returns nil when neither contains an index.html.
func NewHandler(explicitDir string) *Handler {
	if strings.TrimSpace(explicitDir) != "" {
		abs, err := filepath.Abs(explicitDir)
		if err == nil {
			diskFS := os.DirFS(abs)
			if hasFile(diskFS, "index.html") {
				return &Handler{fsys: diskFS}
			}
		}
		return nil
	}
	sub, err := fs.Sub(embeddedDist, "dist")
	if err == nil && hasFile(sub, "index.html") {
		return &Handler{fsys: sub}
	}
	return nil
}

// NewFSHandler creates a Handler from any fs.FS that contains index.html.
func NewFSHandler(fsys fs.FS) *Handler {
	if fsys == nil || !hasFile(fsys, "index.html") {
		return nil
	}
	return &Handler{fsys: fsys}
}

func hasFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}

func isExcludedPath(reqPath string) bool {
	switch reqPath {
	case "/api", "/mcp", "/public", "/ws", "/health":
		return true
	}
	for _, prefix := range []string{"/api/", "/mcp/", "/public/"} {
		if strings.HasPrefix(reqPath, prefix) {
			return true
		}
	}
	return false
}

// TryServe serves the request if it belongs to the static web UI and returns true.
// Returns false if the path is excluded or cannot be served.
func (h *Handler) TryServe(w http.ResponseWriter, r *http.Request) bool {
	if h == nil || h.fsys == nil {
		return false
	}
	if isExcludedPath(r.URL.Path) {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return true
	}

	resolvedFile, isIndex := h.resolveTarget(r.URL.Path)
	if resolvedFile == "" {
		return false
	}

	finalFile := resolvedFile
	encoding := ""
	if !isIndex {
		finalFile, encoding = h.resolveEncoding(resolvedFile, r.Header.Get("Accept-Encoding"))
	}

	data, err := fs.ReadFile(h.fsys, finalFile)
	if err != nil {
		return false
	}

	w.Header().Set("Content-Type", getContentType(resolvedFile))
	if encoding != "" {
		w.Header().Set("Content-Encoding", encoding)
		w.Header().Set("Vary", "Accept-Encoding")
	}
	setCacheHeaders(w, isIndex, resolvedFile)
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
	return true
}

func (h *Handler) resolveTarget(requestPath string) (string, bool) {
	cleaned := path.Clean("/" + strings.TrimPrefix(requestPath, "/"))
	rel := strings.TrimPrefix(cleaned, "/")
	if rel == "" {
		rel = "index.html"
	}

	if info, err := fs.Stat(h.fsys, rel); err == nil {
		if info.IsDir() {
			dirIndex := path.Join(rel, "index.html")
			if hasFile(h.fsys, dirIndex) {
				return dirIndex, true
			}
		} else {
			return rel, strings.EqualFold(path.Base(rel), "index.html")
		}
	}

	if hasFile(h.fsys, "index.html") {
		return "index.html", true
	}
	return "", false
}

func (h *Handler) resolveEncoding(resolvedFile, acceptEncoding string) (string, string) {
	ae := strings.ToLower(acceptEncoding)
	if strings.Contains(ae, "br") && hasFile(h.fsys, resolvedFile+".br") {
		return resolvedFile + ".br", "br"
	}
	if strings.Contains(ae, "gzip") && hasFile(h.fsys, resolvedFile+".gz") {
		return resolvedFile + ".gz", "gzip"
	}
	return resolvedFile, ""
}

func getContentType(filePath string) string {
	ext := strings.ToLower(path.Ext(filePath))
	if ct, ok := contentTypes[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}

func setCacheHeaders(w http.ResponseWriter, isIndex bool, resolvedFile string) {
	if isIndex {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
	} else if hashedAssetRe.MatchString(path.Base(resolvedFile)) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
}
