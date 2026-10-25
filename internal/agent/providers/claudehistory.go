package providers

import (
	"os"
	"path/filepath"
	"strings"
)

// FindClaudeTranscript resolves a session id to the transcript Claude Code wrote for it.
//
// The session id alone is not enough to resume an imported conversation: the process has to be told
// which conversation, and the transport we drive (`--resume <id>`) makes the CLI look the id up in
// its own store — which the fixture transcripts in an e2e run are not part of. Reading the file
// directly is what Node's `resolveHistoryPath` does at session construction, and skipping it left an
// imported agent with an empty timeline until its first turn.
//
// The transcript lives under the project directory encoded from the cwd, so the cwd decides both
// where to look and which project the session belongs to. Both the configured path and its resolved
// form are tried: a daemon started through a symlink records the symlinked cwd while the SDK may
// have written the transcript under the real one.
func FindClaudeTranscript(sessionID, cwd, configDir string) string {
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" {
		return ""
	}
	if strings.HasSuffix(trimmed, ".jsonl") {
		if _, err := os.Stat(trimmed); err == nil {
			return trimmed
		}
		return ""
	}
	candidates := []string{}
	if trimmed := strings.TrimSpace(cwd); trimmed != "" {
		candidates = append(candidates, trimmed)
		if realCwd, err := filepath.EvalSymlinks(trimmed); err == nil && realCwd != trimmed {
			candidates = append(candidates, realCwd)
		}
	}
	for _, candidate := range candidates {
		path := filepath.Join(ClaudeProjectDir(candidate, configDir), sessionID+".jsonl")
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}
