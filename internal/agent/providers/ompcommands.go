package providers

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// ompBuiltinCommands are the slash commands omp handles itself.
//
// Ported from omp/commands.ts. They are not in the list omp's RPC reports, because the harness implements
// them rather than the agent: without them the app's command palette offers nothing for a session whose
// most useful actions are exactly these.
var ompBuiltinCommands = []pi.SlashCommand{
	{Name: "compact", Description: "Manually compact the session context", ArgumentHint: "[instructions]", Kind: "command"},
	{Name: "autocompact", Description: "Toggle automatic context compaction", ArgumentHint: "[on|off|toggle]", Kind: "command"},
	{Name: "handoff", Description: "Hand off from planning to implementation", ArgumentHint: "[instructions]", Kind: "command"},
	{Name: "steer", Description: "Steer the active OMP turn", ArgumentHint: "<message>", Kind: "command"},
	{Name: "follow-up", Description: "Queue a follow-up message for OMP", ArgumentHint: "<message>", Kind: "command"},
}

// MapOmpSlashCommands merges omp's reported commands over its built-in ones.
//
// Ported from mapOmpSlashCommands. The built-ins come first so the palette has an order; a command omp
// also reports replaces the entry but keeps the built-in argument hint, which is more specific than what
// the harness sends (it often sends none).
func MapOmpSlashCommands(commands []pi.SlashCommand) []pi.SlashCommand {
	merged := make([]pi.SlashCommand, 0, len(ompBuiltinCommands)+len(commands))
	indexByName := make(map[string]int, len(ompBuiltinCommands)+len(commands))

	for _, builtin := range ompBuiltinCommands {
		indexByName[builtin.Name] = len(merged)
		merged = append(merged, builtin)
	}

	for _, command := range commands {
		name := strings.TrimSpace(command.Name)
		if name == "" {
			continue
		}
		description := strings.TrimSpace(command.Description)
		kind := strings.TrimSpace(command.Kind)
		if kind == "" {
			kind = "command"
		}

		if index, exists := indexByName[name]; exists {
			existing := merged[index]
			hint := strings.TrimSpace(command.ArgumentHint)
			if hint == "" {
				// Keep the built-in hint: it names the argument's shape, and the harness usually
				// sends nothing.
				hint = existing.ArgumentHint
			}
			if description == "" {
				description = existing.Description
			}
			merged[index] = pi.SlashCommand{
				Name: name, Description: description, ArgumentHint: hint, Kind: kind,
			}
			continue
		}

		indexByName[name] = len(merged)
		merged = append(merged, pi.SlashCommand{
			Name: name, Description: description, ArgumentHint: command.ArgumentHint, Kind: kind,
		})
	}
	return merged
}
