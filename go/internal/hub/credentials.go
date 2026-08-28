package hub

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"byspace/internal/privatepath"
)

const humanCredentialDirectory = "hub-cli-credentials-v1"

type HumanCredential struct {
	Version        int    `json:"version"`
	HubOrigin      string `json:"hubOrigin"`
	OrganizationID string `json:"organizationId"`
	Credential     string `json:"credential"`
	CreatedAt      string `json:"createdAt"`
}

func NewHumanCredential(origin, organizationID, value string, now time.Time) (HumanCredential, error) {
	normalized, err := NormalizeOrigin(origin)
	if err != nil {
		return HumanCredential{}, err
	}
	credential := HumanCredential{
		Version: 1, HubOrigin: normalized, OrganizationID: organizationID,
		Credential: value, CreatedAt: now.UTC().Format(time.RFC3339Nano),
	}
	if err := validateHumanCredential(credential); err != nil {
		return HumanCredential{}, err
	}
	return credential, nil
}

func SaveHumanCredential(home string, credential HumanCredential) error {
	if err := validateHumanCredential(credential); err != nil {
		return err
	}
	directory := filepath.Join(home, "state", humanCredentialDirectory)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create Hub CLI credential directory: %w", err)
	}
	if err := privatepath.SecureDirectory(directory); err != nil {
		return fmt.Errorf("secure Hub CLI credential directory: %w", err)
	}
	data, err := json.MarshalIndent(credential, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Hub CLI credential: %w", err)
	}
	data = append(data, '\n')
	temporary, err := os.CreateTemp(directory, ".credential-*.tmp")
	if err != nil {
		return fmt.Errorf("create Hub CLI credential temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	cleanup := true
	defer func() {
		_ = temporary.Close()
		if cleanup {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := privatepath.SecureFile(temporaryPath); err != nil {
		return fmt.Errorf("secure Hub CLI credential temporary file: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write Hub CLI credential: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync Hub CLI credential: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Hub CLI credential: %w", err)
	}
	path, err := humanCredentialPath(home, credential.HubOrigin)
	if err != nil {
		return err
	}
	if err := replaceRelationshipFile(temporaryPath, path); err != nil {
		return fmt.Errorf("replace Hub CLI credential: %w", err)
	}
	cleanup = false
	if err := syncRelationshipDirectory(directory); err != nil {
		return fmt.Errorf("sync Hub CLI credential directory: %w", err)
	}
	return nil
}

func LoadHumanCredential(home, origin string) (HumanCredential, error) {
	path, err := humanCredentialPath(home, origin)
	if err != nil {
		return HumanCredential{}, err
	}
	if _, err := privatepath.ValidateDirectory(filepath.Dir(path)); err != nil {
		return HumanCredential{}, fmt.Errorf("validate Hub CLI credential directory: %w", err)
	}
	if _, err := privatepath.ValidateFile(path); err != nil {
		return HumanCredential{}, quarantineHumanCredential(path, fmt.Errorf("validate Hub CLI credential file: %w", err))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return HumanCredential{}, fmt.Errorf("read Hub CLI credential: %w", err)
	}
	var credential HumanCredential
	if err := decodeStrictJSON(data, &credential); err != nil {
		return HumanCredential{}, quarantineHumanCredential(path, fmt.Errorf("decode Hub CLI credential: %w", err))
	}
	if err := validateHumanCredential(credential); err != nil {
		return HumanCredential{}, quarantineHumanCredential(path, err)
	}
	normalized, _ := NormalizeOrigin(origin)
	if credential.HubOrigin != normalized {
		return HumanCredential{}, quarantineHumanCredential(path, errors.New("Hub CLI credential origin does not match its private record"))
	}
	return credential, nil
}

func quarantineHumanCredential(path string, cause error) error {
	directory := filepath.Dir(path)
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	quarantinePath := filepath.Join(directory, fmt.Sprintf("%s.invalid-%d.json", name, time.Now().UTC().UnixNano()))
	if err := os.Rename(path, quarantinePath); err != nil {
		return fmt.Errorf("%w; quarantine invalid Hub CLI credential: %v", cause, err)
	}
	if err := privatepath.SecureFile(quarantinePath); err != nil {
		return fmt.Errorf("%w; secure quarantined Hub CLI credential: %v", cause, err)
	}
	if err := syncRelationshipDirectory(directory); err != nil {
		return fmt.Errorf("%w; sync quarantined Hub CLI credential: %v", cause, err)
	}
	return fmt.Errorf("%w; invalid credential was quarantined", cause)
}

func RemoveHumanCredential(home, origin string) error {
	path, err := humanCredentialPath(home, origin)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove Hub CLI credential: %w", err)
	}
	if err := syncRelationshipDirectory(filepath.Dir(path)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("sync Hub CLI credential directory: %w", err)
	}
	return nil
}

func humanCredentialPath(home, origin string) (string, error) {
	normalized, err := NormalizeOrigin(origin)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(normalized))
	name := base64.RawURLEncoding.EncodeToString(digest[:]) + ".json"
	return filepath.Join(home, "state", humanCredentialDirectory, name), nil
}

func validateHumanCredential(credential HumanCredential) error {
	if credential.Version != 1 {
		return fmt.Errorf("unsupported Hub CLI credential version %d", credential.Version)
	}
	normalized, err := NormalizeOrigin(credential.HubOrigin)
	if err != nil {
		return err
	}
	if normalized != credential.HubOrigin {
		return errors.New("Hub CLI credential origin is not canonical")
	}
	if credential.OrganizationID == "" || credential.Credential == "" || credential.CreatedAt == "" {
		return errors.New("Hub CLI credential is incomplete")
	}
	if _, err := time.Parse(time.RFC3339Nano, credential.CreatedAt); err != nil {
		return errors.New("Hub CLI credential createdAt is invalid")
	}
	return nil
}
