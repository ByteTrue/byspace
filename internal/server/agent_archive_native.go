package server

import (
	"context"
	"fmt"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/store"
)

func (s *Server) nativeArchiveLaunchConfig(rec store.AgentRecord) providers.LaunchConfig {
	return providers.LaunchConfig{
		Provider: rec.Provider, ProviderConfig: s.providerConfigFor(rec.Provider),
		Cwd: rec.Cwd, SessionHandle: nativeSessionHandle(rec), Env: s.agentEnv(rec),
		ProviderOptions: providerOptionsOf(rec), HomeDir: s.homeDir,
	}
}

func (s *Server) archiveNativeRecord(ctx context.Context, rec store.AgentRecord) error {
	s.mu.Lock()
	mp := s.agents[rec.ID]
	s.mu.Unlock()
	if mp != nil && mp.session != nil {
		if native, ok := mp.session.(interface {
			ArchiveNative(context.Context, bool) error
		}); ok {
			return native.ArchiveNative(ctx, true)
		}
	}
	_, err := providers.ArchiveNativeSession(ctx, s.nativeArchiveLaunchConfig(rec))
	return err
}

func (s *Server) archiveAgentRecordsNative(ctx context.Context, records []store.AgentRecord) error {
	pending := make(map[string]bool, len(records))
	for _, rec := range records {
		if rec.ArchivedAt == nil {
			pending[rec.ID] = true
		}
	}
	for _, rec := range records {
		if rec.ArchivedAt != nil {
			continue
		}
		if parentID := parentAgentIDFromLabels(rec.Labels); parentID != "" && pending[parentID] {
			continue
		}
		if err := s.archiveAgentTreeNative(ctx, rec.ID); err != nil {
			return err
		}
	}
	return nil
}

// archiveAgentTreeNative completes every native archive before any local record changes.
// Detached children stay visible and therefore keep their native sessions as well.
func (s *Server) archiveAgentTreeNative(ctx context.Context, parentID string) error {
	parent, err := s.store.GetAgent(parentID)
	if err != nil {
		return err
	}
	if parent == nil {
		return fmt.Errorf("agent not found: %s", parentID)
	}
	records, err := s.store.ListAgents()
	if err != nil {
		return err
	}
	var archiveTree func(store.AgentRecord) error
	archiveTree = func(current store.AgentRecord) error {
		for _, child := range records {
			if child.ArchivedAt != nil || parentAgentIDFromLabels(child.Labels) != current.ID ||
				shouldDetachFromArchivedParent(current, child) {
				continue
			}
			if err := archiveTree(child); err != nil {
				return err
			}
		}
		return s.archiveNativeRecord(ctx, current)
	}
	return archiveTree(*parent)
}
