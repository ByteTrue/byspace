package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/home"
)

// RegistryFilename is where configured peers live, matching tunnels.json in the node daemon.
const RegistryFilename = "tunnels.json"

// PeerConfig is one configured outbound peer.
type PeerConfig struct {
	PeerID          string          `json:"peerId"`
	PeerHostname    *string         `json:"peerHostname,omitempty"`
	URL             string          `json:"url"`
	Token           string          `json:"password"`
	DaemonPublicKey string          `json:"daemonPublicKeyB64,omitempty"`
	Forwards        []ForwardConfig `json:"forwards"`
}

// ForwardConfig is one destination on a peer, exposed as a local port.
type ForwardConfig struct {
	RemotePort int `json:"remotePort"`
	// RemoteHost is the destination on the peer's side. Empty means the peer's loopback, which is
	// also what a tunnels.json written before hosts existed means.
	RemoteHost string `json:"remoteHost,omitempty"`
	LocalPort  int    `json:"localPort,omitempty"`
	// ListenHost is the interface the local listener binds to. Empty means loopback.
	ListenHost string `json:"listenHost,omitempty"`
	Disabled   bool   `json:"disabled,omitempty"`
	Label      string `json:"label,omitempty"`
}

// Endpoint is one destination a peer may reach on this machine's network.
type Endpoint struct {
	// Host is another machine on this network. Empty means this machine's loopback.
	Host string
	Port int
}

// loopbackHost is the canonical spelling of "this machine".
const loopbackHost = "127.0.0.1"

// CanonicalHost folds every spelling of loopback into one, so a port-only allowlist entry and a
// request for "localhost" agree. Anything else is compared case-insensitively and otherwise kept,
// so an allowlist entry matches the host the operator typed.
func CanonicalHost(host string) string {
	h := strings.ToLower(unbracket(host))
	switch h {
	case "", loopbackHost, "localhost", "::1", "0:0:0:0:0:0:0:1":
		return loopbackHost
	}
	return h
}

// FormatEndpoint renders a destination as host:port for display, ids and comparisons.
func FormatEndpoint(host string, port int) string {
	return net.JoinHostPort(CanonicalHost(host), strconv.Itoa(port))
}

// unbracket strips the [ ] an operator may type around an IPv6 literal. JoinHostPort adds them.
func unbracket(host string) string {
	return strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(host), "["), "]")
}

// ValidateRemoteHost rejects a destination that cannot be dialled as written.
func ValidateRemoteHost(host string) error {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return nil
	}
	if len(trimmed) > MaxRemoteHostLength {
		return fmt.Errorf("remote host is longer than %d bytes", MaxRemoteHostLength)
	}
	// No scheme, path, userinfo or spaces. Dial would resolve some of them differently than the
	// operator reading the rule expects, and the target must dial exactly the allowlisted host.
	if strings.ContainsAny(trimmed, " /\\@?#") {
		return fmt.Errorf("remote host %q is not a host name or address", host)
	}
	for _, r := range trimmed {
		if r < 0x21 || r == 0x7f {
			return fmt.Errorf("remote host %q contains a control character", host)
		}
	}
	if strings.Contains(unbracket(trimmed), ":") && net.ParseIP(unbracket(trimmed)) == nil {
		return fmt.Errorf("remote host %q is not an IPv6 address", host)
	}
	return nil
}

// registryFile is the on-disk shape. The version field matches the node schema so the two
// daemons can share a home directory during the transition.
type registryFile struct {
	Version int          `json:"v"`
	Peers   []PeerConfig `json:"peers"`
}

// PeerStatus is one peer's state for tunnel.list.
type PeerStatus struct {
	PeerID       string         `json:"peerId"`
	PeerHostname *string        `json:"peerHostname"`
	State        string         `json:"state"`
	LastError    *string        `json:"lastError"`
	Forwards     []ForwardState `json:"forwards"`
}

// Registry owns every configured peer and its manager.
//
// Ported from tunnel-registry.ts. Two things in it are load-bearing and easy to miss: the
// experimental gate starts closed (issue 063 — the feature shipped opt-in), and disabling it must
// actively stop the managers, not merely ignore them. A manager left running keeps its local
// listeners bound, so the user turns the feature off and their ports stay open.
type Registry struct {
	mu      sync.Mutex
	homeDir string
	peers   []PeerConfig
	// managers is keyed by peer id; a peer without a manager is configured but not connected.
	managers map[string]*Manager
	enabled  bool
	// logf is called for lifecycle events.
	logf func(string, ...any)
	// newPeer builds a PeerConn for a peer. Injected so tests drive the registry without a relay.
	newPeer func(PeerConfig) (PeerConn, error)
	// cancellers cancels each running reconnector; a peer removed or the gate closing stops them.
	cancellers map[string]context.CancelFunc
	// ctx bounds every reconnector this registry starts.
	ctx context.Context
	// localKey is this daemon's own key. A reconnector handshakes with it so the target can tell
	// which daemon is connecting and match it against a grant. Nil falls back to an anonymous key,
	// which no grant can match.
	localKey *e2ee.KeyPair
	// started records that the initial dial happened, so a later Start does not tear down and
	// rebuild every peer just because a config write asked again.
	started bool
}

// NewRegistry loads the configured peers.
//
// A malformed file yields an empty registry rather than an error: the daemon must start, and the
// next save overwrites the broken file. Losing tunnel configuration is recoverable; refusing to
// boot is not.
func NewRegistry(homeDir string, logf func(string, ...any)) *Registry {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	r := &Registry{
		homeDir:    homeDir,
		managers:   make(map[string]*Manager),
		cancellers: make(map[string]context.CancelFunc),
		ctx:        context.Background(),
		logf:       logf,
	}
	r.peers = loadRegistry(homeDir, logf)
	return r
}

// SetLocalKey supplies the daemon's own key, used to prove identity when dialing a peer.
func (r *Registry) SetLocalKey(key e2ee.KeyPair) {
	r.mu.Lock()
	r.localKey = &key
	r.mu.Unlock()
}

// loadRegistry reads tunnels.json.
func loadRegistry(homeDir string, logf func(string, ...any)) []PeerConfig {
	path := filepath.Join(homeDir, RegistryFilename)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	// A UTF-8 BOM is what Windows editors write by default, and `json.Unmarshal` refuses it. The
	// peer list then read as malformed and every tunnel silently vanished.
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	var file registryFile
	if err := json.Unmarshal(raw, &file); err != nil {
		logf("tunnels.json is malformed; starting empty: %v", err)
		return nil
	}
	return file.Peers
}

// SetPeerFactory overrides how a peer connection is built. Tests use it; production leaves it nil
// and Start builds a TunnelReconnector.
func (r *Registry) SetPeerFactory(factory func(PeerConfig) (PeerConn, error)) {
	r.mu.Lock()
	r.newPeer = factory
	r.mu.Unlock()
}

// SetEnabled opens or closes the experimental gate.
//
// Disabling stops every manager so the local listeners are released, and re-enabling restarts
// them: the gate is a kill switch, not a UI filter.
func (r *Registry) SetEnabled(enabled bool) {
	r.mu.Lock()
	if r.enabled == enabled {
		r.mu.Unlock()
		return
	}
	r.enabled = enabled
	// Re-opening the gate must dial again, so the "already started" mark only holds while open.
	r.started = false
	peers := append([]PeerConfig(nil), r.peers...)
	var toStop []*Manager
	if !enabled {
		for id, manager := range r.managers {
			toStop = append(toStop, manager)
			delete(r.managers, id)
		}
		// The reconnector loops forever, so closing the manager is not enough: without this the
		// gate would stop the listeners and keep dialling the peer.
		for id, cancel := range r.cancellers {
			cancel()
			delete(r.cancellers, id)
		}
	}
	r.mu.Unlock()

	for _, manager := range toStop {
		_ = manager.Close()
	}
	r.logf("tunnel gate set to %v", enabled)

	if enabled {
		// Opening the gate dials, so mark it started: the next config write must not dial again.
		r.mu.Lock()
		r.started = true
		r.mu.Unlock()
		for _, peer := range peers {
			if err := r.startPeer(peer); err != nil {
				r.logf("tunnel %s failed to start: %v", peer.PeerID, err)
			}
		}
	}
}

// IsEnabled reports the gate state.
func (r *Registry) IsEnabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enabled
}

// Start brings up every configured peer, but only when the gate is open.
//
// Idempotent: the first call dials, later calls are no-ops. Config writes call this again, and
// rebuilding every manager each time would drop live connections for an unrelated setting change.
// Closing and reopening the gate resets the flag, so re-enabling dials again.
func (r *Registry) Start() {
	r.mu.Lock()
	if r.started {
		r.mu.Unlock()
		return
	}
	enabled := r.enabled
	if !enabled {
		r.mu.Unlock()
		return
	}
	r.started = true
	peers := append([]PeerConfig(nil), r.peers...)
	r.mu.Unlock()

	for _, peer := range peers {
		if err := r.startPeer(peer); err != nil {
			r.logf("tunnel %s failed to start at boot: %v", peer.PeerID, err)
		}
	}
}

// startPeer builds a manager for one peer and attaches its connection.
func (r *Registry) startPeer(peer PeerConfig) error {
	activeCount := 0
	for _, fw := range peer.Forwards {
		if !fw.Disabled {
			activeCount++
		}
	}
	if activeCount == 0 {
		return nil
	}

	manager := NewManager(peer.PeerID, derefString(peer.PeerHostname), r.logf)
	updatedPin := false
	for i := range peer.Forwards {
		forward := &peer.Forwards[i]
		if forward.Disabled {
			continue
		}
		f, err := manager.AddForward(*forward)
		if err != nil {
			_ = manager.Close()
			return err
		}
		// Pin the assigned local port into tunnels.json so future reconnects and restarts
		// keep binding the exact same local port instead of picking a random port each time.
		if forward.LocalPort == 0 && f != nil && f.localPort > 0 {
			forward.LocalPort = f.localPort
			updatedPin = true
		}
	}
	if updatedPin {
		r.mu.Lock()
		for idx := range r.peers {
			if r.peers[idx].PeerID == peer.PeerID {
				r.peers[idx].Forwards = append([]ForwardConfig(nil), peer.Forwards...)
				break
			}
		}
		r.mu.Unlock()
		_ = r.save()
	}

	r.mu.Lock()
	if existing, ok := r.managers[peer.PeerID]; ok {
		_ = existing.Close()
	}
	r.managers[peer.PeerID] = manager
	factory := r.newPeer
	r.mu.Unlock()

	if factory == nil {
		// Production path: build the reconnector from the peer's own configuration.
		//
		// This is what the previous "no transport configured" early return replaced, and it is why
		// tunnels never worked: the listeners came up, reported "connecting", and nothing ever
		// dialled the peer. TunnelReconnector is a loop rather than one connection, so it drives the
		// manager through callbacks instead of returning a PeerConn.
		manager.SetPeerState(StateConnecting)
		r.runReconnector(peer, manager)
		return nil
	}
	peerConn, err := factory(peer)
	if err != nil {
		return err
	}
	manager.SetPeer(peerConn)
	return nil
}

// runReconnector dials a peer until the registry stops.
//
// The reconnector owns the reconnect loop, so it hands each live connection to the manager via
// OnPeer. OnState keeps the port rows honest between attempts: a peer whose relay is down reports
// disconnected rather than staying green from a connection that no longer exists.
func (r *Registry) runReconnector(peer PeerConfig, manager *Manager) {
	relayURL, err := relayURLFromPeer(peer)
	if err != nil {
		r.logf("tunnel %s: %v", peer.PeerID, err)
		manager.SetPeerState(StateError)
		return
	}

	reconnector := &TunnelReconnector{
		RelayURL:      relayURL,
		PeerServerID:  peer.PeerID,
		PeerPublicKey: peer.DaemonPublicKey,
		Token:         peer.Token,
		ClientID:      "byspace-tunnel",
		LocalKey:      r.localKey,
		OnPeer:        manager.SetPeer,
		OnState:       manager.SetPeerState,
		Logf:          r.logf,
	}

	ctx, cancel := context.WithCancel(r.ctx)
	r.mu.Lock()
	if previous, ok := r.cancellers[peer.PeerID]; ok {
		previous()
	}
	r.cancellers[peer.PeerID] = cancel
	r.mu.Unlock()

	go func() {
		reconnector.Run(ctx)
		r.mu.Lock()
		delete(r.cancellers, peer.PeerID)
		r.mu.Unlock()
	}()
}

// relayURLFromPeer reads the relay endpoint out of a peer's URL.
//
// tunnels.json stores the peer as a full URL (the same string the node daemon writes). The
// reconnector wants the base ws(s) URL without query parameters, and the scheme has to follow the
// TLS flag rather than being guessed from a port.
func relayURLFromPeer(peer PeerConfig) (string, error) {
	raw := strings.TrimSpace(peer.URL)
	if raw == "" {
		return "", errors.New("tunnel peer has no relay URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("tunnel peer URL %q: %w", raw, err)
	}
	switch u.Scheme {
	case "ws", "wss", "http", "https":
	default:
		return "", fmt.Errorf("tunnel peer URL %q has no usable scheme", raw)
	}
	host := u.Host
	if host == "" {
		host = u.Path
	}
	if host == "" {
		return "", fmt.Errorf("tunnel peer URL %q has no host", raw)
	}
	scheme := "wss"
	if u.Scheme == "ws" || u.Scheme == "http" {
		scheme = "ws"
	}
	return scheme + "://" + host, nil
}

// List reports every configured peer.
func (r *Registry) List() []PeerStatus {
	r.mu.Lock()
	enabled := r.enabled
	type snapshot struct {
		peer    PeerConfig
		manager *Manager
	}
	snapshots := make([]snapshot, 0, len(r.peers))
	for _, peer := range r.peers {
		snapshots = append(snapshots, snapshot{peer: peer, manager: r.managers[peer.PeerID]})
	}
	r.mu.Unlock()

	out := make([]PeerStatus, 0, len(snapshots))
	for _, item := range snapshots {
		status := PeerStatus{
			PeerID:       item.peer.PeerID,
			PeerHostname: item.peer.PeerHostname,
			Forwards:     []ForwardState{},
			State:        StateDisconnected,
		}
		if enabled {
			liveByEndpoint := make(map[string]ForwardState)
			if item.manager != nil {
				for _, st := range item.manager.Status() {
					liveByEndpoint[FormatEndpoint(st.RemoteHost, st.RemotePort)] = st
				}
			}
			for _, fw := range item.peer.Forwards {
				endpoint := FormatEndpoint(fw.RemoteHost, fw.RemotePort)
				if !fw.Disabled {
					if live, ok := liveByEndpoint[endpoint]; ok {
						status.Forwards = append(status.Forwards, live)
						continue
					}
				}
				status.Forwards = append(status.Forwards, ForwardState{
					RemotePort: fw.RemotePort,
					RemoteHost: fw.RemoteHost,
					LocalPort:  fw.LocalPort,
					ListenHost: fw.ListenHost,
					Label:      fw.Label,
					State:      StateDisconnected,
					Disabled:   fw.Disabled,
				})
			}
		}
		status.State = aggregateState(status.Forwards)
		for _, forward := range status.Forwards {
			if forward.LastError != "" {
				message := forward.LastError
				status.LastError = &message
				break
			}
		}
		out = append(out, status)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PeerID < out[j].PeerID })
	return out
}

// aggregateState folds per-port states into one, matching the node daemon: any error wins, then
// any connected, then connecting, otherwise disconnected.
func aggregateState(forwards []ForwardState) string {
	if len(forwards) == 0 {
		return StateDisconnected
	}
	sawConnecting := false
	sawConnected := false
	for _, forward := range forwards {
		switch forward.State {
		case StateError:
			return StateError
		case StateConnected:
			sawConnected = true
		case StateConnecting:
			sawConnecting = true
		}
	}
	switch {
	case sawConnected:
		return StateConnected
	case sawConnecting:
		return StateConnecting
	default:
		return StateDisconnected
	}
}

// inheritForward carries the fields an update does not restate. The destination (host and port) is
// the caller's; the local binding, label and paused state are not part of the edit form.
//
// keepDisabled is false for a merge that came from a toggle: that request states the state it wants.
func inheritForward(up ForwardConfig, old ForwardConfig, keepDisabled bool) ForwardConfig {
	if up.LocalPort == 0 && old.LocalPort > 0 {
		up.LocalPort = old.LocalPort
	}
	if up.ListenHost == "" && old.ListenHost != "" {
		up.ListenHost = old.ListenHost
	}
	if up.Label == "" && old.Label != "" {
		up.Label = old.Label
	}
	if keepDisabled && !up.Disabled {
		up.Disabled = old.Disabled
	}
	return up
}

// Add configures a peer or updates/merges forwards on an existing peer.
func (r *Registry) Add(peer PeerConfig) error {
	return r.AddOrUpdate(peer, ForwardConfig{})
}

// AddOrUpdate configures a peer or updates an existing peer's forwards. A replace entry with a
// positive RemotePort names one existing destination that the incoming forwards replace, which is
// how the edit sheet changes a host or port in place without re-entering credentials. The host is
// part of the identity: the same port on two different machines is two rules.
func (r *Registry) AddOrUpdate(peer PeerConfig, replace ForwardConfig) error {
	if peer.PeerID == "" {
		return fmt.Errorf("peerId is required")
	}
	if len(peer.Forwards) == 0 {
		return fmt.Errorf("at least one forward is required")
	}
	for i := range peer.Forwards {
		forward := &peer.Forwards[i]
		if err := ValidateRemoteHost(forward.RemoteHost); err != nil {
			return err
		}
		forward.RemoteHost = strings.TrimSpace(forward.RemoteHost)
		if forward.RemotePort < 1 || forward.RemotePort > 65535 {
			return fmt.Errorf("remotePort %d out of range", forward.RemotePort)
		}
		if forward.LocalPort < 0 || forward.LocalPort > 65535 {
			return fmt.Errorf("localPort %d out of range", forward.LocalPort)
		}
	}

	r.mu.Lock()
	replaced := false
	for index := range r.peers {
		if r.peers[index].PeerID == peer.PeerID {
			oldPeer := r.peers[index]
			if peer.URL == "" {
				peer.URL = oldPeer.URL
			}
			// The peer password is no longer kept. A tunnel is authorized by the target's grant for
			// this daemon's key, so a password left in an older tunnels.json is dropped on the next
			// edit rather than carried forward.
			if peer.PeerHostname == nil {
				peer.PeerHostname = oldPeer.PeerHostname
			}
			if peer.DaemonPublicKey == "" {
				peer.DaemonPublicKey = oldPeer.DaemonPublicKey
			}
			merged := make([]ForwardConfig, 0, len(oldPeer.Forwards)+len(peer.Forwards))
			incoming := make(map[string]ForwardConfig, len(peer.Forwards))
			for _, fw := range peer.Forwards {
				incoming[FormatEndpoint(fw.RemoteHost, fw.RemotePort)] = fw
			}
			replaceKey := ""
			if replace.RemotePort > 0 {
				replaceKey = FormatEndpoint(replace.RemoteHost, replace.RemotePort)
			}
			// An edit can move a rule onto a destination another rule already owns. Checked before the
			// merge and independent of the rules' order: the merge treats the incoming destination as
			// an update, so whichever of the two came second was silently consumed and the other
			// vanished from the list.
			if replaceKey != "" && len(peer.Forwards) > 0 {
				first := peer.Forwards[0]
				replacementKey := FormatEndpoint(first.RemoteHost, first.RemotePort)
				if replacementKey != replaceKey {
					for _, oldFw := range oldPeer.Forwards {
						oldKey := FormatEndpoint(oldFw.RemoteHost, oldFw.RemotePort)
						if oldKey != replaceKey && oldKey == replacementKey {
							r.mu.Unlock()
							return fmt.Errorf("a forward to %s already exists", replacementKey)
						}
					}
				}
			}
			for _, oldFw := range oldPeer.Forwards {
				oldKey := FormatEndpoint(oldFw.RemoteHost, oldFw.RemotePort)
				if replaceKey != "" && oldKey == replaceKey {
					if len(peer.Forwards) > 0 {
						first := peer.Forwards[0]
						firstKey := FormatEndpoint(first.RemoteHost, first.RemotePort)
						if up, ok := incoming[firstKey]; ok {
							// The replacement is a different destination, but the rule's local binding and
							// paused state were not part of the edit.
							merged = append(merged, inheritForward(up, oldFw, true))
							delete(incoming, firstKey)
						}
					}
					continue
				}
				if up, exists := incoming[oldKey]; exists {
					merged = append(merged, inheritForward(up, oldFw, false))
					delete(incoming, oldKey)
				} else {
					merged = append(merged, oldFw)
				}
			}
			for _, fw := range peer.Forwards {
				key := FormatEndpoint(fw.RemoteHost, fw.RemotePort)
				if up, still := incoming[key]; still {
					merged = append(merged, up)
					delete(incoming, key)
				}
			}
			// An edit can land on a destination another rule already uses (the edit sheet names the old
			// one, not the new). Two rules for one destination collide in the manager, which keys by
			// destination, so one of them would silently replace the other and leak its listener.
			seen := make(map[string]bool, len(merged))
			for _, fw := range merged {
				key := FormatEndpoint(fw.RemoteHost, fw.RemotePort)
				if seen[key] {
					r.mu.Unlock()
					return fmt.Errorf("a forward to %s already exists", key)
				}
				seen[key] = true
			}
			peer.Forwards = merged
			r.peers[index] = peer
			replaced = true
			break
		}
	}
	if !replaced {
		if peer.URL == "" {
			r.mu.Unlock()
			return fmt.Errorf("url is required")
		}
		r.peers = append(r.peers, peer)
	}
	enabled := r.enabled
	existing := r.managers[peer.PeerID]
	delete(r.managers, peer.PeerID)
	r.mu.Unlock()

	if existing != nil {
		_ = existing.Close()
	}
	if err := r.save(); err != nil {
		return err
	}
	if enabled {
		return r.startPeer(peer)
	}
	return nil
}

// PortUsedByHostRule reports whether this peer already forwards the port to another machine.
//
// A client from before host support omits remoteHost, so when the same port is also forwarded to a
// host, its request cannot say which rule it means. The handlers refuse that request instead of
// guessing (and mutating the loopback rule the user did not click).
func (r *Registry) PortUsedByHostRule(peerID string, port int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, peer := range r.peers {
		if peer.PeerID != peerID {
			continue
		}
		for _, forward := range peer.Forwards {
			if forward.RemotePort == port && CanonicalHost(forward.RemoteHost) != loopbackHost {
				return true
			}
		}
	}
	return false
}

// RemoveForward deletes one destination from a peer, or removes the entire peer when remotePort
// <= 0 or when it was the peer's last forward.
func (r *Registry) RemoveForward(peerID string, remoteHost string, remotePort int) error {
	if remotePort <= 0 {
		return r.Remove(peerID)
	}
	want := FormatEndpoint(remoteHost, remotePort)
	r.mu.Lock()
	var updatedPeer *PeerConfig
	for i := range r.peers {
		if r.peers[i].PeerID != peerID {
			continue
		}
		kept := make([]ForwardConfig, 0, len(r.peers[i].Forwards))
		for _, fw := range r.peers[i].Forwards {
			if FormatEndpoint(fw.RemoteHost, fw.RemotePort) != want {
				kept = append(kept, fw)
			}
		}
		if len(kept) == len(r.peers[i].Forwards) {
			r.mu.Unlock()
			return fmt.Errorf("tunnel forward %s not found", want)
		}
		if len(kept) == 0 {
			r.mu.Unlock()
			return r.Remove(peerID)
		}
		r.peers[i].Forwards = kept
		cp := r.peers[i]
		updatedPeer = &cp
		break
	}
	if updatedPeer == nil {
		r.mu.Unlock()
		return fmt.Errorf("tunnel peer %s not found", peerID)
	}
	enabled := r.enabled
	existing := r.managers[peerID]
	delete(r.managers, peerID)
	r.mu.Unlock()

	if existing != nil {
		_ = existing.Close()
	}
	if err := r.save(); err != nil {
		return err
	}
	if enabled {
		return r.startPeer(*updatedPeer)
	}
	return nil
}

// Remove deletes a peer and stops its manager.
func (r *Registry) Remove(peerID string) error {
	r.mu.Lock()
	found := false
	peers := make([]PeerConfig, 0, len(r.peers))
	for _, peer := range r.peers {
		if peer.PeerID == peerID {
			found = true
			continue
		}
		peers = append(peers, peer)
	}
	r.peers = peers
	manager := r.managers[peerID]
	delete(r.managers, peerID)
	cancel := r.cancellers[peerID]
	delete(r.cancellers, peerID)
	r.mu.Unlock()

	if !found {
		return fmt.Errorf("unknown peer %q", peerID)
	}
	if cancel != nil {
		cancel()
	}
	if manager != nil {
		_ = manager.Close()
	}
	return r.save()
}

// save writes tunnels.json atomically.
func (r *Registry) save() error {
	r.mu.Lock()
	file := registryFile{Version: 1, Peers: append([]PeerConfig(nil), r.peers...)}
	homeDir := r.homeDir
	r.mu.Unlock()

	// The file holds peer passwords, so it is written 0600 like the key files.
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(filepath.Join(homeDir, RegistryFilename), append(payload, '\n'), 0o600)
}

// Close stops every manager and every reconnector.
func (r *Registry) Close() {
	r.mu.Lock()
	managers := make([]*Manager, 0, len(r.managers))
	for id, manager := range r.managers {
		managers = append(managers, manager)
		delete(r.managers, id)
	}
	cancels := make([]context.CancelFunc, 0, len(r.cancellers))
	for id, cancel := range r.cancellers {
		cancels = append(cancels, cancel)
		delete(r.cancellers, id)
	}
	r.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	for _, manager := range managers {
		_ = manager.Close()
	}
}

// derefString reads an optional string.
func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
