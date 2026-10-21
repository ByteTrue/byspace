package serviceproxy

import (
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Route maps a hostname to a local port.
type Route struct {
	Hostname string
	// Port is the local port the script bound.
	Port int
	// WorkspaceID and ScriptName identify the owner, for teardown and for the UI.
	WorkspaceID string
	ScriptName  string
}

// Proxy routes requests by Host header to the script that owns that hostname.
//
// A reverse proxy rather than a path prefix: a dev server serves absolute asset paths
// (`/static/x.js`), and a prefix would need every one rewritten. Host-based routing leaves the
// request untouched, which is why the node daemon chose it too.
//
// WebSocket upgrades pass through: Vite and Next both use one for HMR, and a preview that does not
// hot-reload is a preview the user cannot trust.
type Proxy struct {
	mu     sync.RWMutex
	routes map[string]Route
	// BaseDomain is the public suffix, used to accept `<label>.<base>` hosts. Empty means only
	// `.localhost` is accepted.
	BaseDomain string
	// Transport is shared so connections are pooled across routes.
	Transport http.RoundTripper
	Logf      func(string, ...any)
}

// NewProxy builds an empty proxy.
func NewProxy(baseDomain string, logf func(string, ...any)) *Proxy {
	if logf == nil {
		logf = log.Printf
	}
	return &Proxy{
		routes:     make(map[string]Route),
		BaseDomain: baseDomain,
		Transport: &http.Transport{
			// A preview server is local, so the default pool is enough; the values are raised
			// for the HMR websocket, which is long-lived.
			Proxy:                 http.ProxyFromEnvironment,
			MaxIdleConns:          64,
			IdleConnTimeout:       90 * time.Second,
			ResponseHeaderTimeout: 30 * time.Second,
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
		},
		Logf: logf,
	}
}

// Register adds or replaces a route.
func (p *Proxy) Register(route Route) {
	if route.Hostname == "" || route.Port <= 0 {
		return
	}
	p.mu.Lock()
	p.routes[strings.ToLower(route.Hostname)] = route
	p.mu.Unlock()
	p.Logf("service proxy: %s → 127.0.0.1:%d", route.Hostname, route.Port)
}

// Unregister removes a route.
//
// Called when a script stops: a stale route would forward to a port that now belongs to something
// else, which is worse than a 404 — the user would see another workspace's app.
func (p *Proxy) Unregister(hostname string) {
	p.mu.Lock()
	delete(p.routes, strings.ToLower(hostname))
	p.mu.Unlock()
}

// UnregisterScript removes every route a script owns.
func (p *Proxy) UnregisterScript(workspaceID, scriptName string) {
	p.mu.Lock()
	for hostname, route := range p.routes {
		if route.WorkspaceID == workspaceID && route.ScriptName == scriptName {
			delete(p.routes, hostname)
		}
	}
	p.mu.Unlock()
}

// Lookup finds the route for a Host header value.
//
// The Host carries a port (`dev--byspace.localhost:6778`) which must be stripped before matching,
// and comparison is case-insensitive because DNS is.
func (p *Proxy) Lookup(hostHeader string) (Route, bool) {
	host := hostHeader
	if index := strings.LastIndex(host, ":"); index >= 0 {
		// Careful with IPv6 literals; a hostname never contains a colon before the port.
		if !strings.Contains(host[:index], "]") || strings.HasPrefix(host, "[") {
			host = host[:index]
		}
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))

	p.mu.RLock()
	defer p.mu.RUnlock()
	route, ok := p.routes[host]
	return route, ok
}

// ServeHTTP proxies a request to the route named by its Host.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	route, ok := p.Lookup(r.Host)
	if !ok {
		// 404 rather than a directory listing or a default app: answering with something else
		// would make a typo look like a broken service.
		http.Error(w, "No service is registered at this hostname.", http.StatusNotFound)
		return
	}

	target := &url.URL{Scheme: "http", Host: "127.0.0.1:" + strconv.Itoa(route.Port)}
	proxy := &httputil.ReverseProxy{
		Director: func(request *http.Request) {
			request.URL.Scheme = target.Scheme
			request.URL.Host = target.Host
			// The dev server must see its own hostname, not the proxy's, or its absolute URLs and
			// HMR handshake point at the wrong place.
			request.Host = r.Host
			// X-Forwarded-* so the app can build correct external URLs and log the real client.
			request.Header.Set("X-Forwarded-Host", r.Host)
			if clientIP, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
				existing := request.Header.Get("X-Forwarded-For")
				if existing != "" {
					clientIP = existing + ", " + clientIP
				}
				request.Header.Set("X-Forwarded-For", clientIP)
			}
			request.Header.Set("X-Forwarded-Proto", schemeFor(r))
		},
		Transport: p.Transport,
		ErrorHandler: func(writer http.ResponseWriter, request *http.Request, err error) {
			p.Logf("service proxy: %s → %s failed: %v", r.Host, target.Host, err)
			http.Error(writer, "The service did not respond. It may have stopped.", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r)
}

// schemeFor reports the scheme the client used.
func schemeFor(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		return forwarded
	}
	return "http"
}

// ListenAndServe starts the proxy on addr. Used by the daemon when a base domain is configured.
func (p *Proxy) ListenAndServe(addr string) error {
	server := &http.Server{
		Addr:              addr,
		Handler:           p,
		ReadHeaderTimeout: 15 * time.Second,
	}
	return server.ListenAndServe()
}
