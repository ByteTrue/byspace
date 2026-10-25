// Package selfupdate replaces the running daemon binary with a newer release.
//
// Ported from daemon-self-updater.ts. The mechanism differs because the distribution does: the node
// daemon shells out to `npm install -g`, and a Go binary is a single file that downloads itself.
// The user-visible contract is the same — request an update, watch it move through starting →
// downloading → installing → complete, then have the daemon come back on the new version.
//
// Kept from the node implementation because each one prevents a real failure:
//
//   - One update at a time. Two concurrent requests race on the same file and can leave a
//     half-written binary in place, which is unbootable.
//   - An unsupported install is refused with a reason rather than attempted. The node daemon
//     refuses when it was not installed by npm; the Go equivalent refuses when the binary is
//     somewhere it may not overwrite.
//   - Progress is reported as it happens: a download of tens of megabytes is long enough that a
//     silent request looks hung.
package selfupdate

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Phase is one step of an update, matching DaemonSelfUpdatePhase.
type Phase string

// Update phases.
const (
	PhaseStarting    Phase = "starting"
	PhaseDownloading Phase = "downloading"
	PhaseInstalling  Phase = "installing"
	PhaseComplete    Phase = "complete"
)

// ErrInProgress reports a second concurrent update.
var ErrInProgress = errors.New("a daemon update is already in progress")

// Result is the outcome of an update.
type Result struct {
	Success bool
	// Error is the human-readable failure, empty on success.
	Error string
	// PreviousVersion and NewVersion describe the transition.
	PreviousVersion string
	NewVersion      string
	// RestartRequired is true when the new binary is in place and the daemon must restart to run
	// it: replacing the file does not affect the running process.
	RestartRequired bool
}

// Updater performs one update at a time.
type Updater struct {
	// CurrentVersion is the running daemon's version.
	CurrentVersion string
	// ExecutablePath is the binary to replace. Empty means os.Executable().
	ExecutablePath string
	// TargetVersion is the version to install. Empty means the newest release.
	TargetVersion string
	// OnProgress reports each phase.
	OnProgress func(Phase)
	// Fetch downloads the release payload. Tests inject it; production leaves it nil.
	Fetch func(ctx context.Context, version string) ([]byte, error)

	mu         sync.Mutex
	inProgress bool
}

// Update runs the whole sequence.
func (u *Updater) Update(ctx context.Context) (Result, error) {
	u.mu.Lock()
	if u.inProgress {
		u.mu.Unlock()
		// A distinct error rather than a generic failure: the client shows "already updating" as
		// information, not as a broken update.
		return Result{}, ErrInProgress
	}
	u.inProgress = true
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		u.inProgress = false
		u.mu.Unlock()
	}()

	result := Result{PreviousVersion: u.CurrentVersion}
	u.report(PhaseStarting)

	executable, err := u.executable()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	if reason := writableReason(executable); reason != "" {
		// Refused before downloading: a read-only volume produces a confusing permission error
		// later, and wasting the download tells the user less than refusing up front.
		result.Error = reason
		return result, nil
	}

	u.report(PhaseDownloading)
	payload, err := u.fetch(ctx)
	if err != nil {
		result.Error = fmt.Sprintf("download failed: %v", err)
		return result, nil
	}
	if len(payload) == 0 {
		result.Error = "the downloaded binary was empty"
		return result, nil
	}

	u.report(PhaseInstalling)
	if err := ReplaceBinary(executable, payload); err != nil {
		result.Error = fmt.Sprintf("install failed: %v", err)
		return result, nil
	}

	u.report(PhaseComplete)
	result.Success = true
	result.NewVersion = u.TargetVersion
	result.RestartRequired = true
	return result, nil
}

// report calls OnProgress.
func (u *Updater) report(phase Phase) {
	if u.OnProgress != nil {
		u.OnProgress(phase)
	}
}

// executable resolves the binary to replace.
func (u *Updater) executable() (string, error) {
	if u.ExecutablePath != "" {
		return u.ExecutablePath, nil
	}
	resolved, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("cannot locate the running binary: %w", err)
	}
	// A symlinked binary (a shim on PATH) must be replaced at its real path, or the update writes
	// through the symlink and leaves the target unchanged.
	if real, evalErr := filepath.EvalSymlinks(resolved); evalErr == nil {
		return real, nil
	}
	return resolved, nil
}

// fetch downloads the release payload.
func (u *Updater) fetch(ctx context.Context) ([]byte, error) {
	if u.Fetch != nil {
		return u.Fetch(ctx, u.TargetVersion)
	}
	return Download(ctx, u.TargetVersion)
}

// writableReason reports why the binary cannot be replaced, or "" when it can.
//
// A probe file answers the question instead of guessing from mode bits: an immutable flag or a
// read-only mount is not visible in them.
func writableReason(executable string) string {
	dir := filepath.Dir(executable)
	probe, err := os.CreateTemp(dir, ".byspace-update-probe-*")
	if err != nil {
		if os.IsPermission(err) {
			return fmt.Sprintf("cannot update: %s is not writable. Reinstall from a release archive, or move the binary somewhere you own.", dir)
		}
		if strings.Contains(strings.ToLower(err.Error()), "read-only") {
			return fmt.Sprintf("cannot update: %s is on a read-only volume.", dir)
		}
		return fmt.Sprintf("cannot update: %s is not writable (%v).", dir, err)
	}
	_ = probe.Close()
	_ = os.Remove(probe.Name())
	return ""
}

// ReplaceBinary writes the new binary over the old one.
//
// Write to a sibling temp file then rename: a rename within one directory is atomic, so a crash
// leaves either the old binary or the new one, never a truncated file. Writing in place would make
// an interrupted update unbootable.
func ReplaceBinary(executable string, payload []byte) error {
	dir := filepath.Dir(executable)
	temp, err := os.CreateTemp(dir, ".byspace-update-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}

	if _, err := temp.Write(payload); err != nil {
		cleanup()
		return err
	}
	if err := temp.Chmod(0o755); err != nil {
		cleanup()
		return err
	}
	if err := temp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Rename(tempPath, executable); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

// ReleaseBaseURL is where release archives live.
//
// BYSPACE_RELEASE_BASE_URL points it at a mirror: air-gapped and self-hosted installs fetch from
// somewhere other than GitHub, and the e2e suite uses it to exercise a failing download without
// reaching the network.
var ReleaseBaseURL = "https://github.com/ByteTrue/byspace/releases/download"

// releaseBaseURL resolves the download root, honouring the mirror override.
func releaseBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("BYSPACE_RELEASE_BASE_URL")); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return ReleaseBaseURL
}

// Download fetches the release archive for this platform.
func Download(ctx context.Context, version string) ([]byte, error) {
	tag := version
	if tag == "" {
		tag = "latest"
	} else if !strings.HasPrefix(tag, "v") {
		tag = "v" + tag
	}
	asset := "byspace-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		asset += ".exe"
	}
	url := releaseBaseURL() + "/" + tag + "/" + asset

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release download returned %d for %s", response.StatusCode, url)
	}
	return io.ReadAll(response.Body)
}
