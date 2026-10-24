package providers

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// claudeForkKinds are the entry types a fork copies.
//
// Ported from the SDK's forkSession. A transcript holds bookkeeping alongside messages — atis latches, relocation records,
// content replacements — and copying those into a new session makes the fork inherit state it did not earn.
var claudeForkKinds = map[string]bool{
	"user": true, "assistant": true, "attachment": true, "system": true, "progress": true,
}

// ForkClaudeSession creates a new session that is a copy of `sessionID` up to a message.
//
// Ported from the Claude Agent SDK's `forkSession`, which is a transcript-file operation rather than a daemon call — the
// SDK exposes it as a function, but nothing in the CLI protocol implements it. That means Go can do it too: read the
// session's `.jsonl`, keep the entries up to the message, give each a fresh uuid, and write a new file.
//
// Returns the new session id. An empty `upToMessageID` copies the whole session, which is the SDK's documented behaviour.
func ForkClaudeSession(configDir, sessionID, upToMessageID string) (string, error) {
	if strings.TrimSpace(sessionID) == "" {
		return "", errors.New("fork needs a session id")
	}
	root := resolveClaudeConfigDir(configDir)
	sourcePath, err := findClaudeSessionFile(root, sessionID)
	if err != nil {
		return "", err
	}

	entries, err := readClaudeSessionEntries(sourcePath)
	if err != nil {
		return "", err
	}

	// Sidechain entries belong to a sub-agent's transcript, not to the conversation being forked.
	conversation := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if sidechain, _ := entry["isSidechain"].(bool); sidechain {
			continue
		}
		conversation = append(conversation, entry)
	}
	if len(conversation) == 0 {
		return "", fmt.Errorf("session %s has no messages to fork", sessionID)
	}

	if trimmed := strings.TrimSpace(upToMessageID); trimmed != "" {
		index := -1
		for i, entry := range conversation {
			if entryUUID, _ := entry["uuid"].(string); entryUUID == trimmed {
				index = i
				break
			}
		}
		if index < 0 {
			return "", fmt.Errorf("message %s not found in session %s", trimmed, sessionID)
		}
		// The message itself stays: a rewind to a message keeps the turn that produced it.
		conversation = conversation[:index+1]
	}

	forkedID := newClaudeSessionID()
	if err := writeForkedClaudeSession(sourcePath, forkedID, sessionID, conversation); err != nil {
		return "", err
	}
	return forkedID, nil
}

// findClaudeSessionFile locates a session's transcript under any project directory.
//
// Searching all project directories rather than computing one: a session may have been started in a directory the caller
// no longer knows, and requiring `cwd` would make rewind fail for a conversation the user can see on screen.
func findClaudeSessionFile(root, sessionID string) (string, error) {
	projects := filepath.Join(root, "projects")
	directories, err := os.ReadDir(projects)
	if err != nil {
		return "", fmt.Errorf("no Claude projects directory: %w", err)
	}
	target := sessionID + ".jsonl"
	for _, directory := range directories {
		if !directory.IsDir() {
			continue
		}
		candidate := filepath.Join(projects, directory.Name(), target)
		if info, statErr := os.Stat(candidate); statErr == nil && info.Size() > 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("session %s not found in any project directory", sessionID)
}

// readClaudeSessionEntries parses a transcript, keeping the forkable entries.
func readClaudeSessionEntries(path string) ([]map[string]any, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	entries := make([]map[string]any, 0, 256)
	scanner := bufio.NewScanner(file)
	// A transcript line can hold a whole file's content; the default 64KB limit would truncate it and lose the entry.
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry map[string]any
		if json.Unmarshal([]byte(line), &entry) != nil {
			// One unreadable line does not invalidate the transcript: a partial write at the tail is normal.
			continue
		}
		entryType, _ := entry["type"].(string)
		if !claudeForkKinds[entryType] {
			continue
		}
		if uuid, _ := entry["uuid"].(string); uuid == "" {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}

// writeForkedClaudeSession writes the forked transcript next to the original.
//
// Every retained entry gets a fresh uuid and its parent link remapped, so the two sessions do not share identity: a shared
// uuid would make the daemon treat a forked message as the original one and dedupe it away.
func writeForkedClaudeSession(sourcePath, forkedID, sourceID string, conversation []map[string]any) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)

	// Progress entries are dropped AFTER the slice: they are position markers, and keeping them would make the model
	// think work happened in the fork that happened in the original.
	retained := make([]map[string]any, 0, len(conversation))
	for _, entry := range conversation {
		if entryType, _ := entry["type"].(string); entryType == "progress" {
			continue
		}
		retained = append(retained, entry)
	}
	if len(retained) == 0 {
		return fmt.Errorf("session %s has no messages to fork", sourceID)
	}

	newUUID := make(map[string]string, len(retained))
	for _, entry := range retained {
		uuid, _ := entry["uuid"].(string)
		newUUID[uuid] = newClaudeSessionID()
	}
	// The ancestry walk needs every entry, progress included: a message whose parent was a progress marker must reach
	// past it to the nearest surviving ancestor, and looking only at the retained set stops there and yields nil.
	allByUUID := make(map[string]map[string]any, len(conversation))
	for _, entry := range conversation {
		uuid, _ := entry["uuid"].(string)
		allByUUID[uuid] = entry
	}

	lines := make([]string, 0, len(retained)+1)
	for index, entry := range retained {
		forked := make(map[string]any, len(entry)+4)
		for key, value := range entry {
			forked[key] = value
		}
		uuid, _ := entry["uuid"].(string)
		forked["uuid"] = newUUID[uuid]
		forked["sessionId"] = forkedID
		forked["isSidechain"] = false
		// The nearest ancestor that survives the progress filter: pointing at a dropped entry breaks the chain.
		forked["parentUuid"] = remapClaudeParent(entry["parentUuid"], allByUUID, newUUID)
		if logical, ok := entry["logicalParentUuid"].(string); ok {
			if mapped, found := newUUID[logical]; found {
				forked["logicalParentUuid"] = mapped
			} else {
				delete(forked, "logicalParentUuid")
			}
		}
		// The last entry gets "now" so the fork sorts after the original in a session list.
		if index == len(retained)-1 {
			forked["timestamp"] = now
		}
		forked["forkedFrom"] = map[string]any{"sessionId": sourceID, "messageUuid": uuid}

		encoded, err := json.Marshal(forked)
		if err != nil {
			return err
		}
		lines = append(lines, string(encoded))
	}

	// A title records what the fork is, which is what the session picker shows.
	title, err := json.Marshal(map[string]any{
		"type": "custom-title", "sessionId": forkedID, "customTitle": "Forked session",
		"uuid": newClaudeSessionID(), "timestamp": now,
	})
	if err != nil {
		return err
	}
	lines = append(lines, string(title))

	target := filepath.Join(filepath.Dir(sourcePath), forkedID+".jsonl")
	body := strings.Join(lines, "\n") + "\n"
	return os.WriteFile(target, []byte(body), 0o600)
}

// remapClaudeParent walks up to the nearest ancestor that survives a fork.
func remapClaudeParent(value any, byUUID map[string]map[string]any, newUUID map[string]string) any {
	parent, _ := value.(string)
	for depth := 0; depth < 64 && parent != ""; depth++ {
		if mapped, found := newUUID[parent]; found {
			return mapped
		}
		ancestor, found := byUUID[parent]
		if !found {
			return nil
		}
		parent, _ = ancestor["parentUuid"].(string)
	}
	return nil
}

// newClaudeSessionID makes a UUID-shaped session id.
//
// The shape matters: the SDK validates session ids as UUIDs and rejects anything else, and Claude names its transcript
// files after them.
func newClaudeSessionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000-0000-4000-8000-000000000000"
	}
	// Version 4, variant bits — the same shape `randomUUID` produces.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(b[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}

// ClaudeSessionFileExists reports whether a session transcript is present for an id.
//
// Exported beside ForkClaudeSession so the rewind path can tell "the session is not on disk" from "the fork failed":
// the two need different messages, and a single error string conflates them.
func ClaudeSessionFileExists(configDir, sessionID string) bool {
	if strings.TrimSpace(sessionID) == "" {
		return false
	}
	_, err := findClaudeSessionFile(resolveClaudeConfigDir(configDir), sessionID)
	return err == nil
}
