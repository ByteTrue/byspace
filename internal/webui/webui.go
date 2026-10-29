package webui

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
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
	fsys                  fs.FS
	injectConnectionHint  bool
	explicitListen        string
	label                 string
	credential            string
	disablePrecompression bool
}

// WithConnectionHint enables injecting window.__BYSPACE_INITIAL_DAEMON_CONNECTION__ into index.html
// so that same-origin browser clients automatically connect to the serving daemon port.
func (h *Handler) WithConnectionHint(label string) *Handler {
	if h == nil {
		return nil
	}
	h.injectConnectionHint = true
	h.label = label
	return h
}

// WithExplicitConnectionHint injects a fixed daemon listen address into index.html instead of r.Host.
// Wails desktop windows serve static assets from wails://localhost while the daemon listens on loopback TCP.
func (h *Handler) WithExplicitConnectionHint(listenAddr, label string) *Handler {
	if h == nil {
		return nil
	}
	h.injectConnectionHint = true
	h.explicitListen = strings.TrimSpace(listenAddr)
	h.label = label
	return h
}

// WithLocalCredential attaches this host's local CLI credential to the injected connection hint so
// the desktop app window authenticates automatically even when a daemon password is configured.
func (h *Handler) WithLocalCredential(token string) *Handler {
	if h == nil {
		return nil
	}
	h.credential = strings.TrimSpace(token)
	return h
}

// WithoutPrecompression disables serving pre-compressed .br/.gz responses with Content-Encoding headers.
// In-process WebView scheme handlers (WKURLSchemeTask, WebViewAssetLoader) do not decompress HTTP
// Content-Encoding streams; with precompression disabled, TryServe inflates .gz assets in memory.
func (h *Handler) WithoutPrecompression() *Handler {
	if h == nil {
		return nil
	}
	h.disablePrecompression = true
	return h
}

// ServeHTTP implements http.Handler so Handler can be passed directly to Wails AssetOptions.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.TryServe(w, r) {
		http.NotFound(w, r)
	}
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
	if !isIndex && !h.disablePrecompression {
		finalFile, encoding = h.resolveEncoding(resolvedFile, r.Header.Get("Accept-Encoding"))
	}

	data, err := fs.ReadFile(h.fsys, finalFile)
	if err != nil {
		if gzBytes, gzErr := fs.ReadFile(h.fsys, resolvedFile+".gz"); gzErr == nil {
			if zr, zErr := gzip.NewReader(bytes.NewReader(gzBytes)); zErr == nil {
				data, err = io.ReadAll(zr)
				_ = zr.Close()
			}
		}
		if err != nil {
			return false
		}
	}

	if isIndex && h.injectConnectionHint {
		data = injectDaemonConnectionHint(data, r, h.explicitListen, h.label, h.credential)
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
	} else if hasFile(h.fsys, rel+".br") || hasFile(h.fsys, rel+".gz") {
		return rel, false
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

func injectDaemonConnectionHint(htmlBytes []byte, r *http.Request, explicitListen, label, credential string) []byte {
	host := explicitListen
	useTLS := false
	if host == "" {
		host = r.Host
		useTLS = r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	}
	hint := map[string]any{
		"listen": host,
		"useTls": useTLS,
		"label":  label,
	}
	if credential != "" {
		hint["password"] = credential
	}
	b, err := json.Marshal(hint)
	if err != nil {
		return htmlBytes
	}
	safeJSON := strings.NewReplacer(
		"<", `\u003C`,
		">", `\u003E`,
		"&", `\u0026`,
	).Replace(string(b))

	// When explicitListen is set, we are serving inside a Wails desktop window: load Wails'
	// /wails/runtime.js (which registers the --wails-draggable mouse handlers and double-click zoom)
	// and inject drag rules so the top 36px header strip drags the window while controls stay clickable.
	wailsHead := ""
	if explicitListen != "" {
		wailsHead = `<script type="module" src="/wails/runtime.js"></script><style>[data-wails-drag="true"]{--wails-draggable:drag;-webkit-user-select:none;user-select:none;cursor:default}button,[role="button"],a,input,textarea,select,[data-menu-item="true"],[tabindex="0"]{--wails-draggable:no-drag}</style><script>window.addEventListener("mousedown",function(e){if(e.button===0&&e.clientY>=0&&e.clientY<=38&&e.target instanceof HTMLElement&&!e.target.closest('button,[role="button"],a,input,textarea,select,[data-menu-item="true"],[tabindex="0"]')){e.target.style.setProperty("--wails-draggable","drag");e.target.style.setProperty("-webkit-user-select","none");e.target.style.setProperty("cursor","default");e.preventDefault()}},true);(function(){if(!/Windows/i.test(navigator.userAgent))return;var last="";function syncTint(){var el=document.querySelector('[data-testid="left-sidebar"]')||document.body;if(!el)return;var c=document.createElement("canvas").getContext("2d");if(!c)return;c.fillStyle="#f7f7f8";c.fillRect(0,0,1,1);var bg=getComputedStyle(el).backgroundColor;if(bg&&bg!=="rgba(0, 0, 0, 0)"&&bg!=="transparent"){c.fillStyle=bg;c.fillRect(0,0,1,1)}var d=c.getImageData(0,0,1,1).data,r=d[0],g=d[1],b=d[2],k=r+","+g+","+b;if(k===last)return;last=k;var dark=(0.2126*r+0.7152*g+0.0722*b)<128;fetch("/_byspace/desktop/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({titleBarColor:[r,g,b],titleBarDark:dark})}).catch(function(){last=""})}window.addEventListener("DOMContentLoaded",function(){setTimeout(syncTint,60);setTimeout(syncTint,400);new MutationObserver(function(){setTimeout(syncTint,80)}).observe(document.documentElement,{attributes:true,childList:true,subtree:true})});matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){setTimeout(syncTint,200)})})();</script>`
	}
	script := wailsHead + "<script>window.__BYSPACE_INITIAL_DAEMON_CONNECTION__=" + safeJSON + "</script>"
	htmlStr := string(htmlBytes)
	lower := strings.ToLower(htmlStr)
	if idx := strings.Index(lower, "</head>"); idx != -1 {
		return []byte(htmlStr[:idx] + script + htmlStr[idx:])
	}
	return []byte(script + htmlStr)
}
