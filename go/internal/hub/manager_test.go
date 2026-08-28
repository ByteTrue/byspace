package hub

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type fakeRemote struct {
	mu           sync.Mutex
	enroll       func(context.Context, enrollmentRequest) (enrollmentResult, error)
	revoke       func(context.Context, revocationRequest) error
	dial         func(context.Context, socketRequest) (hubSocket, int, error)
	enrollInputs []enrollmentRequest
	revokeInputs []revocationRequest
	dialInputs   []socketRequest
}

func (remote *fakeRemote) Enroll(ctx context.Context, input enrollmentRequest) (enrollmentResult, error) {
	remote.mu.Lock()
	remote.enrollInputs = append(remote.enrollInputs, input)
	operation := remote.enroll
	remote.mu.Unlock()
	return operation(ctx, input)
}

func (remote *fakeRemote) Revoke(ctx context.Context, input revocationRequest) error {
	remote.mu.Lock()
	remote.revokeInputs = append(remote.revokeInputs, input)
	operation := remote.revoke
	remote.mu.Unlock()
	if operation == nil {
		return nil
	}
	return operation(ctx, input)
}

func (remote *fakeRemote) Dial(ctx context.Context, input socketRequest) (hubSocket, int, error) {
	remote.mu.Lock()
	remote.dialInputs = append(remote.dialInputs, input)
	operation := remote.dial
	remote.mu.Unlock()
	return operation(ctx, input)
}

type blockingSocket struct {
	read chan socketRead
}

type socketRead struct {
	messageType websocket.MessageType
	data        []byte
	err         error
}

func newBlockingSocket() *blockingSocket { return &blockingSocket{read: make(chan socketRead, 1)} }

func (socket *blockingSocket) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	select {
	case <-ctx.Done():
		return 0, nil, ctx.Err()
	case result := <-socket.read:
		return result.messageType, result.data, result.err
	}
}
func (*blockingSocket) Close(websocket.StatusCode, string) error { return nil }
func (*blockingSocket) CloseNow() error                          { return nil }

func TestManagerConnectPersistsBeforeEnrollmentAndReconnects(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	socket := newBlockingSocket()
	remote := &fakeRemote{}
	remote.enroll = func(_ context.Context, input enrollmentRequest) (enrollmentResult, error) {
		data, err := os.ReadFile(relationshipPath(home))
		if err != nil {
			t.Fatalf("pending record was not durable before enrollment: %v", err)
		}
		if !strings.Contains(string(data), input.IdempotencyKey) || !strings.Contains(string(data), input.Token) {
			t.Fatal("pending record does not contain retry authority")
		}
		if strings.Contains(string(data), input.CredentialVerifier) {
			t.Fatal("pending record stored verifier instead of the private credential")
		}
		return enrollmentResult{
			DaemonID: input.DaemonID, Scopes: []string{executionScope},
			WebSocketURL: "wss://hub.byspace.test/api/daemons/socket",
		}, nil
	}
	remote.dial = func(context.Context, socketRequest) (hubSocket, int, error) {
		return socket, 101, nil
	}
	manager := newTestManager(t, home, remote)
	token := strings.Repeat("t", 32)
	status, err := manager.Connect(context.Background(), "https://hub.byspace.test/", token)
	if err != nil {
		t.Fatal(err)
	}
	if status.State != StateConnecting && status.State != StateConnected {
		t.Fatalf("Connect() state = %q", status.State)
	}
	waitForHubState(t, manager, StateConnected)
	status = manager.Status()
	if status.DaemonID == nil || status.HubOrigin == nil || *status.HubOrigin != "https://hub.byspace.test" {
		t.Fatalf("Status() = %#v", status)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), token) || strings.Contains(string(encoded), testManagerSecret()) {
		t.Fatalf("status leaks authority: %s", encoded)
	}
	manager.Close()

	restartSocket := newBlockingSocket()
	remote.dial = func(context.Context, socketRequest) (hubSocket, int, error) {
		return restartSocket, 101, nil
	}
	restarted := newTestManager(t, home, remote)
	defer restarted.Close()
	waitForHubState(t, restarted, StateConnected)
	if restarted.Status().DaemonID == nil || *restarted.Status().DaemonID != *status.DaemonID {
		t.Fatal("restart changed daemon relationship identity")
	}
}

func TestManagerRejectedEnrollmentRemovesAuthority(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	remote := &fakeRemote{
		enroll: func(context.Context, enrollmentRequest) (enrollmentResult, error) {
			return enrollmentResult{}, &enrollmentRejectedError{statusCode: 401}
		},
		dial: func(context.Context, socketRequest) (hubSocket, int, error) {
			t.Fatal("Dial called")
			return nil, 0, nil
		},
	}
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32)); err == nil {
		t.Fatal("Connect() succeeded")
	}
	if manager.Status().State != StateNotConnected {
		t.Fatalf("state = %q", manager.Status().State)
	}
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected authority remains: %v", err)
	}
}

func TestManagerRejectedEnrollmentPoisonsWhenCleanupDurabilityIsUncertain(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	var attempts atomic.Int32
	remote := &fakeRemote{
		enroll: func(context.Context, enrollmentRequest) (enrollmentResult, error) {
			if attempts.Add(1) == 1 {
				return enrollmentResult{}, &retryAfterError{statusCode: 503, delay: 50 * time.Millisecond}
			}
			return enrollmentResult{}, &enrollmentRejectedError{statusCode: 401}
		},
		dial: func(context.Context, socketRequest) (hubSocket, int, error) {
			t.Fatal("Dial called")
			return nil, 0, nil
		},
	}
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	var failSync atomic.Bool
	manager.store.syncDirectory = func(path string) error {
		if failSync.Load() {
			return errors.New("injected cleanup sync failure")
		}
		return syncRelationshipDirectory(path)
	}
	status, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32))
	if err != nil || status.State != StateReconnecting {
		t.Fatalf("Connect() = (%+v, %v)", status, err)
	}
	failSync.Store(true)
	waitForHubState(t, manager, StateRevoked)
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected canonical authority remains: %v", err)
	}
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32)); err == nil || !strings.Contains(err.Error(), "restart") {
		t.Fatalf("Connect() after cleanup uncertainty error = %v", err)
	}
}

func TestManagerRetriesTransientEnrollmentWithSameAuthority(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	socket := newBlockingSocket()
	var attempts int
	remote := &fakeRemote{}
	remote.enroll = func(_ context.Context, input enrollmentRequest) (enrollmentResult, error) {
		attempts++
		if attempts == 1 {
			return enrollmentResult{}, errors.New("Hub enrollment failed (503)")
		}
		return enrollmentResult{DaemonID: input.DaemonID, Scopes: []string{executionScope}, WebSocketURL: "wss://hub.byspace.test/socket"}, nil
	}
	remote.dial = func(context.Context, socketRequest) (hubSocket, int, error) { return socket, 101, nil }
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	status, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32))
	if err != nil {
		t.Fatal(err)
	}
	if status.State != StateReconnecting {
		t.Fatalf("state = %q", status.State)
	}
	waitForHubState(t, manager, StateConnected)
	remote.mu.Lock()
	inputs := append([]enrollmentRequest(nil), remote.enrollInputs...)
	remote.mu.Unlock()
	if len(inputs) < 2 || inputs[0].DaemonID != inputs[1].DaemonID || inputs[0].IdempotencyKey != inputs[1].IdempotencyKey || inputs[0].CredentialVerifier != inputs[1].CredentialVerifier {
		t.Fatalf("retry authority changed: %#v", inputs)
	}
}

func TestManagerDisconnectsPendingEnrollmentWithDurableRevocationIntent(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	remote := &fakeRemote{}
	remote.enroll = func(context.Context, enrollmentRequest) (enrollmentResult, error) {
		return enrollmentResult{}, &retryAfterError{statusCode: 503, delay: time.Hour}
	}
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	status, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32))
	if err != nil || status.State != StateReconnecting {
		t.Fatalf("Connect() = (%+v, %v)", status, err)
	}
	result, err := manager.Disconnect(context.Background(), false)
	if err != nil || result.Status.State != StateNotConnected {
		t.Fatalf("Disconnect() = (%+v, %v)", result, err)
	}
	remote.mu.Lock()
	revocations := append([]revocationRequest(nil), remote.revokeInputs...)
	remote.mu.Unlock()
	if len(revocations) != 1 || revocations[0].Credential != testManagerSecret() {
		t.Fatalf("revocations = %#v", revocations)
	}
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending relationship remains after disconnect: %v", err)
	}
}

func TestManagerHonorsEnrollmentRetryAfter(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	socket := newBlockingSocket()
	var attempts atomic.Int32
	remote := &fakeRemote{}
	remote.enroll = func(_ context.Context, input enrollmentRequest) (enrollmentResult, error) {
		if attempts.Add(1) == 1 {
			return enrollmentResult{}, &retryAfterError{statusCode: 429, delay: 75 * time.Millisecond}
		}
		return enrollmentResult{DaemonID: input.DaemonID, Scopes: []string{executionScope}, WebSocketURL: "wss://hub.byspace.test/socket"}, nil
	}
	remote.dial = func(context.Context, socketRequest) (hubSocket, int, error) { return socket, 101, nil }
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	started := time.Now()
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if attempts.Load() != 1 {
		t.Fatalf("enrollment retried before Retry-After: %d attempts", attempts.Load())
	}
	waitForHubState(t, manager, StateConnected)
	if elapsed := time.Since(started); elapsed < 70*time.Millisecond {
		t.Fatalf("Retry-After elapsed = %s", elapsed)
	}
}

func TestManagerRejectsMismatchedEnrollmentAuthority(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	remote := successfulFakeRemote(newBlockingSocket())
	remote.enroll = func(_ context.Context, input enrollmentRequest) (enrollmentResult, error) {
		return enrollmentResult{DaemonID: input.DaemonID, Scopes: []string{"hub.execution.read"}, WebSocketURL: "wss://hub.byspace.test/socket"}, nil
	}
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("r", 32)); err == nil {
		t.Fatal("Connect() accepted widened or changed scopes")
	}
	if manager.Status().State != StateNotConnected {
		t.Fatalf("state = %q", manager.Status().State)
	}
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("mismatched authority remains: %v", err)
	}
}

func TestManagerPoisonsAfterPostReplacePersistenceUncertainty(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	remote := &fakeRemote{}
	manager := newTestManager(t, home, remote)
	manager.store.syncDirectory = func(string) error { return errors.New("injected sync failure") }
	status, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("u", 32))
	if err == nil || status.State != StateReconnecting {
		t.Fatalf("Connect() = (%+v, %v)", status, err)
	}
	remote.mu.Lock()
	enrollCalls := len(remote.enrollInputs)
	remote.mu.Unlock()
	if enrollCalls != 0 {
		t.Fatalf("enroll calls = %d, want 0", enrollCalls)
	}
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("u", 32)); err == nil || !strings.Contains(err.Error(), "restart") {
		t.Fatalf("second Connect() error = %v", err)
	}
	manager.Close()

	recovered := newTestManager(t, home, successfulFakeRemote(newBlockingSocket()))
	defer recovered.Close()
	waitForHubState(t, recovered, StateConnected)
}

func TestManagerRestartDuringPendingEnrollmentReusesAuthority(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	firstRemote := &fakeRemote{}
	firstRemote.enroll = func(context.Context, enrollmentRequest) (enrollmentResult, error) {
		return enrollmentResult{}, &retryAfterError{statusCode: 503, delay: time.Hour}
	}
	firstRemote.dial = func(context.Context, socketRequest) (hubSocket, int, error) {
		t.Fatal("Dial called before enrollment")
		return nil, 0, nil
	}
	first := newTestManager(t, home, firstRemote)
	status, err := first.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("t", 32))
	if err != nil || status.State != StateReconnecting {
		t.Fatalf("Connect() = (%+v, %v)", status, err)
	}
	first.Close()

	secondRemote := successfulFakeRemote(newBlockingSocket())
	second := newTestManager(t, home, secondRemote)
	defer second.Close()
	waitForHubState(t, second, StateConnected)
	firstRemote.mu.Lock()
	firstInput := firstRemote.enrollInputs[0]
	firstRemote.mu.Unlock()
	secondRemote.mu.Lock()
	secondInput := secondRemote.enrollInputs[0]
	secondRemote.mu.Unlock()
	if firstInput.DaemonID != secondInput.DaemonID || firstInput.IdempotencyKey != secondInput.IdempotencyKey || firstInput.CredentialVerifier != secondInput.CredentialVerifier || firstInput.Token != secondInput.Token {
		t.Fatalf("pending restart authority changed: first=%+v second=%+v", firstInput, secondInput)
	}
}

func TestManagerRapidDisconnectReconnectFencesOldLifecycle(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	remote := successfulFakeRemote(newBlockingSocket())
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("a", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, manager, StateConnected)
	firstID := *manager.Status().DaemonID
	if _, err := manager.Disconnect(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("b", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, manager, StateConnected)
	if manager.Status().DaemonID == nil || *manager.Status().DaemonID == firstID {
		t.Fatalf("new relationship did not replace %q: %#v", firstID, manager.Status())
	}
	time.Sleep(5 * time.Millisecond)
	if manager.Status().State != StateConnected {
		t.Fatalf("stale lifecycle changed state to %q", manager.Status().State)
	}
}

func TestManagerRestartReconnectsWithSameAuthority(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	firstRemote := successfulFakeRemote(newBlockingSocket())
	first := newTestManager(t, home, firstRemote)
	if _, err := first.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("t", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, first, StateConnected)
	first.Close()

	secondRemote := successfulFakeRemote(newBlockingSocket())
	second := newTestManager(t, home, secondRemote)
	defer second.Close()
	waitForHubState(t, second, StateConnected)

	firstRemote.mu.Lock()
	firstDial := firstRemote.dialInputs[0]
	firstRemote.mu.Unlock()
	secondRemote.mu.Lock()
	secondDial := secondRemote.dialInputs[0]
	secondRemote.mu.Unlock()
	if firstDial.DaemonID != secondDial.DaemonID || firstDial.Credential != secondDial.Credential || firstDial.WebSocketURL != secondDial.WebSocketURL {
		t.Fatalf("restart authority changed: first=%+v second=%+v", firstDial, secondDial)
	}
}

func TestManagerDisconnectRetainsAuthorityWhenHubUnavailableUnlessForced(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	socket := newBlockingSocket()
	remote := successfulFakeRemote(socket)
	manager := newTestManager(t, home, remote)
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("t", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, manager, StateConnected)
	remote.revoke = func(context.Context, revocationRequest) error { return errors.New("offline") }
	result, err := manager.Disconnect(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "durable retry remains pending") {
		t.Fatalf("Disconnect() error = %v", err)
	}
	if result.Status.State != StateDisconnecting {
		t.Fatalf("Disconnect() = %#v", result)
	}
	if _, err := os.Stat(relationshipPath(home)); err != nil {
		t.Fatalf("local authority was not retained: %v", err)
	}
	result, err = manager.Disconnect(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status.State != StateNotConnected || result.Warning == "" {
		t.Fatalf("Disconnect(force) = %#v", result)
	}
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("local authority remains: %v", err)
	}
	manager.Close()
}

func TestManagerResumesInterruptedRevocationOnRestart(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	firstRemote := successfulFakeRemote(newBlockingSocket())
	first := newTestManager(t, home, firstRemote)
	if _, err := first.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("t", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, first, StateConnected)
	firstRemote.revoke = func(context.Context, revocationRequest) error { return errors.New("offline") }
	if _, err := first.Disconnect(context.Background(), false); err == nil {
		t.Fatal("Disconnect() succeeded while Hub was offline")
	}
	first.Close()

	store := newRelationshipStore(relationshipPath(home))
	stored, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.State != "disconnecting" {
		t.Fatalf("persisted relationship = %#v", stored)
	}

	revoked := make(chan revocationRequest, 1)
	remote := successfulFakeRemote(newBlockingSocket())
	remote.revoke = func(_ context.Context, input revocationRequest) error {
		revoked <- input
		return nil
	}
	second := newTestManager(t, home, remote)
	defer second.Close()
	select {
	case input := <-revoked:
		if input.DaemonID != stored.Relationship.DaemonID || input.Credential != stored.Credential.Secret {
			t.Fatalf("revocation = %+v", input)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("interrupted revocation was not resumed")
	}
	waitForHubState(t, second, StateNotConnected)
	if _, err := os.Stat(relationshipPath(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("local authority remains: %v", err)
	}
}

func TestManagerSanitizesSocketRevocation(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	socket := newBlockingSocket()
	remote := successfulFakeRemote(socket)
	manager := newTestManager(t, home, remote)
	defer manager.Close()
	if _, err := manager.Connect(context.Background(), "https://hub.byspace.test", strings.Repeat("t", 32)); err != nil {
		t.Fatal(err)
	}
	waitForHubState(t, manager, StateConnected)
	socket.read <- socketRead{err: websocket.CloseError{Code: 4403, Reason: "revoked"}}
	waitForHubState(t, manager, StateRevoked)
	data, err := os.ReadFile(relationshipPath(home))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{strings.Repeat("t", 32), testManagerSecret(), "22222222-2222-4222-8222-222222222222"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("revoked record contains %q: %s", secret, data)
		}
	}
}

func successfulFakeRemote(socket hubSocket) *fakeRemote {
	remote := &fakeRemote{}
	remote.enroll = func(_ context.Context, input enrollmentRequest) (enrollmentResult, error) {
		return enrollmentResult{DaemonID: input.DaemonID, Scopes: []string{executionScope}, WebSocketURL: "wss://hub.byspace.test/socket"}, nil
	}
	remote.dial = func(context.Context, socketRequest) (hubSocket, int, error) { return socket, 101, nil }
	return remote
}

func newTestManager(t *testing.T, home string, remote relationshipRemote) *Manager {
	t.Helper()
	uuids := []string{
		"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444",
	}
	manager, err := NewManager(context.Background(), Options{
		Home: home, Hostname: "test-host", ServerID: "srv_123456789012",
		DaemonPublicKey: func() (string, error) { return base64.StdEncoding.EncodeToString(make([]byte, 32)), nil },
		remote:          remote,
		now:             func() time.Time { return time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC) },
		newUUID: func() (string, error) {
			value := uuids[0]
			uuids = uuids[1:]
			return value, nil
		},
		newSecret:  func() (string, error) { return testManagerSecret(), nil },
		retryDelay: func(int) time.Duration { return time.Millisecond },
	})
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

func testManagerSecret() string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32))
}

func waitForHubState(t *testing.T, manager *Manager, state State) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if manager.Status().State == state {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("Hub state = %q, want %q", manager.Status().State, state)
}
