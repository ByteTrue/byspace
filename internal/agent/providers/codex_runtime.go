package providers

import (
	"context"
	"fmt"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *CodexSession) ArchiveNative(ctx context.Context, archived bool) error {
	s.mu.Lock()
	threadID := s.threadID
	s.mu.Unlock()
	method := "thread/unarchive"
	if archived {
		method = "thread/archive"
	}
	_, err := s.rpcCall(ctx, method, map[string]any{"threadId": threadID})
	return err
}

func (s *CodexSession) Capabilities() sdk.AgentCapabilities {
	capabilities := sdk.DefaultAgentCapabilities()
	capabilities.SupportsNativeArchive = true
	capabilities.SupportsHistoryImport = true
	capabilities.SupportsNativeSubagents = true
	return capabilities
}

// ProbeCodexModels reads the installed app-server catalog without creating a thread.
func ProbeCodexModels(ctx context.Context, command, cwd string, env []string) ([]sdk.CatalogModel, error) {
	s, err := probeCodexSession(ctx, command, cwd, env)
	if err != nil {
		return nil, err
	}
	defer s.Close()
	return s.GetAvailableModels(ctx)
}

func (s *CodexSession) GetAvailableModels(ctx context.Context) ([]sdk.CatalogModel, error) {
	response, err := s.rpcCall(ctx, "model/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	entries, _ := response["data"].([]any)
	if len(entries) == 0 {
		entries, _ = response["models"].([]any)
	}
	models := make([]sdk.CatalogModel, 0, len(entries))
	for _, raw := range entries {
		entry, _ := raw.(map[string]any)
		id, _ := entry["id"].(string)
		if id == "" {
			id, _ = entry["model"].(string)
		}
		if id == "" {
			continue
		}
		name, _ := entry["displayName"].(string)
		if name == "" {
			name = id
		}
		description, _ := entry["description"].(string)
		model := sdk.CatalogModel{Provider: "codex", ID: id, Label: name, Description: description, IsSelectable: true, IsDefault: entry["isDefault"] == true}
		model.DefaultThinkingOptionID, _ = entry["defaultReasoningEffort"].(string)
		efforts, _ := entry["supportedReasoningEfforts"].([]any)
		for _, rawEffort := range efforts {
			effort, _ := rawEffort.(map[string]any)
			level, _ := effort["reasoningEffort"].(string)
			optionDescription, _ := effort["description"].(string)
			if level != "" {
				model.ThinkingOptions = append(model.ThinkingOptions, sdk.ThinkingOption{ID: level, Label: level, Description: optionDescription, IsDefault: level == model.DefaultThinkingOptionID})
			}
		}
		models = append(models, model)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("codex model/list returned no models")
	}
	return models, nil
}
