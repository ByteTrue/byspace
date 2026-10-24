package server

import (
	"context"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/naming"
	"github.com/ByteTrue/byspace/internal/store"
)

// scheduleWorkspaceAutoName generates a title for a workspace from its first agent's prompt.
//
// Ported from workspace-auto-name.ts. A worktree or directory created from a request has no title
// until the user types one, and the sidebar then shows a directory name or a slug. One model call at
// the moment the first prompt exists is exactly when the information is available, and it is the
// difference between a sidebar of "wt-m4b2c8" and one of "Fix Safari login autofill".
//
// Runs in the background and never fails the create: the agent's work must not wait on a naming call,
// and a provider that cannot be reached should cost a title, not an agent.
func (s *Server) scheduleWorkspaceAutoName(workspaceID, cwd, prompt string) {
	if strings.TrimSpace(prompt) == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		record := s.findWorkspaceRecord(workspaceID)
		if record == nil {
			return
		}
		// A title the user typed is not replaced. The prompt-derived title only fills a workspace
		// that has none, or one still showing the prompt's own first line.
		if !workspaceTitleIsDerived(record, prompt) {
			return
		}

		generator := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel(), Overrides: naming.ReadProjectOverrides(cwd)}
		generated, err := generator.Generate(ctx, namingSeed(prompt))
		if err != nil || strings.TrimSpace(generated.Title) == "" {
			// Nothing to do. The workspace keeps its derived name, which is what it would have had
			// anyway.
			return
		}

		s.applyGeneratedWorkspaceTitle(workspaceID, generated.Title, prompt)
	}()
}

// workspaceTitleIsDerived reports whether a workspace still carries a generated title.
//
// A nil title means nobody has named it. A title equal to the prompt's first line is what the create
// path wrote, so replacing it is an improvement rather than an override.
func workspaceTitleIsDerived(record *store.WorkspaceRecord, prompt string) bool {
	if record == nil {
		return false
	}
	if record.Title == nil || strings.TrimSpace(*record.Title) == "" {
		return true
	}
	return *record.Title == firstPromptLine(prompt)
}

// firstPromptLine is what the create path would have used as a provisional title.
func firstPromptLine(prompt string) string {
	for _, line := range strings.Split(strings.ReplaceAll(prompt, "\r\n", "\n"), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// namingSeed is the input the branch-name generator expects.
//
// Wrapped in the same `<user-prompt>` tags the node implementation uses so the model can tell the
// request apart from any instructions inside it.
func namingSeed(prompt string) string {
	return "<user-prompt>\n" + strings.TrimSpace(prompt) + "\n</user-prompt>"
}

// applyGeneratedWorkspaceTitle writes a generated title, keeping the workspace's other fields.
func (s *Server) applyGeneratedWorkspaceTitle(workspaceID, title, prompt string) {
	record := s.findWorkspaceRecord(workspaceID)
	if record == nil {
		return
	}
	// Re-check under the write: the user may have typed a title while the model was thinking.
	if !workspaceTitleIsDerived(record, prompt) {
		return
	}
	updated := *record
	trimmed := strings.TrimSpace(title)
	updated.Title = &trimmed
	updated.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.store.UpsertWorkspace(updated); err != nil {
		return
	}
	if project, ok := s.projectForWorkspace(updated.ProjectID); ok {
		s.broadcastWorkspaceUpsert(updated, project)
	}
}
