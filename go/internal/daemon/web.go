package daemon

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

const initialDaemonConnectionScript = `<script>globalThis.__PASEO_INITIAL_DAEMON_CONNECTION__={listen:globalThis.location.host,useTls:globalThis.location.protocol==="https:"};</script>`

type webAssets struct {
	root  *os.Root
	files http.Handler
	index []byte
}

func openWebAssets(directory string) (*webAssets, error) {
	if directory == "" {
		return nil, nil
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, fmt.Errorf("open web asset root %s: %w", directory, err)
	}
	index, err := root.ReadFile("index.html")
	if err != nil {
		root.Close()
		return nil, fmt.Errorf("read web index in %s: %w", directory, err)
	}
	marker := []byte("</head>")
	position := bytes.Index(bytes.ToLower(index), marker)
	if position < 0 {
		root.Close()
		return nil, fmt.Errorf("web index in %s has no </head>", directory)
	}
	injected := make([]byte, 0, len(index)+len(initialDaemonConnectionScript))
	injected = append(injected, index[:position]...)
	injected = append(injected, initialDaemonConnectionScript...)
	injected = append(injected, index[position:]...)
	return &webAssets{root: root, files: http.FileServerFS(root.FS()), index: injected}, nil
}

func (assets *webAssets) Close() error {
	if assets == nil {
		return nil
	}
	return assets.root.Close()
}

func (assets *webAssets) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if name == "." || name == "" || name == "index.html" {
		assets.serveIndex(writer, request)
		return
	}
	info, err := assets.root.Stat(name)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
			assets.serveIndex(writer, request)
			return
		}
		http.Error(writer, "web asset unavailable", http.StatusInternalServerError)
		return
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		assets.serveIndex(writer, request)
		return
	}
	if strings.HasPrefix(name, "_expo/static/") {
		writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		writer.Header().Set("Cache-Control", "no-cache")
	}
	assets.files.ServeHTTP(writer, request)
}

func (assets *webAssets) serveIndex(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(writer, request, "index.html", time.Time{}, bytes.NewReader(assets.index))
}
