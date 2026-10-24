package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// The built-ins are what omp's harness implements rather than the agent, so its RPC does not report them.
// Without them the palette offers nothing for a session whose most useful actions are exactly these.
func TestMapOmpSlashCommandsIncludesBuiltins(t *testing.T) {
	got := MapOmpSlashCommands(nil)
	if len(got) != len(ompBuiltinCommands) {
		t.Fatalf("commands = %d", len(got))
	}
	byName := make(map[string]pi.SlashCommand, len(got))
	for _, command := range got {
		byName[command.Name] = command
	}
	for _, name := range []string{"compact", "autocompact", "handoff", "steer", "follow-up"} {
		if _, ok := byName[name]; !ok {
			t.Fatalf("missing %q", name)
		}
	}
	if byName["autocompact"].ArgumentHint != "[on|off|toggle]" {
		t.Fatalf("hint = %q", byName["autocompact"].ArgumentHint)
	}
}

// A command omp also reports replaces the entry but keeps the built-in argument hint, which is more
// specific than what the harness sends (it often sends none).
func TestMapOmpSlashCommandsMergeKeepsHint(t *testing.T) {
	got := MapOmpSlashCommands([]pi.SlashCommand{
		{Name: "compact", Description: "Compact now", Source: "builtin"},
		{Name: "newcmd", Description: "Something new", ArgumentHint: "<x>"},
	})
	byName := make(map[string]pi.SlashCommand, len(got))
	for _, command := range got {
		byName[command.Name] = command
	}

	compact := byName["compact"]
	if compact.Description != "Compact now" {
		t.Fatalf("the reported description did not win: %+v", compact)
	}
	if compact.ArgumentHint != "[instructions]" {
		t.Fatalf("the built-in hint was lost: %q", compact.ArgumentHint)
	}

	// A command omp adds appears after the built-ins, with its own hint.
	if byName["newcmd"].ArgumentHint != "<x>" {
		t.Fatalf("newcmd = %+v", byName["newcmd"])
	}
	if len(got) != len(ompBuiltinCommands)+1 {
		t.Fatalf("commands = %d", len(got))
	}
	// Every entry has a kind, since the protocol's default applies only when the field is absent.
	for _, command := range got {
		if command.Kind == "" {
			t.Fatalf("%q has no kind", command.Name)
		}
	}
}

// An unnamed command is dropped rather than becoming a blank palette entry.
func TestMapOmpSlashCommandsDropsUnnamed(t *testing.T) {
	got := MapOmpSlashCommands([]pi.SlashCommand{{Name: "  "}, {Name: "real"}})
	for _, command := range got {
		if command.Name == "" {
			t.Fatal("an unnamed command was kept")
		}
	}
}
