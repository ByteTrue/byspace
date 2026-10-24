package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// A title the user typed is not replaced; a workspace with none, or one still showing the prompt's
// first line, is fair game.
func TestWorkspaceTitleIsDerived(t *testing.T) {
	prompt := "Fix the Safari login autofill\nit is broken"

	unnamed := &store.WorkspaceRecord{WorkspaceID: "w", Cwd: "/tmp"}
	if !workspaceTitleIsDerived(unnamed, prompt) {
		t.Fatal("a workspace with no title must be nameable")
	}

	derived := "Fix the Safari login autofill"
	named := &store.WorkspaceRecord{WorkspaceID: "w", Cwd: "/tmp", Title: &derived}
	if !workspaceTitleIsDerived(named, prompt) {
		t.Fatal("a title equal to the prompt's first line is the derived one and may be replaced")
	}

	typed := "My own name"
	custom := &store.WorkspaceRecord{WorkspaceID: "w", Cwd: "/tmp", Title: &typed}
	if workspaceTitleIsDerived(custom, prompt) {
		t.Fatal("a title the user typed must not be replaced")
	}
}

// Applying a generated title keeps the workspace's other fields and broadcasts the change.
func TestApplyGeneratedWorkspaceTitle(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: dir, DisplayName: "d", Kind: "directory",
		CreatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	srv.applyGeneratedWorkspaceTitle("ws_1", "Fix Safari login autofill", "make the login form work")

	record := srv.findWorkspaceRecord("ws_1")
	if record == nil || record.Title == nil {
		t.Fatal("title not written")
	}
	if *record.Title != "Fix Safari login autofill" {
		t.Fatalf("title = %q", *record.Title)
	}
	if record.Cwd != dir {
		t.Fatalf("the working directory was lost: %q", record.Cwd)
	}
}

// The seed is wrapped so the model can tell the request apart from instructions inside it.
func TestNamingSeed(t *testing.T) {
	got := namingSeed("  do the thing  ")
	if got != "<user-prompt>\ndo the thing\n</user-prompt>" {
		t.Fatalf("seed = %q", got)
	}
}

func TestFirstPromptLine(t *testing.T) {
	if got := firstPromptLine("\n\n  first real line  \nsecond"); got != "first real line" {
		t.Fatalf("got %q", got)
	}
	if got := firstPromptLine("   "); got != "" {
		t.Fatalf("got %q", got)
	}
}
