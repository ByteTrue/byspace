package server

import (
	"strings"

	agentroles "github.com/ByteTrue/byspace/internal/agent/roles"
	"github.com/ByteTrue/byspace/internal/store"
)

// systemPromptFor composes the daemon-side prompt appended to the provider's own.
func (s *Server) systemPromptFor(rec store.AgentRecord) string {
	var parts []string
	// The role's prompt comes first: it defines what the agent is, and everything after it
	// (the client's own prompt, the daemon's append) refines that. Without this the label existed
	// and the behaviour did not.
	if roleName := rec.Labels[agentroles.RoleLabel]; roleName != "" {
		if prompt := agentroles.SystemPrompt(roleName); prompt != "" {
			parts = append(parts, prompt)
		}
	}
	if rec.Config != nil && rec.Config.SystemPrompt != nil && *rec.Config.SystemPrompt != "" {
		parts = append(parts, *rec.Config.SystemPrompt)
	}
	if cfg := s.store.LoadDaemonConfig(); cfg != nil {
		if appendPrompt, ok := cfg["appendSystemPrompt"].(string); ok && strings.TrimSpace(appendPrompt) != "" {
			parts = append(parts, appendPrompt)
		}
	}
	return agentroles.ComposeSystemPromptParts(parts...)
}
