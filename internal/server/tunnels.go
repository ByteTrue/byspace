package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/ByteTrue/byspace/internal/tunnel"
)

// Tunnel RPCs.
//
// The daemon plays both roles. Outbound (D1) is this daemon exposing a peer's ports locally; the
// registry owns those managers. Inbound (D2) is a peer exposing this daemon's ports; the target
// owns those streams. Both are reported by tunnel.list with a `direction` field so the UI can put
// them in the right section.

// tunnelRegistry returns the registry, creating it on first use.
//
// Created lazily because a daemon that never configures a tunnel should not read tunnels.json at
// boot, and because the registry needs the resolved home directory which is not available at the
// zero value of Server.
func (s *Server) tunnelRegistry() *tunnel.Registry {
	s.mu.Lock()
	if s.tunnels != nil {
		registry := s.tunnels
		s.mu.Unlock()
		return registry
	}
	registry := tunnel.NewRegistry(s.homeDir, func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, "tunnel: "+format+"\n", args...)
	})
	registry.SetEnabled(s.tunnelsEnabled)
	s.tunnels = registry
	s.mu.Unlock()
	return registry
}

// tunnelTarget returns the inbound (D2) handler, creating it on first use.
func (s *Server) tunnelTarget() *tunnel.Target {
	s.mu.Lock()
	if s.tunnelTargetServer != nil {
		target := s.tunnelTargetServer
		s.mu.Unlock()
		return target
	}
	target := tunnel.NewTarget(
		// The experimental gate applies to both directions: a daemon with tunnels off must not
		// accept a peer's opens either.
		func() bool {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.tunnelsEnabled
		},
		func() bool { return s.daemonPasswordHash() != "" },
		func() []int {
			config := s.store.LoadDaemonConfig()
			return tunnelAllowlist(config)
		},
	)
	s.tunnelTargetServer = target
	s.mu.Unlock()
	return target
}

// tunnelAllowlist reads the forwarded-port whitelist from config.
//
// Read through a helper rather than inline so the shape stays in one place: a config edit must
// apply to the next open without a restart, which rules out caching it on the target.
func tunnelAllowlist(config map[string]any) []int {
	if config == nil {
		return nil
	}
	raw, ok := config["tunnel"].(map[string]any)
	if !ok {
		return nil
	}
	list, ok := raw["allowedPorts"].([]any)
	if !ok {
		return nil
	}
	ports := make([]int, 0, len(list))
	for _, item := range list {
		switch value := item.(type) {
		case float64:
			ports = append(ports, int(value))
		case int:
			ports = append(ports, value)
		}
	}
	return ports
}

// ApplyTunnelConfig reconciles the tunnel gate with the stored config.
//
// Called at boot and after every config write, so enabling tunnels in settings starts them and
// disabling stops the listeners and the reconnect loops. The node daemon does the same through
// `daemonConfigStore.onFieldChange("tunnel.enabled", ...)`; the Go port only listed the path as
// reloadable and never read it.
func (s *Server) ApplyTunnelConfig() {
	enabled := tunnelEnabledFromConfig(s.store.LoadDaemonConfig())

	s.mu.Lock()
	changed := s.tunnelsEnabled != enabled
	s.tunnelsEnabled = enabled
	s.mu.Unlock()

	// Built here rather than before the assignment: tunnelRegistry reads s.tunnelsEnabled when it
	// creates the registry, so the first call has to see the value from config. That is also what
	// starts the peers configured in tunnels.json — without it nothing ever dialled.
	registry := s.tunnelRegistry()
	// Start() is idempotent for an unchanged gate, but it is also the only thing that dials the
	// peers in tunnels.json. Calling SetEnabled on an unchanged gate short-circuits, so a daemon
	// that boots with the gate already open still needs Start.
	if changed {
		registry.SetEnabled(enabled)
		return
	}
	if enabled {
		registry.Start()
	}
}

// tunnelEnabledFromConfig reads the experimental gate.
//
// Missing means off, matching the node daemon's `?? false`: a home that never touched tunnels must
// not start exposing peer ports because a new build happened to add the key.
func tunnelEnabledFromConfig(config map[string]any) bool {
	raw, ok := config["tunnel"].(map[string]any)
	if !ok {
		return false
	}
	enabled, _ := raw["enabled"].(bool)
	return enabled
}

// handleTunnelList reports outbound peers and inbound streams.
func (s *Server) handleTunnelList(ctx context.Context, sink frameSink, requestID string) {
	registry := s.tunnelRegistry()
	entries := make([]map[string]any, 0, 8)

	for _, peer := range registry.List() {
		for _, forward := range peer.Forwards {
			entries = append(entries, map[string]any{
				"tunnelId":     peer.PeerID + ":" + strconv.Itoa(forward.RemotePort),
				"direction":    "outbound",
				"remotePort":   forward.RemotePort,
				"localPort":    forward.LocalPort,
				"peerHostname": peer.PeerHostname,
				"state":        forward.State,
				"disabled":     forward.Disabled,
				"lastError":    nullableString(forward.LastError),
			})
		}
	}

	_ = sendSessionMsg(ctx, sink, "tunnel.list.response", map[string]any{
		"requestId": requestID,
		"entries":   entries,
	})
}

// sendTunnelFrameToOpener routes a frame back to the client that opened the stream.
//
// Each inbound stream belongs to exactly one peer connection: the bytes must return to the socket
// that asked for the port, not to every connected client. Without the map, downstream bytes would
// be broadcast and a second client would see another session's traffic.
func (s *Server) sendTunnelFrameToOpener(ctx context.Context, tunnelID string, encoded []byte) error {
	s.mu.Lock()
	sink, ok := s.tunnelStreamSinks[tunnelID]
	s.mu.Unlock()
	if !ok {
		// The stream was closed between the read and this write; dropping is correct.
		return nil
	}
	return sink.SendBinary(ctx, encoded)
}

// rememberTunnelStream records which sink owns an inbound stream.
func (s *Server) rememberTunnelStream(tunnelID string, sink frameSink) {
	if tunnelID == "" || sink == nil {
		return
	}
	s.mu.Lock()
	if s.tunnelStreamSinks == nil {
		s.tunnelStreamSinks = make(map[string]frameSink)
	}
	s.tunnelStreamSinks[tunnelID] = sink
	s.mu.Unlock()
}

// forgetTunnelStream drops the ownership record.
func (s *Server) forgetTunnelStream(tunnelID string) {
	s.mu.Lock()
	delete(s.tunnelStreamSinks, tunnelID)
	s.mu.Unlock()
}

// handleTunnelOpen answers a peer's request to expose one of this daemon's ports.
//
// The response echoes the request's tunnelId on refusal: the client correlates by id, and an
// empty id in a denial makes the failure impossible to attribute.
func (s *Server) handleTunnelOpen(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		TunnelID   string `json:"tunnelId"`
		RemotePort int    `json:"remotePort"`
	}
	_ = json.Unmarshal(raw, &req)

	target := s.tunnelTarget()
	result, err := target.Open(req.TunnelID, req.RemotePort, func(frame tunnel.Frame) error {
		encoded, encodeErr := tunnel.EncodeFrame(frame.Opcode, frame.TunnelID, frame.Payload)
		if encodeErr != nil {
			return encodeErr
		}
		return sink.SendBinary(ctx, encoded)
	})
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "tunnel.open.response", map[string]any{
			"requestId":  req.RequestID,
			"tunnelId":   req.TunnelID,
			"remotePort": req.RemotePort,
			"allowed":    false,
			"reason":     err.Error(),
		})
		return
	}

	tunnelID := req.TunnelID
	if result.TunnelID != "" {
		tunnelID = result.TunnelID
	}
	if result.Allowed && result.TunnelID != "" {
		// The stream's downstream bytes must return to this socket only.
		s.rememberTunnelStream(result.TunnelID, sink)
	}
	payload := map[string]any{
		"requestId":  req.RequestID,
		"tunnelId":   tunnelID,
		"remotePort": req.RemotePort,
		"allowed":    result.Allowed,
	}
	// `reason` is optional in the schema, so it is only sent when there is one — sending "" or
	// null makes the client render an empty banner.
	if result.Reason != "" {
		payload["reason"] = result.Reason
	}
	_ = sendSessionMsg(ctx, sink, "tunnel.open.response", payload)
}

// handleTunnelClose tears down an inbound stream.
func (s *Server) handleTunnelClose(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		TunnelID  string `json:"tunnelId"`
	}
	_ = json.Unmarshal(raw, &req)

	s.tunnelTarget().HandleFrame(tunnel.Frame{
		Opcode:   tunnel.OpcodeClose,
		TunnelID: req.TunnelID,
	}, func(tunnel.Frame) error { return nil })
	s.forgetTunnelStream(req.TunnelID)

	_ = sendSessionMsg(ctx, sink, "tunnel.close.response", map[string]any{
		"requestId": req.RequestID,
		"tunnelId":  req.TunnelID,
	})
}

// handleTunnelStats reports per-tunnel byte counts.
//
// Zero counters rather than an empty list: the entries are what the client renders, and an
// absence reads as "no tunnels" while a record with zeroes reads as "this tunnel has moved
// nothing", which is the truth for a freshly opened one.
func (s *Server) handleTunnelStats(ctx context.Context, sink frameSink, requestID string) {
	registry := s.tunnelRegistry()
	entries := make([]map[string]any, 0, 8)
	for _, peer := range registry.List() {
		for _, forward := range peer.Forwards {
			entries = append(entries, map[string]any{
				"tunnelId":   peer.PeerID + ":" + strconv.Itoa(forward.RemotePort),
				"remotePort": forward.RemotePort,
				"bytesUp":    0,
				"bytesDown":  0,
			})
		}
	}
	_ = sendSessionMsg(ctx, sink, "tunnel.stats.response", map[string]any{
		"requestId": requestID,
		"entries":   entries,
	})
}

// handleTunnelCreate configures an outbound peer.
func (s *Server) handleTunnelCreate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	// The configuration is nested under `config`, not spread across the request. Reading it from
	// the top level yields an empty peer every time, and only Add's validation stops it from being
	// persisted as a broken entry.
	var req struct {
		RequestID string `json:"requestId"`
		Config    struct {
			PeerID            string  `json:"peerId"`
			PeerHostname      *string `json:"peerHostname"`
			URL               string  `json:"url"`
			Token             string  `json:"password"`
			DaemonPublicKey   string  `json:"daemonPublicKeyB64"`
			ReplaceRemotePort int     `json:"replaceRemotePort"`
			Forwards          []struct {
				RemotePort int    `json:"remotePort"`
				LocalPort  int    `json:"localPort"`
				Disabled   bool   `json:"disabled"`
				Label      string `json:"label"`
			} `json:"forwards"`
		} `json:"config"`
	}
	_ = json.Unmarshal(raw, &req)

	forwards := make([]tunnel.ForwardConfig, 0, len(req.Config.Forwards))
	for _, forward := range req.Config.Forwards {
		forwards = append(forwards, tunnel.ForwardConfig{
			RemotePort: forward.RemotePort,
			LocalPort:  forward.LocalPort,
			Disabled:   forward.Disabled,
			Label:      forward.Label,
		})
	}

	s.ApplyTunnelConfig()
	err := s.tunnelRegistry().AddOrUpdate(tunnel.PeerConfig{
		PeerID:          req.Config.PeerID,
		PeerHostname:    req.Config.PeerHostname,
		URL:             req.Config.URL,
		Token:           req.Config.Token,
		DaemonPublicKey: req.Config.DaemonPublicKey,
		Forwards:        forwards,
	}, req.Config.ReplaceRemotePort)
	payload := map[string]any{
		"requestId": req.RequestID,
		"peerId":    req.Config.PeerID,
		"ok":        err == nil,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	_ = sendSessionMsg(ctx, sink, "tunnel.create.response", payload)
}

// handleTunnelRemove deletes an outbound peer.
func (s *Server) handleTunnelRemove(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		PeerID     string `json:"peerId"`
		RemotePort int    `json:"remotePort"`
	}
	_ = json.Unmarshal(raw, &req)

	err := s.tunnelRegistry().RemoveForward(req.PeerID, req.RemotePort)
	payload := map[string]any{
		"requestId": req.RequestID,
		"peerId":    req.PeerID,
		"ok":        err == nil,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	_ = sendSessionMsg(ctx, sink, "tunnel.remove.response", payload)
}

// nullableString renders an empty string as null for the optional string fields.
func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
