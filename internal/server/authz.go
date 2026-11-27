package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

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

var agentCredentialPermissions = []string{"workspace.read", "workspace.write"}

func (s *Server) bindSinkAgentIdentity(sink frameSink, agentID string) {
	s.mu.Lock()
	if s.sinkAgentIDs == nil {
		s.sinkAgentIDs = make(map[frameSink]string)
	}
	if s.sinkPermissions == nil {
		s.sinkPermissions = make(map[frameSink][]string)
	}
	s.sinkAgentIDs[sink] = agentID
	s.sinkPermissions[sink] = append([]string(nil), agentCredentialPermissions...)
	s.mu.Unlock()
}

func (s *Server) bindAgentCredential(sink frameSink, credential string) bool {
	agentID, ok := s.agentIDForCredential(credential)
	if !ok {
		return false
	}
	s.bindSinkAgentIdentity(sink, agentID)
	return true
}

func (s *Server) verifiedChiefActor(sink frameSink, claimed string, requireBound bool) (string, error) {
	s.mu.Lock()
	agentID := s.sinkAgentIDs[sink]
	s.mu.Unlock()
	claimed = strings.TrimSpace(claimed)
	if agentID != "" {
		if claimed != "" && claimed != agentID {
			return "", errors.New("callerAgentId does not match authenticated agent identity")
		}
		return agentID, nil
	}
	if claimed != "" {
		return "", errors.New("callerAgentId requires an authenticated agent identity")
	}
	if requireBound {
		return "", errors.New("authenticated agent identity required")
	}
	return "", nil
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

// relayAuthIsPending reports whether this socket still has to prove a password.
//
// Relay sockets always do. A host with no daemon password still accepts a private agent
// credential, but refuses unauthenticated operator sessions in handleRelayPassword.
func (s *Server) relayAuthIsPending(sink frameSink) bool {
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
	delete(s.sinkAgentIDs, sink)
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
// An agent credential binds only that agent identity. Without one, a daemon with no password
// refuses operator access because its pairing offer would otherwise be sufficient for control.
// The right daemon password grants the owner set. A wrong credential closes the socket rather
// than leaving it half-authenticated.
func (s *Server) handleRelayPassword(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Password  string `json:"password"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		_ = sink.Close(wsCloseRelayAuthRequired, "Password required")
		return
	}
	if agentID, ok := s.agentIDForCredential(req.Password); ok {
		s.relayAuthResolved(sink)
		s.bindSinkAgentIdentity(sink, agentID)
		s.mu.Lock()
		if _, tracked := s.clients[sink]; tracked {
			s.clients[sink] = true
		}
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, sink, "auth.password.submit.response", map[string]any{
			"requestId": req.RequestID,
			"ok":        true,
		})
		return
	}
	hash := s.daemonPasswordHash()
	if hash == "" || !s.authorizedByDaemonCredential(s.homeDir, req.Password) {
		// Answer before closing. A bare disconnect leaves the app showing "connection failed"
		// with no idea that a password was asked for and refused.
		reason := "Wrong daemon password."
		if hash == "" {
			reason = "This host has no daemon password set."
		}
		// The relay turns this close into "Server disconnected", so the reason travels to the client
		// inside the response and nowhere else. Without this line the daemon side says nothing at
		// all about a refused relay session.
		slog.Warn("relay session refused", "reason", reason, "submitted", len(req.Password) > 0)
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
