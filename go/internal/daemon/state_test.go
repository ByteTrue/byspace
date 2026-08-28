package daemon

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"byspace/internal/agent"
)

func TestResolveHomeAndStableServerID(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("BYSPACE_HOME", home)

	resolved, err := ResolveHome("")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != home {
		t.Fatalf("ResolveHome() = %q, want %q", resolved, home)
	}

	first, err := GetOrCreateServerID(resolved)
	if err != nil {
		t.Fatal(err)
	}
	second, err := GetOrCreateServerID(resolved)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("server ID changed: %q != %q", first, second)
	}
	if len(first) != len("srv_")+12 {
		t.Fatalf("server ID %q has unexpected length", first)
	}
	if runtime.GOOS != "windows" {
		assertMode(t, resolved, 0o700)
		assertMode(t, filepath.Join(resolved, serverIDFile), 0o600)
	}
	if err := os.WriteFile(filepath.Join(resolved, serverIDFile), []byte("not-a-server-id\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := GetOrCreateServerID(resolved); err == nil {
		t.Fatal("invalid server ID was accepted")
	}
}

func TestInspectClassifiesInvalidAndStalePIDRecords(t *testing.T) {
	home := t.TempDir()
	if _, err := GetOrCreateServerID(home); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(PIDPath(home), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := Inspect(context.Background(), home)
	if err != nil {
		t.Fatal(err)
	}
	if status.LocalDaemon != "invalid_pid" {
		t.Fatalf("invalid record status = %q", status.LocalDaemon)
	}

	if err := os.Remove(PIDPath(home)); err != nil {
		t.Fatal(err)
	}
	record := testPIDRecord(t, home, os.Getpid())
	if err := writePIDRecordExclusive(home, record); err != nil {
		t.Fatal(err)
	}
	status, err = Inspect(context.Background(), home)
	if err != nil {
		t.Fatal(err)
	}
	if status.LocalDaemon != "stale_pid" {
		t.Fatalf("stale record status = %q (%s)", status.LocalDaemon, status.Note)
	}

	if err := os.Remove(PIDPath(home)); err != nil {
		t.Fatal(err)
	}
	record.PID = os.Getpid()
	record.ServerID = "srv_AAAAAAAAAAAA"
	if err := writePIDRecordExclusive(home, record); err != nil {
		t.Fatal(err)
	}
	lease, err := acquireOwnership(home)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()
	status, err = Inspect(context.Background(), home)
	if err != nil {
		t.Fatal(err)
	}
	if status.LocalDaemon != "unresponsive" || status.Note != "daemon PID record does not belong to this byspace home" {
		t.Fatalf("foreign record status = %q (%s)", status.LocalDaemon, status.Note)
	}
}

func TestRunHealthAuthorizationAndGracefulStop(t *testing.T) {
	home := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runResult := make(chan error, 1)
	go func() {
		runResult <- Run(ctx, Options{Home: home, Listen: "127.0.0.1:0"})
	}()

	record := waitForPIDRecord(t, home)
	health, err := Probe(context.Background(), record)
	if err != nil {
		t.Fatal(err)
	}
	if health.ServerID != record.ServerID || health.PID != os.Getpid() {
		t.Fatalf("unexpected health payload: %+v", health)
	}

	request, err := http.NewRequest(http.MethodPost, shutdownURL(record.Listen), nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized shutdown status = %d", response.StatusCode)
	}
	if _, err := Probe(context.Background(), record); err != nil {
		t.Fatalf("daemon stopped after unauthorized request: %v", err)
	}

	stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer stopCancel()
	stopped, status, err := Stop(stopCtx, home)
	if err != nil {
		t.Fatal(err)
	}
	if !stopped || status.LocalDaemon != "stopped" {
		t.Fatalf("Stop() = %v, %q", stopped, status.LocalDaemon)
	}
	if err := <-runResult; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(PIDPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("PID record still exists: %v", err)
	}
}

func TestRunClosesAgentManagerBeforeReleasingOwnership(t *testing.T) {
	home := t.TempDir()
	provider := &daemonTestProvider{session: &daemonTestSession{events: make(chan agent.ProviderEvent)}}
	manager := agent.NewManager(map[string]agent.Provider{"pi": provider})
	snapshot, err := manager.Create(context.Background(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	runResult := make(chan error, 1)
	go func() {
		runResult <- Run(context.Background(), Options{
			Home:         home,
			Listen:       "127.0.0.1:0",
			AgentManager: manager,
		})
	}()
	waitForPIDRecord(t, home)
	stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, _, err := Stop(stopCtx, home); err != nil {
		t.Fatal(err)
	}
	if err := <-runResult; err != nil {
		t.Fatal(err)
	}
	if !provider.session.wasClosed() {
		t.Fatal("daemon exited without closing the provider session")
	}
	closed, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Lifecycle != agent.LifecycleClosed {
		t.Fatalf("agent lifecycle after daemon exit = %q", closed.Lifecycle)
	}
}

type daemonTestProvider struct {
	session *daemonTestSession
}

func (provider *daemonTestProvider) Start(context.Context, agent.Config) (agent.Session, error) {
	return provider.session, nil
}

type daemonTestSession struct {
	mu     sync.Mutex
	events chan agent.ProviderEvent
	closed bool
}

func (session *daemonTestSession) RuntimeInfo() agent.RuntimeInfo {
	return agent.RuntimeInfo{Provider: "pi", SessionID: "daemon-test-session"}
}
func (session *daemonTestSession) Capabilities() agent.Capabilities             { return agent.Capabilities{} }
func (session *daemonTestSession) Events() <-chan agent.ProviderEvent           { return session.events }
func (session *daemonTestSession) Prompt(context.Context, string, string) error { return nil }
func (session *daemonTestSession) Abort(context.Context) error                  { return nil }
func (session *daemonTestSession) Close(context.Context) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if !session.closed {
		session.closed = true
		close(session.events)
	}
	return nil
}
func (session *daemonTestSession) wasClosed() bool {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.closed
}

func waitForPIDRecord(t *testing.T, home string) PIDRecord {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		record, err := ReadPIDRecord(home)
		if err == nil {
			return record
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for PID record")
	return PIDRecord{}
}

func testPIDRecord(t *testing.T, home string, pid int) PIDRecord {
	t.Helper()
	serverID, err := GetOrCreateServerID(home)
	if err != nil {
		t.Fatal(err)
	}
	return PIDRecord{
		PID:           pid,
		StartedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Hostname:      "test-host",
		Listen:        "127.0.0.1:1",
		ServerID:      serverID,
		InstanceID:    "inst_test",
		ShutdownToken: "secret",
	}
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode = %o, want %o", path, got, want)
	}
}
