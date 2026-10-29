package server

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Relay lifecycle, ported from relay-runtime.ts.
//
// The relay is not a boot-time constant: the settings page can enable it, disable it, or point it
// at a different endpoint, and the daemon must react without a restart. Starting it once from a
// flag meant a user who enabled the relay in settings saw nothing happen, while
// `daemon.config.reload` claimed the change was applied.

// RelayConfig is the relay's runtime configuration.
//
// PublicEndpoint/PublicUseTLS are what clients are told to dial. They differ from the internal
// pair when the daemon reaches the relay at a private address (a container, a tunnel) while the
// app must use the public one, so anything handed to a client — the pairing offer — reads the
// public pair.
type RelayConfig struct {
	Enabled        bool   `json:"enabled"`
	Endpoint       string `json:"endpoint"`
	UseTLS         bool   `json:"useTls"`
	PublicEndpoint string `json:"publicEndpoint"`
	PublicUseTLS   bool   `json:"publicUseTls"`
}

// relayRuntime owns the relay connection's lifecycle.
type relayRuntime struct {
	mu      sync.Mutex
	config  RelayConfig
	cancel  context.CancelFunc
	stopped bool
	// connectedEndpoint is the endpoint the last successful dial used. Config is what was asked
	// for; this is what actually worked, and `daemon status` needs the second one — a `--relay`
	// override or a dial that silently fell back would otherwise be reported as the configured
	// address.
	connectedEndpoint string
}

func newRelayRuntime(cfg RelayConfig) *relayRuntime {
	return &relayRuntime{config: cfg}
}

// Config returns the current configuration.
func (r *relayRuntime) Config() RelayConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.config
}

// State is the live picture: what it is configured to dial, and what it last reached.
func (r *relayRuntime) State() (RelayConfig, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.config, r.connectedEndpoint
}

// markConnected records the endpoint a successful dial used.
func (r *relayRuntime) markConnected(endpoint string) {
	r.mu.Lock()
	r.connectedEndpoint = endpoint
	r.mu.Unlock()
}

// Apply starts, stops or restarts the relay so it matches cfg.
//
// A no-op when nothing relevant changed: reconnecting on every settings save would drop the
// relay for phones that are connected through it.
func (r *relayRuntime) Apply(parent context.Context, cfg RelayConfig, connect func(context.Context, string) error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	sameEndpoint := r.config.Endpoint == cfg.Endpoint && r.config.UseTLS == cfg.UseTLS
	wasEnabled := r.config.Enabled && r.cancel != nil
	r.config = cfg

	if wasEnabled && cfg.Enabled && sameEndpoint {
		return // nothing to do
	}
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	if !cfg.Enabled || strings.TrimSpace(cfg.Endpoint) == "" {
		return
	}

	ctx, cancel := context.WithCancel(parent)
	r.cancel = cancel
	go r.supervise(ctx, cfg, connect)
}

// supervise keeps the relay connected, with linear backoff to 30s.
//
// Ported from relay-transport.ts. A fixed short retry hammers a relay that is down for a while
// and gives no signal that the outage is long.
//
// The first failure and every change of error is logged. Without that, a wrong endpoint, a
// rejected handshake or a revoked relay looked exactly like a daemon that had simply not tried:
// the settings page claimed the relay was on, phones timed out, and nothing in the log said why.
func (r *relayRuntime) supervise(ctx context.Context, cfg RelayConfig, connect func(context.Context, string) error) {
	attempt := 0
	var lastErr string
	for ctx.Err() == nil {
		// connect reports success the moment the dial is established (see ConnectRelay), so this
		// records the address that worked rather than the one that was configured.
		err := connect(ctx, cfg.Endpoint)
		if ctx.Err() != nil {
			return
		}
		attempt++
		if err != nil {
			if message := err.Error(); message != lastErr {
				fmt.Fprintf(os.Stderr, "relay: %s unreachable (attempt %d): %v\n", cfg.Endpoint, attempt, err)
				lastErr = message
			}
		} else {
			lastErr = ""
		}
		delay := time.Duration(attempt) * time.Second
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

// Stop tears the relay down.
func (r *relayRuntime) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopped = true
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
}

// hostedRelayEndpoint is the relay a daemon reaches when its config says only `enabled`.
//
// Matches `DEFAULT_RELAY_ENDPOINT` in packages/protocol/src/daemon-endpoints.ts and the fallback
// in the node daemon's resolveRelayConfig. Without it, `"relay": {"enabled": true}` — the shape
// every existing home has, since the endpoint is optional — left Endpoint empty and the daemon
// never dialled: relay looked on, and remote access was silently dead.
const hostedRelayEndpoint = "app.byspace.cc.cd:443"

// ResolveRelayConfig reads the relay settings from a loaded daemon config.
//
// Exported because the CLI has to report where the daemon actually connects; reading the file by
// hand got the fallback and the public/internal split wrong.
func ResolveRelayConfig(cfg map[string]any) RelayConfig {
	return relayConfigFromStore(cfg)
}

// relayConfigFromStore reads the relay settings from the daemon config.
//
// LoadDaemonConfig already unwraps the `daemon` object, so the relay block sits at the top
// level here. Reading it as cfg["daemon"]["relay"] silently returned the zero value, which is
// why enabling the relay in settings never connected it.
func relayConfigFromStore(cfg map[string]any) RelayConfig {
	out := RelayConfig{}
	if cfg == nil {
		return out
	}
	relay, ok := cfg["relay"].(map[string]any)
	if !ok {
		if daemon, nested := cfg["daemon"].(map[string]any); nested {
			relay, ok = daemon["relay"].(map[string]any)
		}
		if !ok {
			return out
		}
	}
	if enabled, ok := relay["enabled"].(bool); ok {
		out.Enabled = enabled
	}
	if endpoint, ok := relay["endpoint"].(string); ok {
		out.Endpoint = strings.TrimSpace(endpoint)
	}
	useTLSSet := false
	if useTLS, ok := relay["useTls"].(bool); ok {
		out.UseTLS = useTLS
		useTLSSet = true
	}
	if endpoint, ok := relay["publicEndpoint"].(string); ok {
		out.PublicEndpoint = strings.TrimSpace(endpoint)
	}
	publicUseTLSSet := false
	if useTLS, ok := relay["publicUseTls"].(bool); ok {
		out.PublicUseTLS = useTLS
		publicUseTLSSet = true
	}
	// An endpoint with no `useTls` beside it still says how to reach it: the hosted relays answer
	// on 443, and an operator who writes one without thinking about TLS means TLS. Leaving the
	// zero value produced `ws://<host>:80/ws`, which never connects, and pairing offers carrying
	// `:80`/`useTls:false` that the client then tried to open over plaintext.
	if !useTLSSet {
		out.UseTLS = relayEndpointImpliesTLS(out.Endpoint)
	}
	if !publicUseTLSSet {
		// The public endpoint defaults to the internal one, so an absent public TLS flag follows
		// whatever the internal one resolved to rather than re-deriving from an empty host.
		if out.PublicEndpoint == "" {
			out.PublicUseTLS = out.UseTLS
		} else {
			out.PublicUseTLS = relayEndpointImpliesTLS(out.PublicEndpoint)
		}
	}
	// Enabled with no endpoint means the hosted relay, matching the node daemon's
	// `?? input.hostedRelayEndpoint`. A home whose config only says `enabled: true` is the common
	// case: the endpoint is optional there, and every home predating this field has nothing.
	if out.Enabled {
		if out.Endpoint == "" {
			out.Endpoint = hostedRelayEndpoint
			out.UseTLS = true
		}
		if out.PublicEndpoint == "" {
			out.PublicEndpoint = out.Endpoint
			out.PublicUseTLS = out.UseTLS
		}
	}
	return out
}

// relayEndpointImpliesTLS reports whether an endpoint only makes sense over TLS.
func relayEndpointImpliesTLS(endpoint string) bool {
	ep := strings.TrimSpace(endpoint)
	if ep == "" {
		return false
	}
	if strings.HasPrefix(ep, "wss://") || strings.HasPrefix(ep, "https://") {
		return true
	}
	if strings.HasPrefix(ep, "ws://") || strings.HasPrefix(ep, "http://") {
		return false
	}
	if _, port, err := net.SplitHostPort(ep); err == nil {
		return port == "443"
	}
	// A bare host is dialled at the scheme default, and every hosted relay is a bare host on 443.
	return true
}

// ClientRelayEndpoint is the endpoint a client should dial, preferring the public one.
func (c RelayConfig) ClientRelayEndpoint() string {
	if c.PublicEndpoint != "" {
		return c.PublicEndpoint
	}
	return c.Endpoint
}

// ClientRelayUseTLS mirrors ClientRelayEndpoint for the scheme flag.
func (c RelayConfig) ClientRelayUseTLS() bool {
	if c.PublicEndpoint != "" {
		return c.PublicUseTLS
	}
	return c.UseTLS
}

// relayWebSocketURL turns a relay endpoint into a dialable WebSocket URL.
//
// The stored endpoint is host:port (`relay.byspace.cc.cd:443`), the same shape the pairing offer
// carries and the client parses; it is not a URL. Passing it to url.Parse either failed outright
// (`127.0.0.1:6778`: "first path segment in URL cannot contain colon") or parsed as a scheme
// (`relay.byspace.cc.cd:443`), so the daemon never connected to any relay configured this way.
// A `--relay ws://…` override is already a URL and is kept as one.
func relayWebSocketURL(endpoint string, useTLS bool) string {
	ep := strings.TrimSpace(endpoint)
	if strings.HasPrefix(ep, "ws://") || strings.HasPrefix(ep, "wss://") {
		return ep
	}
	scheme := "ws"
	if useTLS {
		scheme = "wss"
	}
	// A bare host without a port is left to the scheme's default port.
	return scheme + "://" + ep + "/ws"
}

// ApplyRelayConfig reconciles the relay connection with the stored config.
//
// Called at boot and after every config write, so enabling the relay in settings connects it and
// pointing it somewhere else reconnects there.
func (s *Server) ApplyRelayConfig(ctx context.Context) {
	if s.relay == nil {
		return
	}
	cfg := relayConfigFromStore(s.store.LoadDaemonConfig())
	s.mu.Lock()
	override := s.relayOverride
	s.mu.Unlock()
	if override != "" {
		// The flag is the whole configuration for this run: an operator who launches the daemon
		// with `--relay` means that endpoint, and `--relay-use-tls` says how to reach it. Without
		// reading the flag here it was parsed, stored, and never consulted, so `--relay-use-tls`
		// did nothing and the connection was dialled over plaintext.
		cfg.Enabled = true
		cfg.Endpoint = override
		cfg.UseTLS = s.relayUseTLS || relayEndpointImpliesTLS(override)
	}
	s.relay.Apply(ctx, cfg, func(ctx context.Context, endpoint string) error {
		return s.ConnectRelay(ctx, relayWebSocketURL(endpoint, cfg.UseTLS))
	})
}

// SetRelayOverride pins the relay endpoint from a CLI flag.
//
// The flag wins over the stored config: an operator who launches the daemon with `--relay` means
// it, and a stale config must not silently redirect the connection.
func (s *Server) SetRelayOverride(endpoint string) {
	s.mu.Lock()
	s.relayOverride = strings.TrimSpace(endpoint)
	s.mu.Unlock()
}

// relayEndpointFromURL turns a dial URL back into the host:port an offer carries.
func relayEndpointFromURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	return u.Host
}

// relayRuntimeState is the live relay picture `/health` reports and `daemon status` prints.
//
// It answers "where is this daemon connected", which is not the same question as "what does
// config.json say": a `--relay` override, or a dial that never succeeded, makes the two disagree.
func (s *Server) relayRuntimeState() map[string]any {
	if s.relay == nil {
		return map[string]any{"enabled": false}
	}
	cfg, connected := s.relay.State()
	state := map[string]any{
		"enabled":  cfg.Enabled,
		"useTls":   cfg.UseTLS,
		"endpoint": cfg.Endpoint,
	}
	if connected != "" {
		state["connected"] = relayEndpointFromURL2(connected)
	}
	return state
}

// relayEndpointFromURL2 normalizes whatever markConnected received to host:port.
func relayEndpointFromURL2(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "ws://") || strings.HasPrefix(trimmed, "wss://") {
		if u, err := url.Parse(trimmed); err == nil {
			return u.Host
		}
	}
	return trimmed
}
