package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/ByteTrue/byspace/internal/home"
)

// Daemon password hashing.
//
// The hash is produced and stored here rather than in the server package because the config file
// is this package's business: the wire carries the plaintext, the file carries the hash, and the
// translation has to happen between those two without the server reaching into the file format.

// daemonPasswordBcryptCost matches the node daemon so an existing hash verifies unchanged.
const daemonPasswordBcryptCost = 12

// HashDaemonPassword produces the stored bcrypt hash.
func HashDaemonPassword(password string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), daemonPasswordBcryptCost)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

// VerifyDaemonPassword checks a presented password against the stored hash.
//
// bcrypt's own comparison is constant-time; the empty-password case means "no auth configured"
// and is handled by the caller so that a misread config cannot silently open the daemon.
func VerifyDaemonPassword(hash, password string) bool {
	if strings.TrimSpace(hash) == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// DaemonPasswordHash reads the configured bcrypt hash, or "" when auth is off.
//
// Read from the config on every call rather than cached: changing the password must take
// effect without a restart, and a cache would silently keep accepting the old one.
func (s *Store) DaemonPasswordHash() string {
	cfg := s.loadDaemonConfigRaw()
	if cfg == nil {
		return ""
	}
	auth, ok := cfg["auth"].(map[string]any)
	if !ok {
		return ""
	}
	hash, _ := auth[daemonPasswordHashKey].(string)
	return strings.TrimSpace(hash)
}

// SetDaemonPasswordHash writes or clears the stored bcrypt hash.
//
// Kept separate from SaveDaemonConfig because the two hold different things: the config patch is a
// merge of settings, while the password is a single value that is either replaced or removed.
// An empty hash removes the whole auth block, which is what turning the password off means —
// leaving `auth: {}` behind would keep a settings page claiming a section it no longer has.
func (s *Store) SetDaemonPasswordHash(hash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfgPath := filepath.Join(s.homeDir, "config.json")
	disk := map[string]any{"version": 1, "daemon": map[string]any{}}
	if b, err := os.ReadFile(cfgPath); err == nil {
		var existing map[string]any
		if json.Unmarshal(b, &existing) == nil {
			disk = existing
			if _, ok := disk["version"]; !ok {
				disk["version"] = 1
			}
		}
	}
	daemon, _ := disk["daemon"].(map[string]any)
	if daemon == nil {
		daemon = map[string]any{}
	}
	if strings.TrimSpace(hash) == "" {
		delete(daemon, "auth")
	} else {
		daemon["auth"] = map[string]any{daemonPasswordHashKey: hash}
	}
	disk["daemon"] = daemon
	b, err := json.MarshalIndent(disk, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(cfgPath, append(b, '\n'), 0o600)
}

// DaemonAuthFingerprint returns a digest of the stored hash, or "" when no password is set.
//
// The reload report compares persisted values to decide whether a setting changed, and for auth the
// persisted value is the hash. A digest keeps that comparison meaningful — rotating a password must
// show up as a change even though `passwordSet` stays true — without putting the hash itself into a
// snapshot that is held in memory and may end up in a log line.
func (s *Store) DaemonAuthFingerprint() string {
	hash := s.DaemonPasswordHash()
	if hash == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(hash))
	return hex.EncodeToString(sum[:])
}
