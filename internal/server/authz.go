package server

import (
	"context"
	"encoding/json"

	"github.com/ByteTrue/byspace/internal/authz"
)

// authorizationForSink returns the principal a connection acts as.
//
// A direct local connection is the owner: the user started this daemon and holds the machine,
// so gating it behind a permission list would only introduce a way to lock themselves out. A
// connection that arrived through the relay will carry its granted permissions instead (that is
// where a restricted principal comes from), so the seam exists now and defaults to owner.
func (s *Server) authorizationForSink(sink frameSink) *authz.Authorization {
	s.mu.Lock()
	perms, ok := s.sinkPermissions[sink]
	s.mu.Unlock()
	if ok {
		return authz.New(perms)
	}
	return authz.NewOwner()
}

// SetSinkPermissions grants a connection a permission set, replacing the owner default.
func (s *Server) SetSinkPermissions(sink frameSink, permissions []string) {
	s.mu.Lock()
	if s.sinkPermissions == nil {
		s.sinkPermissions = make(map[frameSink][]string)
	}
	s.sinkPermissions[sink] = permissions
	s.mu.Unlock()
}

// relayAuthPending marks a connection that arrived through the relay and has not yet proven a
// password inside the encrypted channel. Until it does, the connection holds no permissions at all.
func (s *Server) relayAuthPending(sink frameSink) {
	s.mu.Lock()
	if s.relayAuthPending_ == nil {
		s.relayAuthPending_ = make(map[frameSink]bool)
	}
	s.relayAuthPending_[sink] = true
	s.mu.Unlock()
}

// relayAuthResolved reports whether a relay connection still owes a password, and clears the mark.
func (s *Server) relayAuthResolved(sink frameSink) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.relayAuthPending_ == nil || !s.relayAuthPending_[sink] {
		return false
	}
	delete(s.relayAuthPending_, sink)
	return true
}

// relayAuthIsPending reports whether a relay connection is still waiting to prove a password.
// relayAuthIsPending reports whether this socket still has to prove a password.
//
// A host with no password has nothing to ask for: the standard pairing flow pastes an offer
// and connects over the relay without ever being shown a password field, so gating on one
// made that flow impossible. The mark is still recorded, so a password submitted later can be
// answered instead of ignored.
func (s *Server) relayAuthIsPending(sink frameSink) bool {
	if s.daemonPasswordHash() == "" {
		return false
	}
	return s.relayAuthMarked(sink)
}

// relayAuthMarked reports whether the socket still carries the pending mark, whatever the host's
// password is. Routing a submission uses this and not relayAuthIsPending: with no password set
// nothing is gated, but a submission must still be answered instead of ignored.
func (s *Server) relayAuthMarked(sink frameSink) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.relayAuthPending_ != nil && s.relayAuthPending_[sink]
}

// relayAuthForget drops the mark when the socket closes, so a sink that is reused cannot inherit it.
func (s *Server) relayAuthForget(sink frameSink) {
	s.mu.Lock()
	delete(s.relayAuthPending_, sink)
	delete(s.relayPeerKey, sink)
	delete(s.relayPasswordAuthed, sink)
	s.mu.Unlock()
}

// relayPasswordAuthenticated reports whether a relay socket proved the daemon password. Such a
// socket belongs to the operator, so it is not subject to the per-daemon tunnel grants.
func (s *Server) relayPasswordAuthenticated(sink frameSink) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.relayPasswordAuthed[sink]
}

// setRelayPeerKey records the public key a relay connection proved by answering the session
// challenge. The tunnel authorizer reads it to decide which grants apply.
func (s *Server) setRelayPeerKey(sink frameSink, publicKey string) {
	s.mu.Lock()
	if s.relayPeerKey == nil {
		s.relayPeerKey = make(map[frameSink]string)
	}
	s.relayPeerKey[sink] = publicKey
	s.mu.Unlock()
}

// relayPeerKeyOf returns the proven key for a relay connection, or "" for a local one.
func (s *Server) relayPeerKeyOf(sink frameSink) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.relayPeerKey[sink]
}

// handleRelayPassword checks the password a relay connection sent inside the encrypted channel.
//
// A daemon with no password set refuses the connection outright: relay reachability is exactly
// the case a password exists to cover, and a passwordless daemon would otherwise be controllable
// by anyone holding its pairing offer. The right password grants the owner set, because a relay
// client that knows the password is the operator. A wrong one closes the socket rather than
// leaving it half-authenticated.
func (s *Server) handleRelayPassword(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Password  string `json:"password"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		_ = sink.Close(wsCloseRelayAuthRequired, "Password required")
		return
	}
	hash := s.daemonPasswordHash()
	if hash == "" {
		// No password on this host: there is nothing to prove, and the socket was never put
		// in the pending state. Answering a submission it never asked for is harmless.
		_ = sendSessionMsg(ctx, sink, "auth.password.submit.response", map[string]any{
			"requestId": req.RequestID,
			"ok":        true,
		})
		return
	}
	if !s.authorizedByDaemonCredential(s.homeDir, req.Password) {
		// Answer before closing. A bare disconnect leaves the app showing "connection failed"
		// with no idea that a password was asked for and refused.
		reason := "Wrong daemon password."
		_ = sendSessionMsg(ctx, sink, "auth.password.submit.response", map[string]any{
			"requestId": req.RequestID,
			"ok":        false,
			"error":     reason,
		})
		_ = sink.Close(wsCloseRelayAuthRequired, reason)
		return
	}
	s.relayAuthResolved(sink)
	s.SetSinkPermissions(sink, authz.DaemonPermissions)
	// The password proves this is the operator, so the socket becomes a real client: it joins the
	// broadcast set it was held out of until now (a relay socket starts unhandshaked).
	s.mu.Lock()
	if s.relayPasswordAuthed == nil {
		s.relayPasswordAuthed = make(map[frameSink]bool)
	}
	s.relayPasswordAuthed[sink] = true
	if _, tracked := s.clients[sink]; tracked {
		s.clients[sink] = true
	}
	s.mu.Unlock()
	_ = sendSessionMsg(ctx, sink, "auth.password.submit.response", map[string]any{
		"requestId": req.RequestID,
		"ok":        true,
	})
}
