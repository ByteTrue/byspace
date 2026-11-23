package providers

import (
	"context"
	"fmt"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// tryHandleCodexSlash transforms provider-owned commands before a literal slash turn can start.
func (s *CodexSession) tryHandleCodexSlash(ctx context.Context, message string) (bool, error) {
	trimmed := strings.TrimSpace(message)
	if !strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "//") {
		return false, nil
	}
	name, args, _ := strings.Cut(strings.TrimPrefix(trimmed, "/"), " ")
	name = strings.TrimSpace(name)
	args = strings.TrimSpace(args)
	if name == "" {
		return false, nil
	}
	if name == "compact" {
		s.mu.Lock()
		threadID := s.threadID
		s.mu.Unlock()
		_, err := s.rpcCall(ctx, "thread/compact/start", map[string]any{"threadId": threadID})
		return true, err
	}
	commands, err := s.GetCommands(ctx)
	if err != nil {
		return true, err
	}
	var selected *sdk.SlashCommand
	for i := range commands {
		if commands[i].Name == name {
			selected = &commands[i]
			break
		}
	}
	if selected == nil {
		return false, nil
	}
	s.mu.Lock()
	threadID := s.threadID
	s.mu.Unlock()
	switch selected.Source {
	case "builtin":
		switch name {
		case "compact":
			_, err := s.rpcCall(ctx, "thread/compact/start", map[string]any{"threadId": threadID})
			return true, err
		case "goal":
			return true, s.runCodexGoal(ctx, threadID, args)
		}
	case "prompt":
		body, ok := loadCodexCustomPrompt(codexHomeDir(), name)
		if !ok {
			return true, fmt.Errorf("codex prompt %q is no longer available", name)
		}
		return true, s.prompt(ctx, expandCodexCustomPrompt(body, args), nil, false)
	case "skill":
		s.mu.Lock()
		skill, ok := s.skills[name]
		s.mu.Unlock()
		if !ok {
			return true, fmt.Errorf("codex skill %q is no longer available", name)
		}
		s.mu.Lock()
		s.nextInputPrefix = []map[string]any{{"type": "skill", "name": name, "path": skill.path}}
		s.mu.Unlock()
		text := "$" + name
		if args != "" {
			text += " " + args
		}
		return true, s.prompt(ctx, text, nil, false)
	}
	return false, nil
}

func (s *CodexSession) listNativeSkills(ctx context.Context, cwd string) ([]codexSkill, error) {
	response, err := s.rpcCall(ctx, "skills/list", map[string]any{"cwds": []string{cwd}})
	if err != nil {
		return nil, err
	}
	data, _ := response["data"].([]any)
	result := make([]codexSkill, 0)
	for _, rawGroup := range data {
		group, _ := rawGroup.(map[string]any)
		rawSkills, _ := group["skills"].([]any)
		for _, rawSkill := range rawSkills {
			skill, _ := rawSkill.(map[string]any)
			name, _ := skill["name"].(string)
			path, _ := skill["path"].(string)
			description, _ := skill["description"].(string)
			if name == "" || path == "" || skill["enabled"] == false {
				continue
			}
			result = append(result, codexSkill{
				command: sdk.SlashCommand{Name: name, Description: description, Kind: "skill", Source: "skill"},
				path:    path,
			})
		}
	}
	return result, nil
}

func (s *CodexSession) runCodexGoal(ctx context.Context, threadID, args string) error {
	switch strings.ToLower(strings.TrimSpace(args)) {
	case "":
		return fmt.Errorf("usage: /goal <objective> | pause | resume | clear")
	case "clear":
		_, err := s.rpcCall(ctx, "thread/goal/clear", map[string]any{"threadId": threadID})
		return err
	case "pause":
		_, err := s.rpcCall(ctx, "thread/goal/set", map[string]any{"threadId": threadID, "status": "paused"})
		return err
	case "resume":
		_, err := s.rpcCall(ctx, "thread/goal/set", map[string]any{"threadId": threadID, "status": "active"})
		return err
	default:
		_, err := s.rpcCall(ctx, "thread/goal/set", map[string]any{"threadId": threadID, "objective": args, "status": "active"})
		return err
	}
}
