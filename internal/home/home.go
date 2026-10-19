package home

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/e2ee"
)

const (
	ServerIDFilename = "server-id"
	KeyPairFilename  = "daemon-keypair.json"
	PIDFilename      = "byspace.pid"
)

type storedKeyPair struct {
	V            int    `json:"v"`
	PublicKeyB64 string `json:"publicKeyB64"`
	SecretKeyB64 string `json:"secretKeyB64"`
}

// Resolve returns the absolute path to $BYSPACE_HOME (defaulting to ~/.byspace)
// and ensures the directory exists with 0700 permissions.
func Resolve(explicit string) (string, error) {
	raw := strings.TrimSpace(explicit)
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("BYSPACE_HOME"))
	}
	if raw == "" {
		raw = "~/.byspace"
	}
	if raw == "~" || strings.HasPrefix(raw, "~/") {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if raw == "~" {
			raw = userHome
		} else {
			raw = filepath.Join(userHome, raw[2:])
		}
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return "", err
	}
	return abs, nil
}

// WriteAtomic writes data to a temporary file in the same directory and renames it into place.
func WriteAtomic(targetPath string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}
	if err := tmp.Chmod(perm); err != nil {
		cleanup()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, targetPath)
}

// GetOrCreateServerID loads or creates $BYSPACE_HOME/server-id ("srv_<12 base64url chars>").
func GetOrCreateServerID(homeDir string) (string, error) {
	idPath := filepath.Join(homeDir, ServerIDFilename)
	if envID := strings.TrimSpace(os.Getenv("BYSPACE_SERVER_ID")); envID != "" {
		if _, err := os.Stat(idPath); os.IsNotExist(err) {
			_ = WriteAtomic(idPath, []byte(envID+"\n"), 0o600)
		}
		return envID, nil
	}

	if raw, err := os.ReadFile(idPath); err == nil {
		if parsed := strings.TrimSpace(string(raw)); parsed != "" {
			return parsed, nil
		}
	}

	var buf [9]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	created := "srv_" + base64.RawURLEncoding.EncodeToString(buf[:])
	if err := WriteAtomic(idPath, []byte(created+"\n"), 0o600); err != nil {
		return "", err
	}
	return created, nil
}

// LoadOrCreateKeyPair loads or creates $BYSPACE_HOME/daemon-keypair.json (v2 format).
func LoadOrCreateKeyPair(homeDir string) (e2ee.KeyPair, string, error) {
	kpPath := filepath.Join(homeDir, KeyPairFilename)
	if raw, err := os.ReadFile(kpPath); err == nil {
		var stored storedKeyPair
		if err := json.Unmarshal(raw, &stored); err == nil && stored.V == 2 {
			pub, errPub := e2ee.ImportKey(stored.PublicKeyB64)
			sec, errSec := e2ee.ImportKey(stored.SecretKeyB64)
			if errPub == nil && errSec == nil {
				kp := e2ee.KeyPair{PublicKey: pub, SecretKey: sec}
				return kp, e2ee.ExportKey(pub), nil
			}
		}
	}

	kp, err := e2ee.GenerateKeyPair()
	if err != nil {
		return e2ee.KeyPair{}, "", err
	}
	pubB64 := e2ee.ExportKey(kp.PublicKey)
	secB64 := e2ee.ExportKey(kp.SecretKey)
	payload, err := json.MarshalIndent(storedKeyPair{
		V:            2,
		PublicKeyB64: pubB64,
		SecretKeyB64: secB64,
	}, "", "  ")
	if err != nil {
		return e2ee.KeyPair{}, "", fmt.Errorf("marshal keypair: %w", err)
	}
	if err := WriteAtomic(kpPath, append(payload, '\n'), 0o600); err != nil {
		return e2ee.KeyPair{}, "", err
	}
	return kp, pubB64, nil
}
