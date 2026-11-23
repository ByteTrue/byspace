package server

import (
	"context"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
)

// A draft has no agent, so its commands can only come from a provider session started for the
// draft's own provider and model. Answering from an empty list is what left "/" blank in the
// new-agent composer.
func TestListDraftCommandsAsksTheDraftProvider(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	commands, errText := srv.listCommands(context.Background(), "new-workspace", map[string]any{
		"provider": providers.MockProviderID,
		"model":    providers.MockDefaultModelID,
		"cwd":      t.TempDir(),
	})
	if errText != nil {
		t.Fatalf("unexpected error: %v", errText)
	}
	if len(commands) != 1 || commands[0].Name != "handled-command" {
		t.Fatalf("got %#v, want the mock provider's own command", commands)
	}
}

// Without a model there is nothing to ask: spawning a provider would answer for a choice the user
// has not made.
func TestListDraftCommandsSkipsWithoutModel(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	commands, errText := srv.listCommands(context.Background(), "", map[string]any{
		"provider": providers.MockProviderID,
		"cwd":      t.TempDir(),
	})
	if errText != nil {
		t.Fatalf("unexpected error: %v", errText)
	}
	if len(commands) != 0 {
		t.Fatalf("got %#v, want no commands", commands)
	}
}

func TestListDraftCommandsReportsUnavailableProvider(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	_, errText := srv.listCommands(context.Background(), "", map[string]any{
		"provider": "not-installed",
		"model":    "some-model",
		"cwd":      t.TempDir(),
	})
	if errText == nil {
		t.Fatal("want an error naming the missing provider")
	}
}
