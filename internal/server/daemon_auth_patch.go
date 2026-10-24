package server

import (
	"fmt"
	"strings"

	"github.com/ByteTrue/byspace/internal/store"
)

// daemonAuthPatchKey is the field the wire uses for a new daemon password.
//
// The wire name and the persisted name are the same string, but they carry different things:
// a plaintext on the way in, a bcrypt hash on disk, and neither one on the way back.
const daemonAuthPatchKey = "password"

// takeDaemonAuthPatch removes the auth block from a `set_daemon_config` patch and reports what the
// stored password should become.
//
// Three cases, matching the node daemon (daemon-config-store.ts:467-475):
//   - a non-empty string is hashed and stored under auth.password;
//   - null (or an empty string) clears the password;
//   - `passwordSet` from a client is discarded — it is derived state, and a client echoing back
//     what it read would otherwise overwrite the truth with a stale boolean.
//
// The auth block is always removed from the patch: a plaintext must never reach the file, and the
// config merge cannot express "delete this key" — clearing goes through the store instead.
//
// A config without an auth block is returned unchanged (applied=false), so every other settings edit
// leaves the stored password alone.
func takeDaemonAuthPatch(config map[string]any) (hash string, applied bool, err error) {
	if config == nil {
		return "", false, nil
	}
	raw, present := config["auth"]
	if !present {
		return "", false, nil
	}
	delete(config, "auth")
	auth, _ := raw.(map[string]any)
	value, hasKey := auth[daemonAuthPatchKey]
	if !hasKey {
		// Only a derived `passwordSet` came through; nothing to store.
		return "", false, nil
	}
	password, _ := value.(string)
	if strings.TrimSpace(password) == "" {
		// null or empty means "turn the password off".
		return "", true, nil
	}
	hashed, hashErr := store.HashDaemonPassword(password)
	if hashErr != nil {
		return "", true, fmt.Errorf("hash daemon password: %w", hashErr)
	}
	return hashed, true, nil
}
