package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"byspace/internal/privatepath"
)

const stateVersion = 1

type persistedState struct {
	Version int              `json:"version"`
	Agents  []persistedAgent `json:"agents"`
}

type persistedAgent struct {
	Snapshot   Snapshot            `json:"snapshot"`
	Timeline   TimelineSnapshot    `json:"timeline"`
	Deliveries []persistedDelivery `json:"deliveries"`
}

type persistedDelivery struct {
	ClientMessageID string `json:"clientMessageId"`
	TurnID          string `json:"turnId"`
	Accepted        bool   `json:"accepted"`
	Error           string `json:"error,omitempty"`
}

type stateStore interface {
	Load() (persistedState, error)
	Save(persistedState) error
}

type stateSaveError struct {
	err      error
	replaced bool
}

func (err *stateSaveError) Error() string { return err.err.Error() }
func (err *stateSaveError) Unwrap() error { return err.err }

func stateWasReplaced(err error) bool {
	var saveErr *stateSaveError
	return errors.As(err, &saveErr) && saveErr.replaced
}

type fileStateStore struct {
	path string
}

func newFileStateStore(path string) *fileStateStore {
	return &fileStateStore{path: path}
}

func (store *fileStateStore) Load() (persistedState, error) {
	if _, err := privatepath.ValidateFile(store.path); errors.Is(err, fs.ErrNotExist) {
		return persistedState{Version: stateVersion, Agents: []persistedAgent{}}, nil
	} else if err != nil {
		return persistedState{}, fmt.Errorf("validate private Agent state %s: %w", store.path, err)
	}
	data, err := os.ReadFile(store.path)
	if err != nil {
		return persistedState{}, fmt.Errorf("read Agent state %s: %w", store.path, err)
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return persistedState{}, fmt.Errorf("decode Agent state %s: %w", store.path, err)
	}
	if state.Version != stateVersion {
		return persistedState{}, fmt.Errorf("Agent state %s has version %d, want %d", store.path, state.Version, stateVersion)
	}
	if state.Agents == nil {
		state.Agents = []persistedAgent{}
	}
	return state, nil
}

func (store *fileStateStore) Save(state persistedState) (saveErr error) {
	state.Version = stateVersion
	if state.Agents == nil {
		state.Agents = []persistedAgent{}
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Agent state %s: %w", store.path, err)
	}
	data = append(data, '\n')

	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create Agent state directory %s: %w", directory, err)
	}
	if err := privatepath.SecureDirectory(directory); err != nil {
		return fmt.Errorf("secure Agent state directory %s: %w", directory, err)
	}
	temporary, err := os.CreateTemp(directory, ".agents-v1-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary Agent state in %s: %w", directory, err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			if closeErr := temporary.Close(); closeErr != nil && saveErr == nil {
				saveErr = fmt.Errorf("close temporary Agent state %s: %w", temporaryPath, closeErr)
			}
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := privatepath.SecureFile(temporaryPath); err != nil {
		return fmt.Errorf("secure temporary Agent state %s: %w", temporaryPath, err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary Agent state %s: %w", temporaryPath, err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary Agent state %s: %w", temporaryPath, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Agent state %s: %w", temporaryPath, err)
	}
	closed = true
	if err := atomicReplace(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace Agent state %s: %w", store.path, err)
	}
	if err := syncDirectory(directory); err != nil {
		return &stateSaveError{
			err:      fmt.Errorf("sync Agent state directory %s: %w", directory, err),
			replaced: true,
		}
	}
	return nil
}
