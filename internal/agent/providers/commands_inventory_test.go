package providers

import "testing"

// Claude Code lists its own `__`-prefixed server commands alongside the user's skills; a user cannot
// run them, so they must not reach the palette.
func TestClaudeCommandsFromInitSkipsInternalAndClassifies(t *testing.T) {
	commands := claudeCommandsFromInit(map[string]any{
		"subtype":        "init",
		"slash_commands": []any{"/compact", "__remote-workflow", "brainstorm", "compact", "clear", "  "},
	})
	if len(commands) != 3 {
		t.Fatalf("got %#v, want three unique commands", commands)
	}
	if commands[0].Name != "brainstorm" || commands[0].Kind != "skill" {
		t.Fatalf("commands[0] = %#v, want the skill first", commands[0])
	}
	if commands[1].Name != "clear" || commands[1].Kind != "command" {
		t.Fatalf("commands[1] = %#v, want a root-only command", commands[1])
	}
	if commands[2].Name != "compact" || commands[2].Kind != "command" {
		t.Fatalf("commands[2] = %#v, want a root-only command", commands[2])
	}
}

// Kiro reports built-ins under `commands` and skills under `prompts`; reading only the first list
// left every Kiro skill out of the composer.
func TestMapKiroAvailableCommandsReadsPrompts(t *testing.T) {
	commands := mapKiroAvailableCommands(
		[]any{map[string]any{"name": "/agent", "description": "Switch agent"}},
		[]any{
			map[string]any{"name": "review", "serverName": "skill:review", "meta": map[string]any{"hint": "<path>"}},
			map[string]any{"name": "/agent"},
		},
	)
	if len(commands) != 2 {
		t.Fatalf("got %#v, want the built-in and the skill", commands)
	}
	if commands[0].Name != "agent" || commands[0].Kind != "command" {
		t.Fatalf("commands[0] = %#v", commands[0])
	}
	if commands[1].Name != "review" || commands[1].Kind != "skill" || commands[1].ArgumentHint != "<path>" {
		t.Fatalf("commands[1] = %#v, want a skill with its hint", commands[1])
	}
}
