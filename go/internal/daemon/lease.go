package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const ownershipFilename = "daemon.lock"

var ErrOwnershipHeld = errors.New("daemon ownership lock is held")

type ownershipRecord struct {
	PID       int    `json:"pid"`
	StartedAt string `json:"startedAt"`
}

type ownershipLease struct {
	file   *os.File
	unlock func() error
}

func acquireOwnership(home string) (*ownershipLease, error) {
	if err := EnsureHome(home); err != nil {
		return nil, err
	}
	path := filepath.Join(home, ownershipFilename)
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open daemon ownership lock: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		file.Close()
		return nil, fmt.Errorf("secure daemon ownership lock: %w", err)
	}
	unlock, err := lockFile(file)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("acquire daemon ownership lock: %w", err)
	}

	if err := file.Truncate(0); err != nil {
		unlock()
		file.Close()
		return nil, fmt.Errorf("truncate daemon ownership lock: %w", err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		unlock()
		file.Close()
		return nil, fmt.Errorf("seek daemon ownership lock: %w", err)
	}
	record := ownershipRecord{PID: os.Getpid(), StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err := json.NewEncoder(file).Encode(record); err != nil {
		unlock()
		file.Close()
		return nil, fmt.Errorf("write daemon ownership lock: %w", err)
	}
	if err := file.Sync(); err != nil {
		unlock()
		file.Close()
		return nil, fmt.Errorf("sync daemon ownership lock: %w", err)
	}
	return &ownershipLease{file: file, unlock: unlock}, nil
}

func ownershipAvailable(home string) (bool, error) {
	file, err := os.OpenFile(filepath.Join(home, ownershipFilename), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return false, err
	}
	defer file.Close()
	if err := file.Chmod(0o600); err != nil {
		return false, err
	}
	unlock, err := lockFile(file)
	if errors.Is(err, ErrOwnershipHeld) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := unlock(); err != nil {
		return false, err
	}
	return true, nil
}

func (lease *ownershipLease) Release() error {
	if err := lease.unlock(); err != nil {
		lease.file.Close()
		return fmt.Errorf("release daemon ownership lock: %w", err)
	}
	if err := lease.file.Close(); err != nil {
		return fmt.Errorf("close daemon ownership lock: %w", err)
	}
	return nil
}
