package hub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"byspace/internal/privatepath"
)

const relationshipVersion = 1

const executionScope = "hub.execution.*"

var (
	uuidPattern     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	serverIDPattern = regexp.MustCompile(`^srv_[A-Za-z0-9_-]{12}$`)
)

type relationship struct {
	DaemonID       string   `json:"daemonId"`
	IdempotencyKey string   `json:"idempotencyKey,omitempty"`
	HubOrigin      string   `json:"hubOrigin"`
	CreatedAt      string   `json:"createdAt"`
	Scopes         []string `json:"scopes"`
}

type credential struct {
	Secret string `json:"secret"`
}

type enrollment struct {
	Token string `json:"token"`
}

type transport struct {
	Kind         string `json:"kind"`
	WebSocketURL string `json:"webSocketUrl"`
}

type identity struct {
	ServerID        string `json:"serverId"`
	DaemonPublicKey string `json:"daemonPublicKey"`
}

type record struct {
	Version      int          `json:"version"`
	State        string       `json:"state"`
	Relationship relationship `json:"relationship"`
	Credential   *credential  `json:"credential,omitempty"`
	Enrollment   *enrollment  `json:"enrollment,omitempty"`
	Identity     *identity    `json:"identity,omitempty"`
	Transport    *transport   `json:"transport,omitempty"`
	Reason       string       `json:"reason,omitempty"`
}

type relationshipSaveError struct {
	cause    error
	replaced bool
}

func (err *relationshipSaveError) Error() string { return err.cause.Error() }
func (err *relationshipSaveError) Unwrap() error { return err.cause }

func relationshipWasReplaced(err error) bool {
	var saveError *relationshipSaveError
	return errors.As(err, &saveError) && saveError.replaced
}

type quarantinedAuthorityError struct {
	cause error
}

func (err *quarantinedAuthorityError) Error() string {
	return err.cause.Error() + "; invalid authority was quarantined"
}

func (err *quarantinedAuthorityError) Unwrap() error { return err.cause }

type relationshipStore struct {
	path          string
	now           func() time.Time
	syncDirectory func(string) error
}

func relationshipPath(home string) string {
	return filepath.Join(home, "state", "hub-relationship-v1.json")
}

func newRelationshipStore(path string) *relationshipStore {
	return &relationshipStore{path: path, now: time.Now, syncDirectory: syncRelationshipDirectory}
}

func (store *relationshipStore) Load() (*record, error) {
	if _, err := os.Lstat(store.path); errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("inspect private Hub relationship %s: %w", store.path, err)
	}
	if _, err := privatepath.ValidateDirectory(filepath.Dir(store.path)); err != nil {
		return nil, fmt.Errorf("validate private Hub state directory: %w", err)
	}
	if _, err := privatepath.ValidateFile(store.path); err != nil {
		return nil, store.quarantine(fmt.Errorf("validate private Hub relationship %s: %w", store.path, err))
	}
	data, err := os.ReadFile(store.path)
	if err != nil {
		return nil, fmt.Errorf("read Hub relationship %s: %w", store.path, err)
	}
	var stored record
	if err := decodeStrictJSON(data, &stored); err != nil {
		return nil, store.quarantine(fmt.Errorf("decode Hub relationship: %w", err))
	}
	if err := validateRecord(stored); err != nil {
		return nil, store.quarantine(fmt.Errorf("validate Hub relationship: %w", err))
	}
	return &stored, nil
}

func (store *relationshipStore) Save(stored record) (saveErr error) {
	stored.Version = relationshipVersion
	if err := validateRecord(stored); err != nil {
		return fmt.Errorf("validate Hub relationship before save: %w", err)
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Hub relationship: %w", err)
	}
	data = append(data, '\n')
	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create Hub state directory: %w", err)
	}
	if err := privatepath.SecureDirectory(directory); err != nil {
		return fmt.Errorf("secure Hub state directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".hub-relationship-v1-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary Hub relationship: %w", err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := privatepath.SecureFile(temporaryPath); err != nil {
		return fmt.Errorf("secure temporary Hub relationship: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary Hub relationship: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary Hub relationship: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Hub relationship: %w", err)
	}
	closed = true
	if err := replaceRelationshipFile(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace Hub relationship: %w", err)
	}
	if err := store.syncDirectory(directory); err != nil {
		return &relationshipSaveError{
			cause: fmt.Errorf("sync Hub relationship directory after replace: %w", err), replaced: true,
		}
	}
	return nil
}

func (store *relationshipStore) Remove() error {
	if err := os.Remove(store.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove Hub relationship: %w", err)
	}
	if err := store.syncDirectory(filepath.Dir(store.path)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("sync Hub relationship directory after remove: %w", err)
	}
	return nil
}

// Discard removes the canonical authority and falls back to a same-directory
// rename before deletion when a direct remove fails. A non-nil result means the
// caller must stop using the authority and require operator intervention.
func (store *relationshipStore) Discard() error {
	directory := filepath.Dir(store.path)
	if err := store.Remove(); err == nil {
		return nil
	} else if _, inspectErr := os.Lstat(store.path); errors.Is(inspectErr, fs.ErrNotExist) {
		if syncErr := store.syncDirectory(directory); syncErr == nil || errors.Is(syncErr, fs.ErrNotExist) {
			return nil
		}
		return err
	}

	discardedPath := filepath.Join(directory, fmt.Sprintf(
		"hub-relationship.discarded-%d.json", store.now().UTC().UnixNano(),
	))
	if err := os.Rename(store.path, discardedPath); err != nil {
		return fmt.Errorf("discard Hub relationship authority: %w", err)
	}
	if err := store.syncDirectory(directory); err != nil {
		return fmt.Errorf("sync discarded Hub relationship authority: %w", err)
	}
	if err := os.Remove(discardedPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove discarded Hub relationship authority: %w", err)
	}
	if err := store.syncDirectory(directory); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("sync removed Hub relationship authority: %w", err)
	}
	return nil
}

func (store *relationshipStore) quarantine(cause error) error {
	directory := filepath.Dir(store.path)
	quarantinePath := filepath.Join(directory, fmt.Sprintf(
		"hub-relationship.invalid-%d.json", store.now().UTC().UnixNano(),
	))
	if err := os.Rename(store.path, quarantinePath); err != nil {
		return fmt.Errorf("%w; quarantine invalid Hub relationship: %v", cause, err)
	}
	if err := store.syncDirectory(directory); err != nil {
		return fmt.Errorf("%w; sync quarantined Hub relationship: %v", cause, err)
	}
	return &quarantinedAuthorityError{cause: cause}
}

func validateRecord(stored record) error {
	if stored.Version != relationshipVersion {
		return fmt.Errorf("version %d is unsupported", stored.Version)
	}
	if !uuidPattern.MatchString(stored.Relationship.DaemonID) || stored.Relationship.HubOrigin == "" || stored.Relationship.CreatedAt == "" {
		return errors.New("relationship identity is incomplete or invalid")
	}
	normalized, err := NormalizeOrigin(stored.Relationship.HubOrigin)
	if err != nil || normalized != stored.Relationship.HubOrigin {
		return errors.New("Hub origin is not canonical")
	}
	if _, err := time.Parse(time.RFC3339Nano, stored.Relationship.CreatedAt); err != nil {
		return errors.New("relationship createdAt is invalid")
	}
	if len(stored.Relationship.Scopes) != 1 || stored.Relationship.Scopes[0] != executionScope {
		return errors.New("relationship scopes must be exactly hub.execution.*")
	}
	if stored.Transport != nil {
		if stored.Transport.Kind != "direct_websocket" {
			return errors.New("Hub transport kind is unsupported")
		}
		if err := ValidateWebSocketURL(stored.Relationship.HubOrigin, stored.Transport.WebSocketURL); err != nil {
			return err
		}
	}
	switch stored.State {
	case "pending":
		if !uuidPattern.MatchString(stored.Relationship.IdempotencyKey) || stored.Credential == nil || stored.Enrollment == nil || stored.Identity == nil || stored.Transport != nil || stored.Reason != "" {
			return errors.New("pending Hub relationship is incomplete")
		}
		if err := validatePrivateCredential(stored.Credential.Secret); err != nil {
			return err
		}
		if len(stored.Enrollment.Token) < 32 || len(stored.Enrollment.Token) > 16<<10 {
			return errors.New("pending Hub enrollment token is invalid")
		}
		if !serverIDPattern.MatchString(stored.Identity.ServerID) {
			return errors.New("pending Hub server ID is invalid")
		}
		publicKey, err := base64.StdEncoding.DecodeString(stored.Identity.DaemonPublicKey)
		if err != nil || len(publicKey) != 32 || base64.StdEncoding.EncodeToString(publicKey) != stored.Identity.DaemonPublicKey {
			return errors.New("pending Hub daemon public key is invalid")
		}
	case "active", "disconnecting":
		if !uuidPattern.MatchString(stored.Relationship.IdempotencyKey) || stored.Credential == nil || stored.Enrollment != nil || stored.Identity != nil || stored.Reason != "" {
			return fmt.Errorf("%s Hub relationship is invalid", stored.State)
		}
		if err := validatePrivateCredential(stored.Credential.Secret); err != nil {
			return err
		}
		if stored.State == "active" && stored.Transport == nil {
			return errors.New("active Hub relationship has no transport")
		}
	case "revoked":
		if stored.Relationship.IdempotencyKey != "" || stored.Credential != nil || stored.Enrollment != nil || stored.Identity != nil || stored.Reason == "" {
			return errors.New("revoked Hub relationship retained authority or reason is missing")
		}
	default:
		return fmt.Errorf("Hub relationship state %q is unsupported", stored.State)
	}
	return nil
}

func validatePrivateCredential(value string) error {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return errors.New("Hub relationship credential is invalid")
	}
	return nil
}

func decodeStrictJSON(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing JSON content")
	}
	return nil
}
