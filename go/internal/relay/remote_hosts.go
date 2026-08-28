package relay

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const remoteHostsDirectory = "remote-hosts-v1"

func RemoteHostsPath(home string) string {
	return filepath.Join(home, "state", remoteHostsDirectory)
}

func ImportRemoteHost(directory string, offer PairingOfferV3) error {
	return importRemoteHost(directory, offer, installIdentityFile, syncIdentityDirectory)
}

func importRemoteHost(
	directory string,
	offer PairingOfferV3,
	install func(string, string) error,
	syncDirectory func(string) error,
) error {
	if err := offer.Validate(); err != nil {
		return err
	}
	if existing, err := LoadRemoteHost(directory, offer.ServerID); err == nil {
		if existing == offer {
			return syncRemoteHostsDirectory(directory, syncDirectory)
		}
		return fmt.Errorf("remote host %s already exists with different trust material", offer.ServerID)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := ensureRemoteHostsDirectory(directory); err != nil {
		return err
	}
	data, err := json.MarshalIndent(offer, "", "  ")
	if err != nil {
		return fmt.Errorf("encode remote host %s: %w", offer.ServerID, err)
	}
	data = append(data, '\n')
	temporary, err := os.CreateTemp(directory, ".remote-host-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary remote host record: %w", err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := securePrivateFile(temporaryPath); err != nil {
		return fmt.Errorf("secure temporary remote host record: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary remote host record: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary remote host record: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary remote host record: %w", err)
	}
	closed = true
	destination := filepath.Join(directory, offer.ServerID+".json")
	if err := install(temporaryPath, destination); err != nil {
		if errors.Is(err, fs.ErrExist) {
			existing, loadErr := LoadRemoteHost(directory, offer.ServerID)
			if loadErr == nil && existing == offer {
				return syncRemoteHostsDirectory(directory, syncDirectory)
			}
			if loadErr != nil {
				return loadErr
			}
			return fmt.Errorf("remote host %s already exists with different trust material", offer.ServerID)
		}
		return fmt.Errorf("install remote host %s: %w", offer.ServerID, err)
	}
	return syncRemoteHostsDirectory(directory, syncDirectory)
}

func LoadRemoteHosts(directory string) ([]PairingOfferV3, error) {
	entries, err := os.ReadDir(directory)
	if errors.Is(err, fs.ErrNotExist) {
		return []PairingOfferV3{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read remote host directory: %w", err)
	}
	if err := validateRemoteHostsDirectory(directory); err != nil {
		return nil, err
	}
	hosts := make([]PairingOfferV3, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			return nil, fmt.Errorf("remote host directory contains unexpected entry %q", entry.Name())
		}
		serverID := strings.TrimSuffix(entry.Name(), ".json")
		host, err := loadRemoteHostFile(filepath.Join(directory, entry.Name()), serverID)
		if err != nil {
			return nil, err
		}
		hosts = append(hosts, host)
	}
	sort.Slice(hosts, func(left, right int) bool { return hosts[left].ServerID < hosts[right].ServerID })
	return hosts, nil
}

func LoadRemoteHost(directory, serverID string) (PairingOfferV3, error) {
	if !validServerID(serverID) {
		return PairingOfferV3{}, errors.New("invalid remote host server ID")
	}
	if err := validateRemoteHostsDirectory(directory); err != nil {
		return PairingOfferV3{}, err
	}
	return loadRemoteHostFile(filepath.Join(directory, serverID+".json"), serverID)
}

func RemoveRemoteHost(directory, serverID string) error {
	if _, err := LoadRemoteHost(directory, serverID); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(directory, serverID+".json")); err != nil {
		return fmt.Errorf("remove remote host %s: %w", serverID, err)
	}
	if err := syncIdentityDirectory(directory); err != nil {
		return fmt.Errorf("sync remote host directory: %w", err)
	}
	return nil
}

func ensureRemoteHostsDirectory(directory string) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create remote host directory: %w", err)
	}
	if err := securePrivateDirectory(directory); err != nil {
		return fmt.Errorf("secure remote host directory: %w", err)
	}
	return validateRemoteHostsDirectory(directory)
}

func syncRemoteHostsDirectory(directory string, syncDirectory func(string) error) error {
	if err := syncDirectory(directory); err != nil {
		return fmt.Errorf("sync remote host directory: %w", err)
	}
	return nil
}

func validateRemoteHostsDirectory(directory string) error {
	if _, err := validatePrivateDirectory(directory); err != nil {
		return fmt.Errorf("remote host directory must be private: %w", err)
	}
	return nil
}

func loadRemoteHostFile(path, expectedServerID string) (PairingOfferV3, error) {
	if _, err := ValidatePrivateFile(path); err != nil {
		return PairingOfferV3{}, fmt.Errorf("remote host %s must be private: %w", expectedServerID, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return PairingOfferV3{}, fmt.Errorf("read remote host %s: %w", expectedServerID, err)
	}
	var offer PairingOfferV3
	if err := decodeStrictJSON(data, &offer); err != nil {
		return PairingOfferV3{}, fmt.Errorf("decode remote host %s: %w", expectedServerID, err)
	}
	if offer.ServerID != expectedServerID {
		return PairingOfferV3{}, fmt.Errorf("remote host record name does not match its server ID")
	}
	if err := offer.Validate(); err != nil {
		return PairingOfferV3{}, fmt.Errorf("remote host %s is invalid: %w", expectedServerID, err)
	}
	return offer, nil
}
