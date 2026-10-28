package server

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

// importedTranscript is everything an import needs from a provider's on-disk transcript: the record
// to create and the history to seed it with.
type importedTranscript struct {
	record  store.AgentRecord
	history []sdk.TimelineEntry
}

// importProviderTranscript builds an agent record from a provider session handle.
//
// Only Claude Code is handled: it is the one non-pi provider whose transcript the daemon can read
// back, and the handle the client sends is the session id Claude itself wrote, not a path — the
// transcript lives under an encoded directory the client never sees.
func (s *Server) importProviderTranscript(provider, handle, requestedCwd string) (importedTranscript, error) {
	if provider != "claude" {
		// A provider that cannot be probed still imports: the transcript is the caller's, and the
		// handle is only ever a label. Refusing here made the manual import form unusable for every
		// provider whose CLI is not installed, which is exactly when a user reaches for it.
		return s.importHandleOnlyRecord(provider, handle, requestedCwd)
	}
	transcript, err := findClaudeTranscript(handle)
	if err != nil {
		return importedTranscript{}, err
	}
	history, transcriptCwd, title, err := providers.LoadClaudeTranscript(transcript)
	if err != nil {
		return importedTranscript{}, err
	}
	if len(history) == 0 {
		return importedTranscript{}, errors.New("the Claude transcript has no messages to import")
	}
	cwd := strings.TrimSpace(requestedCwd)
	if cwd == "" {
		cwd = transcriptCwd
	}
	if cwd == "" {
		return importedTranscript{}, errors.New("the Claude transcript does not record a working directory")
	}
	_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		return importedTranscript{}, err
	}
	lastActivity := time.Now().UTC().Format(time.RFC3339Nano)
	if info, statErr := os.Stat(transcript); statErr == nil {
		lastActivity = info.ModTime().UTC().Format(time.RFC3339Nano)
	}
	return importedTranscript{
		record: store.AgentRecord{
			ID:          newAgentID(),
			Provider:    "claude",
			Cwd:         cwd,
			WorkspaceID: ws.WorkspaceID,
			CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
			UpdatedAt:   lastActivity,
			Title:       &title,
			LastStatus:  "idle",
			Persistence: &store.AgentPersistenceHandle{
				Provider:  "claude",
				SessionID: strings.TrimSuffix(handle, ".jsonl"),
				// The session id, not the transcript path: the provider resumes by id, and the
				// imported history is seeded from the transcript separately.
				NativeHandle: strings.TrimSuffix(handle, ".jsonl"),
			},
		},
		history: history,
	}, nil
}

// importFailureMessage turns a launch failure into something a user can act on.
//
// The import sheet shows the daemon's message as-is, so a raw `exec: "claude": executable file not
// found in $PATH` reads as a bug in BySpace rather than as a missing tool on this host.
func importFailureMessage(provider string, err error) string {
	if errors.Is(err, exec.ErrNotFound) || strings.Contains(err.Error(), "executable file not found") {
		return fmt.Sprintf("importing a %s session needs the %s command on this host's PATH", provider, provider)
	}
	return err.Error()
}

// findClaudeTranscript locates `<config>/projects/**\/<sessionId>.jsonl`.
//
// The session id is the file name, so the project directory does not have to be guessed from the
// cwd — which matters when the caller only has a handle.
func findClaudeTranscript(handle string) (string, error) {
	trimmed := strings.TrimSpace(handle)
	if trimmed == "" {
		return "", errors.New("an import needs the provider session handle")
	}
	if strings.HasSuffix(trimmed, ".jsonl") {
		if _, err := os.Stat(trimmed); err == nil {
			return trimmed, nil
		}
		return "", fmt.Errorf("no Claude transcript at %s", trimmed)
	}
	root := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		root = filepath.Join(home, ".claude")
	}
	projectsDir := filepath.Join(root, "projects")
	var found string
	_ = filepath.WalkDir(projectsDir, func(candidate string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || found != "" {
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".jsonl") && strings.TrimSuffix(entry.Name(), ".jsonl") == trimmed {
			found = candidate
		}
		return nil
	})
	if found == "" {
		return "", fmt.Errorf("no Claude transcript for session %s", trimmed)
	}
	return found, nil
}

// importHandleOnlyRecord creates an agent from a provider session handle with no transcript to read.
//
// The record is idle and empty. That is the honest state: the daemon knows the provider and the
// handle, and the provider itself owns whatever history the handle points at.
func (s *Server) importHandleOnlyRecord(provider, handle, requestedCwd string) (importedTranscript, error) {
	trimmed := strings.TrimSpace(handle)
	if trimmed == "" {
		return importedTranscript{}, errors.New("an import needs the provider session handle")
	}
	cwd := strings.TrimSpace(requestedCwd)
	if cwd == "" {
		return importedTranscript{}, errors.New("an import needs the working directory of the session")
	}
	_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		return importedTranscript{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return importedTranscript{
		record: store.AgentRecord{
			ID:          newAgentID(),
			Provider:    provider,
			Cwd:         cwd,
			WorkspaceID: ws.WorkspaceID,
			CreatedAt:   now,
			UpdatedAt:   now,
			LastStatus:  "idle",
			Persistence: &store.AgentPersistenceHandle{
				Provider:     provider,
				SessionID:    trimmed,
				NativeHandle: trimmed,
			},
		},
	}, nil
}

// providerSessionAlreadyImported reports whether an agent already owns this provider session.
//
// Importing the same session twice has to fail: the second agent would resume the same provider
// history and both would stream interleaved turns into different transcripts.
func (s *Server) providerSessionAlreadyImported(provider, handle string) bool {
	wanted := strings.TrimSpace(handle)
	if wanted == "" {
		return false
	}
	if trimmed := strings.TrimSuffix(wanted, ".jsonl"); trimmed != wanted {
		wanted = trimmed
	}
	agents, err := s.store.ListAgents()
	if err != nil {
		return false
	}
	for _, rec := range agents {
		if rec.Provider != provider || rec.Persistence == nil {
			continue
		}
		for _, candidate := range []string{rec.Persistence.SessionID, stringifyHandle(rec.Persistence.NativeHandle)} {
			trimmed := strings.TrimSpace(candidate)
			if trimmed == "" {
				continue
			}
			if trimmed == wanted || strings.TrimSuffix(trimmed, ".jsonl") == wanted {
				return true
			}
		}
	}
	return false
}

func stringifyHandle(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
