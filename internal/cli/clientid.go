package cli

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/ByteTrue/byspace/internal/home"
)

// cliClientKeyFile is where the CLI's stable client id lives.
//
// Ported from utils/client-id.ts. The id identifies "the BySpace CLI on this machine" rather than one process, so
// it persists: a daemon that sees the same id across invocations can treat them as the same client. Go sent the
// constant "byspace_go_cli" instead, which every machine shares — harmless today because the daemon only checks
// that the id is non-empty, and a trap the day anything keys on client identity.
const cliClientKeyFile = "cli-client-id"

var (
	cliClientOnce sync.Once
	cliClientID   string
)

// cliClientKey returns the CLI's client id, creating it on first use.
//
// A failure to read or write the file falls back to a single-use id rather than failing the command: the id is
// bookkeeping, and a read-only home directory should not stop `byspace ls`.
func cliClientKey(homeDir string) string {
	cliClientOnce.Do(func() {
		if strings.TrimSpace(homeDir) == "" {
			if resolved, err := home.Resolve(""); err == nil {
				homeDir = resolved
			}
		}
		path := filepath.Join(homeDir, cliClientKeyFile)
		if existing := readClientID(path); existing != "" {
			cliClientID = existing
			return
		}
		generated := generateClientID()
		if err := os.MkdirAll(homeDir, 0o700); err == nil {
			if werr := os.WriteFile(path, []byte(generated+"\n"), 0o600); werr != nil {
				cliClientID = generated
				return
			}
		}
		cliClientID = generated
	})
	return cliClientID
}

// readClientID reads a stored id, returning "" for anything unusable.
func readClientID(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return ""
	}
	return trimmed
}

// generateClientID makes a `cid_<32 hex>` id, the same shape node writes.
func generateClientID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// An unseeded RNG is not a reason to fail a command; the id only has to be stable within one home.
		return "cid_fallback"
	}
	return "cid_" + hex.EncodeToString(b[:])
}

// homeDirForClientID resolves the home the CLI is operating on.
//
// The id belongs to the home, not to the machine: two daemons under different BYSPACE_HOME values are two
// installations, and one shared id would say the CLI is the same client to both.
func homeDirForClientID() string {
	resolved, err := home.Resolve("")
	if err != nil {
		return ""
	}
	return resolved
}
