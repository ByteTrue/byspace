package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeSession lays out a transcript under a project directory.
func writeSession(t *testing.T, root, project, sessionID string, entries []map[string]any) string {
	t.Helper()
	dir := filepath.Join(root, "projects", project)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, sessionID+".jsonl")
	var body []byte
	for _, entry := range entries {
		line, err := json.Marshal(entry)
		if err != nil {
			t.Fatal(err)
		}
		body = append(body, line...)
		body = append(body, '\n')
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// readEntries parses a written transcript for assertions.
func readEntries(t *testing.T, path string) []map[string]any {
	t.Helper()
	entries, err := readClaudeSessionEntries(path)
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

// A fork is a transcript-file operation, so Go can do it even though the SDK's forkSession is a JS function.
func TestForkClaudeSessionUpToMessage(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", root)
	source := "11111111-1111-4111-8111-111111111111"
	writeSession(t, root, "-repo", source, []map[string]any{
		{"type": "user", "uuid": "m1", "sessionId": source, "message": map[string]any{"role": "user"}},
		{"type": "assistant", "uuid": "m2", "sessionId": source, "parentUuid": "m1"},
		{"type": "user", "uuid": "m3", "sessionId": source, "parentUuid": "m2"},
		{"type": "assistant", "uuid": "m4", "sessionId": source, "parentUuid": "m3"},
	})

	forkedID, err := ForkClaudeSession(root, source, "m2")
	if err != nil {
		t.Fatal(err)
	}
	if forkedID == source {
		t.Fatal("the fork reused the source id")
	}

	path := filepath.Join(root, "projects", "-repo", forkedID+".jsonl")
	entries := readEntries(t, path)
	// The message itself stays plus the trailing title entry.
	if len(entries) != 2 {
		t.Fatalf("entries = %d", len(entries))
	}
	if entries[0]["sessionId"] != forkedID || entries[1]["sessionId"] != forkedID {
		t.Fatal("an entry kept the source session id")
	}
	// Every uuid is fresh: a shared one would make the daemon dedupe the fork away as the original.
	if entries[0]["uuid"] == "m1" || entries[1]["uuid"] == "m2" {
		t.Fatal("a uuid was reused")
	}
	// The parent link points at the remapped ancestor, not at a uuid that no longer exists.
	if entries[1]["parentUuid"] != entries[0]["uuid"] {
		t.Fatalf("parentUuid = %v, want %v", entries[1]["parentUuid"], entries[0]["uuid"])
	}
	// The fork records where it came from.
	forkedFrom, ok := entries[0]["forkedFrom"].(map[string]any)
	if !ok || forkedFrom["sessionId"] != source {
		t.Fatalf("forkedFrom = %v", entries[0]["forkedFrom"])
	}
}

// An empty upToMessageId copies the whole session, which is the SDK's documented behaviour.
func TestForkClaudeSessionWhole(t *testing.T) {
	root := t.TempDir()
	source := "22222222-2222-4222-8222-222222222222"
	writeSession(t, root, "-repo", source, []map[string]any{
		{"type": "user", "uuid": "a", "sessionId": source},
		{"type": "assistant", "uuid": "b", "sessionId": source, "parentUuid": "a"},
		{"type": "progress", "uuid": "p", "sessionId": source, "parentUuid": "b"},
		{"type": "assistant", "uuid": "c", "sessionId": source, "parentUuid": "p"},
	})
	forkedID, err := ForkClaudeSession(root, source, "")
	if err != nil {
		t.Fatal(err)
	}
	// readEntries only keeps forkable kinds, so the title entry is not counted — the assertion is on the messages.
	entries := readEntries(t, filepath.Join(root, "projects", "-repo", forkedID+".jsonl"))
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want the three messages (progress dropped)", len(entries))
	}
	for _, entry := range entries {
		if entry["type"] == "progress" {
			t.Fatal("a progress entry was copied")
		}
	}
	// The entry whose parent was a dropped progress marker links to the nearest surviving ancestor instead.
	if entries[2]["parentUuid"] != entries[1]["uuid"] {
		t.Fatalf("parentUuid = %v, want %v", entries[2]["parentUuid"], entries[1]["uuid"])
	}
}

// Sidechain entries belong to a sub-agent's transcript, not to the conversation being forked.
func TestForkClaudeSessionSkipsSidechain(t *testing.T) {
	root := t.TempDir()
	source := "33333333-3333-4333-8333-333333333333"
	writeSession(t, root, "-repo", source, []map[string]any{
		{"type": "user", "uuid": "a", "sessionId": source},
		{"type": "assistant", "uuid": "s", "sessionId": source, "isSidechain": true},
		{"type": "assistant", "uuid": "b", "sessionId": source, "parentUuid": "a"},
	})
	forkedID, err := ForkClaudeSession(root, source, "")
	if err != nil {
		t.Fatal(err)
	}
	entries := readEntries(t, filepath.Join(root, "projects", "-repo", forkedID+".jsonl"))
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want the two non-sidechain messages", len(entries))
	}
}

// A session may have been started in a directory the caller no longer knows; requiring cwd would make rewind fail for a
// conversation the user can see on screen.
func TestForkClaudeSessionFindsSessionAnywhere(t *testing.T) {
	root := t.TempDir()
	source := "44444444-4444-4444-8444-444444444444"
	writeSession(t, root, "-some-other-project", source, []map[string]any{
		{"type": "user", "uuid": "a", "sessionId": source},
	})
	if _, err := ForkClaudeSession(root, source, ""); err != nil {
		t.Fatalf("could not find the session: %v", err)
	}
}

// Unknown ids and messages are errors rather than silent empty forks.
func TestForkClaudeSessionErrors(t *testing.T) {
	root := t.TempDir()
	source := "55555555-5555-4555-8555-555555555555"
	writeSession(t, root, "-repo", source, []map[string]any{
		{"type": "user", "uuid": "a", "sessionId": source},
	})

	if _, err := ForkClaudeSession(root, "", ""); err == nil {
		t.Fatal("an empty session id must be refused")
	}
	if _, err := ForkClaudeSession(root, "66666666-6666-4666-8666-666666666666", ""); err == nil {
		t.Fatal("a missing session must be refused")
	}
	if _, err := ForkClaudeSession(root, source, "nope"); err == nil {
		t.Fatal("a missing message must be refused")
	}
}

// The id shape matters: the SDK validates session ids as UUIDs and Claude names its transcript files after them.
func TestNewClaudeSessionIDShape(t *testing.T) {
	id := newClaudeSessionID()
	if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		t.Fatalf("id = %q", id)
	}
	if id[14] != '4' {
		t.Fatalf("not a version 4 uuid: %q", id)
	}
	if id == newClaudeSessionID() {
		t.Fatal("ids repeat")
	}
}

func TestClaudeSessionFileExists(t *testing.T) {
	root := t.TempDir()
	source := "77777777-7777-4777-8777-777777777777"
	writeSession(t, root, "-repo", source, []map[string]any{{"type": "user", "uuid": "a", "sessionId": source}})

	if !ClaudeSessionFileExists(root, source) {
		t.Fatal("the session is on disk")
	}
	if ClaudeSessionFileExists(root, "88888888-8888-4888-8888-888888888888") {
		t.Fatal("a missing session was reported present")
	}
	if ClaudeSessionFileExists(root, "") {
		t.Fatal("an empty id was reported present")
	}
}
