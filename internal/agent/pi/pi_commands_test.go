package pi

import "testing"

// Pi reports its own `source` and `input.hint`; a skill that arrives labelled a command is dropped from
// the composer's inline "/" list, and a command with no hint looks argument-free.
func TestMapPiCommandsCarriesSourceAndHint(t *testing.T) {
	var hint struct {
		Hint string `json:"hint"`
	}
	hint.Hint = "<file>"
	commands := mapPiCommands([]piRPCCommand{
		{Name: "review", Description: "Review the diff", Source: "skill", Input: &hint},
		{Name: "deploy", Source: "extension"},
		{Name: "compact", Description: "pi's own answer", Source: "extension"},
		{Name: "  ", Source: "extension"},
	})

	byName := map[string]SlashCommand{}
	for _, command := range commands {
		byName[command.Name] = command
	}
	if got := byName["review"]; got.Kind != "skill" || got.ArgumentHint != "<file>" {
		t.Fatalf("review = %#v, want a skill with its hint", got)
	}
	if got := byName["deploy"]; got.Kind != "command" || got.Description != "extension" {
		t.Fatalf("deploy = %#v, want a command described by its source", got)
	}
	// The builtin is seeded first and keeps its own hint; pi never lists it.
	if len(commands) != 4 {
		t.Fatalf("got %d commands: %#v", len(commands), commands)
	}
	if commands[0].Name != "compact" || commands[0].ArgumentHint != "[instructions]" {
		t.Fatalf("first command = %#v, want the seeded compact", commands[0])
	}
}
