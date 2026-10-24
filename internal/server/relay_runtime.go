package server

import (
	"context"
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
func (r *relayRuntime) supervise(ctx context.Context, cfg RelayConfig, connect func(context.Context, string) error) {
	attempt := 0
	for ctx.Err() == nil {
		_ = connect(ctx, cfg.Endpoint)
		attempt++
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
	if useTLS, ok := relay["useTls"].(bool); ok {
		out.UseTLS = useTLS
	}
	if endpoint, ok := relay["publicEndpoint"].(string); ok {
		out.PublicEndpoint = strings.TrimSpace(endpoint)
	}
	if useTLS, ok := relay["publicUseTls"].(bool); ok {
		out.PublicUseTLS = useTLS
	}
	return out
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
		cfg.Enabled = true
		cfg.Endpoint = override
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
