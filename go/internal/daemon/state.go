package daemon

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultListen = "127.0.0.1:6767"
	pidFilename   = "byspace.pid"
	serverIDFile  = "server-id"
	logFilename   = "daemon.log"
)

var (
	ErrNoPIDRecord   = errors.New("daemon PID record does not exist")
	daemonHTTPClient = &http.Client{
		Transport: &http.Transport{Proxy: nil},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
)

type PIDRecord struct {
	PID           int    `json:"pid"`
	StartedAt     string `json:"startedAt"`
	Hostname      string `json:"hostname"`
	UID           *int   `json:"uid,omitempty"`
	Listen        string `json:"listen"`
	ServerID      string `json:"serverId"`
	InstanceID    string `json:"instanceId"`
	ShutdownToken string `json:"shutdownToken"`
}

type Health struct {
	Product    string `json:"product"`
	Status     string `json:"status"`
	ServerID   string `json:"serverId"`
	InstanceID string `json:"instanceId"`
	PID        int    `json:"pid"`
	Listen     string `json:"listen"`
}

type Status struct {
	ServerID    string  `json:"serverId"`
	LocalDaemon string  `json:"localDaemon"`
	Home        string  `json:"home"`
	Listen      string  `json:"listen"`
	PID         *int    `json:"pid"`
	StartedAt   *string `json:"startedAt"`
	Hostname    *string `json:"hostname"`
	LogPath     string  `json:"logPath"`
	Note        string  `json:"note,omitempty"`
}

func ResolveHome(explicit string) (string, error) {
	home := strings.TrimSpace(explicit)
	if home == "" {
		home = strings.TrimSpace(os.Getenv("BYSPACE_HOME"))
	}
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve user home: %w", err)
		}
		home = filepath.Join(userHome, ".byspace")
	} else if home == "~" || strings.HasPrefix(home, "~/") {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve user home: %w", err)
		}
		if home == "~" {
			home = userHome
		} else {
			home = filepath.Join(userHome, strings.TrimPrefix(home, "~/"))
		}
	}

	resolved, err := filepath.Abs(home)
	if err != nil {
		return "", fmt.Errorf("resolve byspace home: %w", err)
	}
	return filepath.Clean(resolved), nil
}

func EnsureHome(home string) error {
	if err := os.MkdirAll(home, 0o700); err != nil {
		return fmt.Errorf("create byspace home: %w", err)
	}
	if err := os.Chmod(home, 0o700); err != nil {
		return fmt.Errorf("secure byspace home: %w", err)
	}
	return nil
}

func PIDPath(home string) string { return filepath.Join(home, pidFilename) }
func LogPath(home string) string { return filepath.Join(home, logFilename) }

func GetOrCreateServerID(home string) (string, error) {
	if err := EnsureHome(home); err != nil {
		return "", err
	}
	path := filepath.Join(home, serverIDFile)
	if serverID, err := readServerID(path); err == nil {
		return serverID, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	serverID, err := randomID("srv_", 9)
	if err != nil {
		return "", err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return readServerID(path)
	}
	if err != nil {
		return "", fmt.Errorf("create server ID: %w", err)
	}
	if _, writeErr := fmt.Fprintln(file, serverID); writeErr != nil {
		file.Close()
		os.Remove(path)
		return "", fmt.Errorf("write server ID: %w", writeErr)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close server ID: %w", err)
	}
	return serverID, nil
}

func readServerID(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", fmt.Errorf("secure server ID: %w", err)
	}
	serverID := strings.TrimSpace(string(data))
	encoded := strings.TrimPrefix(serverID, "srv_")
	decoded, decodeErr := base64.RawURLEncoding.DecodeString(encoded)
	if !strings.HasPrefix(serverID, "srv_") || decodeErr != nil || len(decoded) != 9 {
		return "", errors.New("server ID file is invalid")
	}
	return serverID, nil
}

func ReadPIDRecord(home string) (PIDRecord, error) {
	data, err := os.ReadFile(PIDPath(home))
	if errors.Is(err, os.ErrNotExist) {
		return PIDRecord{}, ErrNoPIDRecord
	}
	if err != nil {
		return PIDRecord{}, fmt.Errorf("read daemon PID record: %w", err)
	}
	var record PIDRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return PIDRecord{}, fmt.Errorf("invalid daemon PID record: %w", err)
	}
	if err := validatePIDRecord(record); err != nil {
		return PIDRecord{}, fmt.Errorf("invalid daemon PID record: %w", err)
	}
	return record, nil
}

func Inspect(ctx context.Context, home string) (Status, error) {
	if err := EnsureHome(home); err != nil {
		return Status{}, err
	}
	serverID, err := GetOrCreateServerID(home)
	if err != nil {
		return Status{}, err
	}
	status := Status{
		ServerID:    serverID,
		LocalDaemon: "stopped",
		Home:        home,
		Listen:      resolveListen(""),
		LogPath:     LogPath(home),
	}

	record, err := ReadPIDRecord(home)
	if errors.Is(err, ErrNoPIDRecord) {
		return status, nil
	}
	if err != nil {
		status.LocalDaemon = "invalid_pid"
		status.Note = err.Error()
		return status, nil
	}
	status.Listen = record.Listen
	status.PID = &record.PID
	status.StartedAt = &record.StartedAt
	status.Hostname = &record.Hostname

	available, err := ownershipAvailable(home)
	if err != nil {
		return Status{}, fmt.Errorf("inspect daemon ownership: %w", err)
	}
	if available {
		status.LocalDaemon = "stale_pid"
		status.Note = "PID record has no active daemon ownership lease"
		return status, nil
	}
	if record.ServerID != serverID {
		status.LocalDaemon = "unresponsive"
		status.Note = "daemon PID record does not belong to this byspace home"
		return status, nil
	}
	if _, err := Probe(ctx, record); err != nil {
		status.LocalDaemon = "unresponsive"
		status.Note = err.Error()
		return status, nil
	}
	status.LocalDaemon = "running"
	return status, nil
}

func Probe(ctx context.Context, record PIDRecord) (Health, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, healthURL(record.Listen), nil)
	if err != nil {
		return Health{}, fmt.Errorf("create health request: %w", err)
	}
	resp, err := daemonHTTPClient.Do(req)
	if err != nil {
		return Health{}, fmt.Errorf("daemon health probe failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Health{}, fmt.Errorf("daemon health probe returned %s", resp.Status)
	}
	var health Health
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&health); err != nil {
		return Health{}, fmt.Errorf("decode daemon health: %w", err)
	}
	if health.Product != "byspace" || health.Status != "ok" || health.PID != record.PID ||
		health.ServerID != record.ServerID || health.InstanceID != record.InstanceID ||
		health.Listen != record.Listen {
		return Health{}, errors.New("daemon health identity does not match PID record")
	}
	return health, nil
}

func Stop(ctx context.Context, home string) (bool, Status, error) {
	status, err := Inspect(ctx, home)
	if err != nil {
		return false, Status{}, err
	}
	switch status.LocalDaemon {
	case "stopped":
		return false, status, nil
	case "stale_pid":
		record, readErr := ReadPIDRecord(home)
		if readErr != nil {
			return false, status, readErr
		}
		removed, cleanupErr := cleanupStalePIDRecord(home, record)
		if cleanupErr != nil {
			return false, status, cleanupErr
		}
		current, inspectErr := Inspect(ctx, home)
		if inspectErr != nil {
			return false, current, inspectErr
		}
		if !removed && current.LocalDaemon != "stopped" {
			return false, current, errors.New("daemon ownership changed while removing stale PID record")
		}
		return false, current, nil
	case "invalid_pid":
		return false, status, errors.New(status.Note)
	case "unresponsive":
		return false, status, fmt.Errorf("refusing to stop daemon with unverified health identity at PID %d: %s", valueOrZero(status.PID), status.Note)
	}

	record, err := ReadPIDRecord(home)
	if err != nil {
		return false, status, err
	}
	if _, err := Probe(ctx, record); err != nil {
		return false, status, fmt.Errorf("refusing to stop daemon after ownership changed: %w", err)
	}
	if err := requestShutdown(ctx, record); err != nil {
		return false, status, err
	}

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		current, inspectErr := Inspect(ctx, home)
		if inspectErr == nil && (current.LocalDaemon == "stopped" || current.LocalDaemon == "stale_pid") {
			if current.LocalDaemon == "stale_pid" {
				removed, cleanupErr := cleanupStalePIDRecord(home, record)
				if cleanupErr != nil {
					return false, current, cleanupErr
				}
				current, inspectErr = Inspect(ctx, home)
				if !removed && inspectErr == nil && current.LocalDaemon != "stopped" {
					return false, current, errors.New("daemon ownership changed during shutdown")
				}
			}
			return true, current, inspectErr
		}
		select {
		case <-ctx.Done():
			return false, status, fmt.Errorf("wait for daemon shutdown: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func requestShutdown(ctx context.Context, record PIDRecord) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, shutdownURL(record.Listen), nil)
	if err != nil {
		return fmt.Errorf("create shutdown request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+record.ShutdownToken)
	resp, err := daemonHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("request daemon shutdown: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("daemon rejected shutdown: %s", resp.Status)
	}
	return nil
}

func resolveListen(explicit string) string {
	if listen := strings.TrimSpace(explicit); listen != "" {
		return listen
	}
	return DefaultListen
}

func ResolveListen(explicit string) string { return resolveListen(explicit) }

func healthURL(listen string) string   { return "http://" + reachableAddress(listen) + "/healthz" }
func shutdownURL(listen string) string { return "http://" + reachableAddress(listen) + "/shutdown" }

func ReachableAddress(listen string) string { return reachableAddress(listen) }

func reachableAddress(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return listen
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}

func randomID(prefix string, byteCount int) (string, error) {
	data := make([]byte, byteCount)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate random ID: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(data), nil
}

func validatePIDRecord(record PIDRecord) error {
	if record.PID <= 1 {
		return errors.New("pid must be greater than 1")
	}
	if _, err := time.Parse(time.RFC3339Nano, record.StartedAt); err != nil {
		return errors.New("startedAt must be RFC3339")
	}
	if strings.TrimSpace(record.Hostname) == "" || strings.TrimSpace(record.Listen) == "" ||
		strings.TrimSpace(record.ServerID) == "" || strings.TrimSpace(record.InstanceID) == "" ||
		strings.TrimSpace(record.ShutdownToken) == "" {
		return errors.New("required PID record field is empty")
	}
	_, portText, err := net.SplitHostPort(record.Listen)
	if err != nil {
		return errors.New("listen must be a TCP host:port")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("listen port must be between 1 and 65535")
	}
	return nil
}

func currentUID() *int {
	current, err := user.Current()
	if err != nil {
		return nil
	}
	uid, err := strconv.Atoi(current.Uid)
	if err != nil {
		return nil
	}
	return &uid
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
