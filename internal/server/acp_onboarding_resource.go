package server

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

//go:embed all:resources/byspace-provider-adapter
var acpOnboardingResourceFS embed.FS

var acpOnboardingResourceMu sync.Mutex

// materializeACPOnboardingResource refreshes the daemon-owned, stable resource directory. The
// adapter is deliberately outside skill discovery: the copied prompt reads it on demand.
func materializeACPOnboardingResource(home string) (string, error) {
	if home == "" {
		return "", fmt.Errorf("BySpace home is not configured")
	}
	acpOnboardingResourceMu.Lock()
	defer acpOnboardingResourceMu.Unlock()
	resources := filepath.Join(home, "resources")
	if err := os.MkdirAll(resources, 0o755); err != nil {
		return "", fmt.Errorf("create ACP onboarding resource directory: %w", err)
	}
	staging, err := os.MkdirTemp(resources, ".byspace-provider-adapter-*")
	if err != nil {
		return "", fmt.Errorf("stage ACP onboarding resource: %w", err)
	}
	defer os.RemoveAll(staging)
	err = fs.WalkDir(acpOnboardingResourceFS, "resources/byspace-provider-adapter", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel("resources/byspace-provider-adapter", path)
		if err != nil || relative == "." {
			return err
		}
		target := filepath.Join(staging, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := acpOnboardingResourceFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		return "", fmt.Errorf("materialize ACP onboarding resource: %w", err)
	}
	target := filepath.Join(resources, "byspace-provider-adapter")
	backup := target + ".old"
	if err := os.RemoveAll(backup); err != nil {
		return "", fmt.Errorf("clear previous ACP onboarding backup: %w", err)
	}
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return "", fmt.Errorf("replace ACP onboarding resource: %w", err)
		}
	}
	if err := os.Rename(staging, target); err != nil {
		if _, backupErr := os.Stat(backup); backupErr == nil {
			_ = os.Rename(backup, target)
		}
		return "", fmt.Errorf("activate ACP onboarding resource: %w", err)
	}
	if err := os.RemoveAll(backup); err != nil {
		return "", fmt.Errorf("remove ACP onboarding backup: %w", err)
	}
	absolute, err := filepath.Abs(filepath.Join(target, "SKILL.md"))
	if err != nil {
		return "", fmt.Errorf("resolve ACP onboarding prompt path: %w", err)
	}
	return absolute, nil
}
