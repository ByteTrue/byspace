// Package backup maintains rolling, content-deduplicated snapshots of core
// $BYSPACE_HOME configuration files under $BYSPACE_HOME/backups/ so a corrupt
// or accidentally deleted config can be recovered immediately.
package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
)

const (
	MaxBackups     = 10
	BackupInterval = 6 * time.Hour
	hashStampFile  = ".last-sha256"
)

var CoreFiles = []string{
	"config.json",
	"projects.json",
	"desktop.json",
	"schedules.json",
	"heartbeats.json",
}

// Snapshot creates a new .tar.gz backup in $BYSPACE_HOME/backups/ if at least one
// core file exists and the combined SHA-256 of CoreFiles changed since the last snapshot.
// Keeps the newest MaxBackups archives.
func Snapshot(homeDir string) (archivePath string, created bool, err error) {
	if homeDir == "" {
		return "", false, nil
	}
	type entry struct {
		name string
		data []byte
	}
	var entries []entry
	hasher := sha256.New()
	for _, name := range CoreFiles {
		data, readErr := os.ReadFile(filepath.Join(homeDir, name))
		if readErr != nil {
			continue
		}
		entries = append(entries, entry{name: name, data: data})
		_, _ = hasher.Write([]byte(name))
		_, _ = hasher.Write([]byte{0})
		_, _ = hasher.Write(data)
		_, _ = hasher.Write([]byte{0})
	}
	if len(entries) == 0 {
		return "", false, nil
	}

	digest := hex.EncodeToString(hasher.Sum(nil))
	backupDir := filepath.Join(homeDir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return "", false, err
	}
	stampPath := filepath.Join(backupDir, hashStampFile)
	if prev, readErr := os.ReadFile(stampPath); readErr == nil && strings.TrimSpace(string(prev)) == digest {
		return "", false, nil
	}

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	now := time.Now().UTC()
	for _, e := range entries {
		hdr := &tar.Header{
			Name:    e.name,
			Mode:    0o600,
			Size:    int64(len(e.data)),
			ModTime: now,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return "", false, err
		}
		if _, err := tw.Write(e.data); err != nil {
			return "", false, err
		}
	}
	if err := tw.Close(); err != nil {
		return "", false, err
	}
	if err := gz.Close(); err != nil {
		return "", false, err
	}

	fileName := fmt.Sprintf("byspace-backup-%s-%s.tar.gz", now.Format("20060102-150405"), digest[:8])
	archivePath = filepath.Join(backupDir, fileName)
	if err := home.WriteAtomic(archivePath, buf.Bytes(), 0o600); err != nil {
		return "", false, err
	}
	_ = home.WriteAtomic(stampPath, []byte(digest+"\n"), 0o600)
	pruneOldBackups(backupDir, MaxBackups)
	return archivePath, true, nil
}

// List returns the paths of existing backup archives in $BYSPACE_HOME/backups/, newest first.
func List(homeDir string) []string {
	if homeDir == "" {
		return nil
	}
	matches, _ := filepath.Glob(filepath.Join(homeDir, "backups", "byspace-backup-*.tar.gz"))
	slices.Sort(matches)
	slices.Reverse(matches)
	return matches
}

// Restore unpacks archivePath atomically back into homeDir.
func Restore(homeDir, archivePath string) error {
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		return err
	}
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	allowed := make(map[string]bool, len(CoreFiles))
	for _, f := range CoreFiles {
		allowed[f] = true
	}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		base := filepath.Base(hdr.Name)
		if !allowed[base] {
			continue
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			return err
		}
		if err := home.WriteAtomic(filepath.Join(homeDir, base), data, 0o600); err != nil {
			return err
		}
	}
	return nil
}

// StartPeriodic runs an immediate Snapshot and then snapshots every BackupInterval until ctx ends.
func StartPeriodic(ctx context.Context, homeDir string) {
	if homeDir == "" {
		return
	}
	_, _, _ = Snapshot(homeDir)
	ticker := time.NewTicker(BackupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _, _ = Snapshot(homeDir)
		}
	}
}

func pruneOldBackups(backupDir string, keep int) {
	matches, _ := filepath.Glob(filepath.Join(backupDir, "byspace-backup-*.tar.gz"))
	if len(matches) <= keep {
		return
	}
	slices.Sort(matches)
	for _, old := range matches[:len(matches)-keep] {
		_ = os.Remove(old)
	}
}
