package daemon

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"byspace/internal/agent"
	"byspace/internal/relay"
)

type Options struct {
	Home          string
	Listen        string
	Output        io.Writer
	WebDir        string
	RelayURL      string
	WorkspaceRoot string
	AgentManager  *agent.Manager
}

func Run(ctx context.Context, options Options) (runErr error) {
	if err := EnsureHome(options.Home); err != nil {
		return err
	}
	lease, err := acquireOwnership(options.Home)
	if err != nil {
		return err
	}
	defer func() {
		if err := lease.Release(); err != nil && runErr == nil {
			runErr = err
		}
	}()

	serverID, err := GetOrCreateServerID(options.Home)
	if err != nil {
		return err
	}
	if err := preparePIDPath(options.Home); err != nil {
		return err
	}

	catalog, err := newLocalCatalog(options.WorkspaceRoot, "pi")
	if err != nil {
		return err
	}
	assets, err := openWebAssets(options.WebDir)
	if err != nil {
		return err
	}
	defer assets.Close()

	listener, err := net.Listen("tcp", resolveListen(options.Listen))
	if err != nil {
		return fmt.Errorf("listen on %s: %w", resolveListen(options.Listen), err)
	}
	defer listener.Close()

	instanceID, err := randomID("inst_", 12)
	if err != nil {
		return err
	}
	shutdownToken, err := randomID("", 32)
	if err != nil {
		return err
	}
	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("resolve hostname: %w", err)
	}
	record := PIDRecord{
		PID:           os.Getpid(),
		StartedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Hostname:      hostname,
		UID:           currentUID(),
		Listen:        listener.Addr().String(),
		ServerID:      serverID,
		InstanceID:    instanceID,
		ShutdownToken: shutdownToken,
	}
	if err := writePIDRecordExclusive(options.Home, record); err != nil {
		return err
	}
	defer func() {
		if err := removePIDRecordIfOwned(options.Home, record); err != nil && runErr == nil {
			runErr = err
		}
	}()

	agentManager := options.AgentManager
	if agentManager == nil {
		agentManager, err = newAgentManager(ctx, options.Home)
		if err != nil {
			return fmt.Errorf("open Agent manager: %w", err)
		}
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := agentManager.Close(closeCtx); err != nil && runErr == nil {
			runErr = fmt.Errorf("close agent manager: %w", err)
		}
	}()

	webSockets := newAgentWebSocketHandler(agentManager, catalog, record.ServerID, record.Hostname)
	defer webSockets.Close()

	output := options.Output
	if output == nil {
		output = io.Discard
	}
	var remoteRelay *relayRuntime
	if options.RelayURL != "" {
		identity, identityErr := relay.LoadOrCreateIdentity(relay.IdentityPath(options.Home))
		if identityErr != nil {
			return fmt.Errorf("open Relay identity: %w", identityErr)
		}
		remoteRelay, err = startRelayRuntime(ctx, options.RelayURL, record.ServerID, identity, webSockets, output)
		if err != nil {
			return err
		}
		webSockets.setPairingOfferProvider(func(appURL, expectedRelayURL string) (pairingOfferResult, error) {
			return buildPairingOffer(appURL, expectedRelayURL, remoteRelay)
		})
		defer remoteRelay.Close()
	}

	shutdownRequested := make(chan struct{}, 1)
	mux := http.NewServeMux()
	mux.Handle("GET /ws", webSockets)
	mux.HandleFunc("GET /healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(Health{
			Product:    "byspace",
			Status:     "ok",
			ServerID:   record.ServerID,
			InstanceID: record.InstanceID,
			PID:        record.PID,
			Listen:     record.Listen,
		})
	})
	mux.HandleFunc("POST /shutdown", func(writer http.ResponseWriter, request *http.Request) {
		expected := "Bearer " + record.ShutdownToken
		provided := request.Header.Get("Authorization")
		if len(expected) != len(provided) || subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) != 1 {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		writer.WriteHeader(http.StatusAccepted)
		if flusher, ok := writer.(http.Flusher); ok {
			flusher.Flush()
		}
		select {
		case shutdownRequested <- struct{}{}:
		default:
		}
	})
	if assets != nil {
		mux.Handle("/", assets)
	}

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.Serve(listener)
	}()

	fmt.Fprintf(output, "byspace daemon listening on %s (PID %d)\n", record.Listen, record.PID)

	select {
	case <-ctx.Done():
	case <-shutdownRequested:
	case runErr = <-serveResult:
		if errors.Is(runErr, http.ErrServerClosed) {
			runErr = nil
		}
	}

	if remoteRelay != nil {
		remoteRelay.Close()
	}
	webSockets.Close()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil && runErr == nil {
		runErr = fmt.Errorf("shutdown daemon HTTP server: %w", err)
	}
	if runErr != nil {
		return fmt.Errorf("serve daemon HTTP: %w", runErr)
	}
	return nil
}

func preparePIDPath(home string) error {
	record, err := ReadPIDRecord(home)
	if errors.Is(err, ErrNoPIDRecord) {
		return nil
	}
	if err != nil {
		return err
	}
	// The caller holds daemon.lock. A record left behind while that advisory
	// lock is available cannot belong to a running byspace daemon.
	return removePIDRecordIfOwned(home, record)
}

func cleanupStalePIDRecord(home string, expected PIDRecord) (removed bool, cleanupErr error) {
	lease, err := acquireOwnership(home)
	if err != nil {
		return false, err
	}
	defer func() {
		if err := lease.Release(); err != nil && cleanupErr == nil {
			cleanupErr = err
		}
	}()

	current, err := ReadPIDRecord(home)
	if errors.Is(err, ErrNoPIDRecord) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if current.PID != expected.PID || current.InstanceID != expected.InstanceID || current.ShutdownToken != expected.ShutdownToken {
		return false, nil
	}
	if err := removePIDRecordIfOwned(home, current); err != nil {
		return false, err
	}
	return true, nil
}

func CleanupFailedStart(home string, expectedPID int) error {
	record, err := ReadPIDRecord(home)
	if errors.Is(err, ErrNoPIDRecord) {
		return nil
	}
	if err != nil {
		return err
	}
	if record.PID != expectedPID {
		return nil
	}
	_, err = cleanupStalePIDRecord(home, record)
	return err
}

func writePIDRecordExclusive(home string, record PIDRecord) error {
	file, err := os.OpenFile(PIDPath(home), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		existing, readErr := ReadPIDRecord(home)
		if readErr != nil {
			return readErr
		}
		return fmt.Errorf("another byspace daemon owns %s (PID %d)", PIDPath(home), existing.PID)
	}
	if err != nil {
		return fmt.Errorf("create daemon PID record: %w", err)
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(record); err != nil {
		file.Close()
		os.Remove(PIDPath(home))
		return fmt.Errorf("write daemon PID record: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close daemon PID record: %w", err)
	}
	return nil
}

func removePIDRecordIfOwned(home string, owner PIDRecord) error {
	current, err := ReadPIDRecord(home)
	if errors.Is(err, ErrNoPIDRecord) {
		return nil
	}
	if err != nil {
		return err
	}
	if current.PID != owner.PID || current.InstanceID != owner.InstanceID || current.ShutdownToken != owner.ShutdownToken {
		return errors.New("daemon PID ownership changed; refusing to remove record")
	}
	if err := os.Remove(PIDPath(home)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove daemon PID record: %w", err)
	}
	return nil
}
