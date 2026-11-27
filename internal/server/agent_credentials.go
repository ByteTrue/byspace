package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/ByteTrue/byspace/internal/home"
)

const agentCredentialEnv = "BYSPACE_AGENT_CREDENTIAL"

type agentCredentialRecord struct {
	AgentID    string `json:"agentId"`
	Credential string `json:"credential"`
}

type agentCredentialStore struct {
	dir     string
	mu      sync.Mutex
	revoked map[string]struct{}
}

func newAgentCredentialStore(homeDir string) *agentCredentialStore {
	return &agentCredentialStore{dir: filepath.Join(homeDir, "agent-credentials"), revoked: make(map[string]struct{})}
}

func (s *agentCredentialStore) path(agentID string) string {
	digest := sha256.Sum256([]byte(agentID))
	return filepath.Join(s.dir, hex.EncodeToString(digest[:])+".json")
}

func (s *agentCredentialStore) ensure(agentID string) (string, error) {
	if strings.TrimSpace(agentID) == "" {
		return "", errors.New("agent credential requires an agent ID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return "", fmt.Errorf("create agent credential directory: %w", err)
	}
	if err := os.Chmod(s.dir, 0o700); err != nil {
		return "", fmt.Errorf("restrict agent credential directory: %w", err)
	}
	path := s.path(agentID)
	if raw, err := os.ReadFile(path); err == nil {
		var rec agentCredentialRecord
		if err := json.Unmarshal(raw, &rec); err != nil || rec.AgentID != agentID || rec.Credential == "" {
			return "", fmt.Errorf("read agent credential for %s: invalid credential file", agentID)
		}
		return rec.Credential, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("read agent credential for %s: %w", agentID, err)
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate agent credential for %s: %w", agentID, err)
	}
	rec := agentCredentialRecord{AgentID: agentID, Credential: base64.RawURLEncoding.EncodeToString(buf)}
	raw, err := json.Marshal(rec)
	if err != nil {
		return "", fmt.Errorf("encode agent credential for %s: %w", agentID, err)
	}
	if err := home.WriteAtomic(path, raw, 0o600); err != nil {
		return "", fmt.Errorf("persist agent credential for %s: %w", agentID, err)
	}
	return rec.Credential, nil
}

func (s *agentCredentialStore) authenticate(credential string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			continue
		}
		var rec agentCredentialRecord
		if json.Unmarshal(raw, &rec) != nil || rec.AgentID == "" || rec.Credential == "" {
			continue
		}
		if _, revoked := s.revoked[rec.AgentID]; revoked {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(rec.Credential), []byte(credential)) == 1 {
			return rec.AgentID, true
		}
	}
	return "", false
}

func (s *agentCredentialStore) revoke(agentID string) error {
	if agentID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked[agentID] = struct{}{}
	if err := os.Remove(s.path(agentID)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("revoke agent credential for %s: %w", agentID, err)
	}
	return nil
}

func (s *Server) credentialStore() *agentCredentialStore {
	s.agentCredentialMu.Lock()
	defer s.agentCredentialMu.Unlock()
	if s.agentCredentials == nil {
		s.agentCredentials = newAgentCredentialStore(s.homeDir)
	}
	return s.agentCredentials
}

func (s *Server) ensureAgentCredential(agentID string) (string, error) {
	return s.credentialStore().ensure(agentID)
}

func (s *Server) revokeAgentCredential(agentID string) error {
	return s.credentialStore().revoke(agentID)
}

func (s *Server) agentIDForCredential(credential string) (string, bool) {
	if credential == "" {
		return "", false
	}
	agentID, ok := s.credentialStore().authenticate(credential)
	if !ok {
		return "", false
	}
	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return "", false
	}
	if rec.ArchivedAt != nil {
		_ = s.credentialStore().revoke(agentID)
		return "", false
	}
	return agentID, true
}
