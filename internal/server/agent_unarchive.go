package server

import (
	"context"
	"fmt"
	"os"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/store"
)

func nativeSessionHandle(rec store.AgentRecord) string {
	if rec.Persistence == nil {
		return ""
	}
	if handle, ok := rec.Persistence.NativeHandle.(string); ok && handle != "" {
		return handle
	}
	if rec.Persistence.SessionID != "" {
		if _, err := os.Stat(rec.Persistence.SessionID); err == nil {
			return rec.Persistence.SessionID
		}
	}
	return ""
}

// unarchiveAgent restores the native thread before exposing the local record as
// runnable. A failed native unarchive therefore leaves both sides archived.
func (s *Server) unarchiveAgent(ctx context.Context, agentID string) (*store.AgentRecord, error) {
	rec, err := s.store.GetAgent(agentID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}
	if rec.ArchivedAt == nil {
		return rec, nil
	}
	_, err = providers.UnarchiveNativeSession(ctx, providers.LaunchConfig{
		Provider:        rec.Provider,
		ProviderConfig:  s.providerConfigFor(rec.Provider),
		Cwd:             rec.Cwd,
		SessionHandle:   nativeSessionHandle(*rec),
		Env:             s.agentEnv(*rec),
		ProviderOptions: providerOptionsOf(*rec),
		HomeDir:         s.homeDir,
	})
	if err != nil {
		return nil, err
	}
	unarchived, err := s.store.UnarchiveAgent(agentID)
	if err != nil {
		return nil, err
	}
	if unarchived != nil {
		s.broadcastAgentUpdate(*unarchived)
	}
	return unarchived, nil
}
