package hub

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type State string

const (
	StateNotConnected  State = "not_connected"
	StateConnecting    State = "connecting"
	StateConnected     State = "connected"
	StateReconnecting  State = "reconnecting"
	StateDisconnecting State = "disconnecting"
	StateRevoked       State = "revoked"
)

type Status struct {
	State       State    `json:"state"`
	DaemonID    *string  `json:"daemonId"`
	HubOrigin   *string  `json:"hubOrigin"`
	Scopes      []string `json:"scopes"`
	ConnectedAt *string  `json:"connectedAt"`
	LastError   *string  `json:"lastError"`
}

type DisconnectResult struct {
	Status  Status `json:"status"`
	Warning string `json:"warning,omitempty"`
}

type Options struct {
	Home            string
	Hostname        string
	ServerID        string
	DaemonPublicKey func() (string, error)

	remote     relationshipRemote
	now        func() time.Time
	newUUID    func() (string, error)
	newSecret  func() (string, error)
	retryDelay func(int) time.Duration
}

type Manager struct {
	store           *relationshipStore
	hostname        string
	serverID        string
	daemonPublicKey func() (string, error)
	remote          relationshipRemote
	now             func() time.Time
	newUUID         func() (string, error)
	newSecret       func() (string, error)
	retryDelay      func(int) time.Duration

	ctx    context.Context
	cancel context.CancelFunc
	opMu   sync.Mutex
	mu     sync.Mutex
	closed bool
	fatal  error
	record *record
	status Status

	lifecycleCancel context.CancelFunc
	lifecycleDone   chan struct{}
}

func NewManager(parent context.Context, options Options) (*Manager, error) {
	if parent == nil {
		parent = context.Background()
	}
	if options.Home == "" || options.Hostname == "" || options.DaemonPublicKey == nil || !serverIDPattern.MatchString(options.ServerID) {
		return nil, errors.New("Hub relationship manager options are incomplete or invalid")
	}
	if options.remote == nil {
		options.remote = newDirectRemote()
	}
	if options.now == nil {
		options.now = time.Now
	}
	if options.newUUID == nil {
		options.newUUID = randomUUID
	}
	if options.newSecret == nil {
		options.newSecret = randomSecret
	}
	if options.retryDelay == nil {
		options.retryDelay = boundedRetryDelay
	}
	ctx, cancel := context.WithCancel(parent)
	manager := &Manager{
		store: newRelationshipStore(relationshipPath(options.Home)), hostname: options.Hostname,
		serverID: options.ServerID, daemonPublicKey: options.DaemonPublicKey, remote: options.remote,
		now: options.now, newUUID: options.newUUID, newSecret: options.newSecret,
		retryDelay: options.retryDelay, ctx: ctx, cancel: cancel,
		status: Status{State: StateNotConnected, Scopes: []string{}},
	}
	stored, err := manager.store.Load()
	if err != nil {
		var quarantined *quarantinedAuthorityError
		if !errors.As(err, &quarantined) {
			cancel()
			return nil, err
		}
		message := "invalid Hub relationship authority was quarantined"
		manager.status.LastError = &message
		return manager, nil
	}
	if stored == nil {
		return manager, nil
	}
	manager.record = stored
	manager.status = statusForRecord(stored)
	if stored.State == "disconnecting" {
		manager.startRevocation(*stored)
	} else if stored.State == "pending" || stored.State == "active" {
		manager.startLifecycle(*stored)
	}
	return manager, nil
}

func (manager *Manager) Status() Status {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return cloneStatus(manager.status)
}

func (manager *Manager) Connect(ctx context.Context, origin, token string) (Status, error) {
	manager.opMu.Lock()
	defer manager.opMu.Unlock()
	if len(token) < 32 || len(token) > 16<<10 {
		return manager.Status(), errors.New("Hub enrollment token is invalid")
	}
	normalized, err := NormalizeOrigin(origin)
	if err != nil {
		return manager.Status(), err
	}
	if err := manager.ensureOpen(); err != nil {
		return manager.Status(), err
	}
	manager.stopLifecycle()

	manager.mu.Lock()
	stored := manager.record
	manager.mu.Unlock()
	var pending record
	if stored != nil && stored.State == "pending" {
		if stored.Relationship.HubOrigin != normalized {
			manager.startLifecycle(*stored)
			return manager.Status(), errors.New("a pending Hub enrollment already exists for a different Hub")
		}
		pending = *stored
		pending.Enrollment = &enrollment{Token: token}
	} else {
		if stored != nil && stored.State != "revoked" {
			manager.startLifecycle(*stored)
			return manager.Status(), errors.New("this daemon already has a Hub relationship")
		}
		daemonID, err := manager.newUUID()
		if err != nil {
			return manager.Status(), fmt.Errorf("generate Hub daemon ID: %w", err)
		}
		idempotencyKey, err := manager.newUUID()
		if err != nil {
			return manager.Status(), fmt.Errorf("generate Hub enrollment idempotency key: %w", err)
		}
		secret, err := manager.newSecret()
		if err != nil {
			return manager.Status(), fmt.Errorf("generate Hub relationship credential: %w", err)
		}
		publicKey, err := manager.daemonPublicKey()
		if err != nil {
			return manager.Status(), fmt.Errorf("load daemon public identity: %w", err)
		}
		pending = record{
			Version: relationshipVersion,
			State:   "pending",
			Relationship: relationship{
				DaemonID: daemonID, IdempotencyKey: idempotencyKey,
				HubOrigin: normalized, CreatedAt: manager.now().UTC().Format(time.RFC3339Nano),
				Scopes: []string{executionScope},
			},
			Credential: &credential{Secret: secret},
			Enrollment: &enrollment{Token: token},
			Identity:   &identity{ServerID: manager.serverID, DaemonPublicKey: publicKey},
		}
	}
	if err := manager.store.Save(pending); err != nil {
		if relationshipWasReplaced(err) {
			manager.setRecord(pending, StateReconnecting, "Hub relationship persistence is uncertain; restart the daemon")
			manager.setFatal(err)
		} else if stored != nil && stored.State == "pending" {
			manager.startLifecycle(*stored)
		}
		return manager.Status(), err
	}
	manager.setRecord(pending, StateConnecting, "")

	active, err := manager.enroll(ctx, pending)
	if err != nil {
		var rejected *enrollmentRejectedError
		if errors.As(err, &rejected) {
			if discardErr := manager.discardRejectedAuthority(pending, err.Error()); discardErr != nil {
				return manager.Status(), fmt.Errorf("%w; discard rejected Hub relationship: %v", err, discardErr)
			}
			return manager.Status(), err
		}
		manager.setRecord(pending, StateReconnecting, err.Error())
		manager.startLifecycleAfter(pending, retryDelayFor(err, manager.retryDelay(0)))
		return manager.Status(), nil
	}
	if err := manager.store.Save(active); err != nil {
		if relationshipWasReplaced(err) {
			manager.setRecord(active, StateReconnecting, "Hub relationship persistence is uncertain; restart the daemon")
			manager.setFatal(err)
		} else {
			manager.setRecord(pending, StateReconnecting, "Hub relationship persistence failed")
			manager.startLifecycle(pending)
		}
		return manager.Status(), err
	}
	manager.setRecord(active, StateConnecting, "")
	manager.startLifecycle(active)
	return manager.Status(), nil
}

func (manager *Manager) Disconnect(ctx context.Context, force bool) (DisconnectResult, error) {
	manager.opMu.Lock()
	defer manager.opMu.Unlock()
	if err := manager.ensureOpen(); err != nil {
		return DisconnectResult{Status: manager.Status()}, err
	}
	manager.stopLifecycle()
	manager.mu.Lock()
	stored := manager.record
	manager.mu.Unlock()
	if stored == nil || stored.State == "revoked" {
		if err := manager.store.Remove(); err != nil {
			return DisconnectResult{Status: manager.Status()}, err
		}
		manager.clearRecord()
		return DisconnectResult{Status: manager.Status()}, nil
	}
	warning := ""
	if force {
		warning = "Hub relationship removed locally without confirmed server-side revocation."
		manager.setRecord(*stored, StateDisconnecting, "")
		if err := manager.store.Discard(); err != nil {
			manager.setRecord(*stored, StateDisconnecting, "Durable local Hub authority cleanup failed")
			manager.setFatal(err)
			return DisconnectResult{Status: manager.Status(), Warning: warning}, err
		}
		manager.clearRecord()
		return DisconnectResult{Status: manager.Status(), Warning: warning}, nil
	}

	disconnecting := *stored
	disconnecting.State = "disconnecting"
	disconnecting.Enrollment = nil
	disconnecting.Identity = nil
	if err := manager.store.Save(disconnecting); err != nil {
		if relationshipWasReplaced(err) {
			manager.setRecord(disconnecting, StateDisconnecting, "Hub revocation intent persistence is uncertain; restart the daemon")
			manager.setFatal(err)
		} else {
			manager.setRecord(*stored, StateReconnecting, "Hub revocation intent could not be persisted")
			manager.startLifecycle(*stored)
		}
		return DisconnectResult{Status: manager.Status()}, err
	}
	manager.setRecord(disconnecting, StateDisconnecting, "")
	err := manager.remote.Revoke(ctx, revocationRequest{
		DaemonID: disconnecting.Relationship.DaemonID, HubOrigin: disconnecting.Relationship.HubOrigin,
		Credential: disconnecting.Credential.Secret,
	})
	if err != nil {
		manager.setRecord(disconnecting, StateDisconnecting, "Hub revocation failed; durable retry remains pending")
		manager.startRevocationAfter(disconnecting, retryDelayFor(err, manager.retryDelay(0)))
		return DisconnectResult{Status: manager.Status()}, fmt.Errorf("Hub revocation failed; durable retry remains pending: %w", err)
	}
	if err := manager.store.Discard(); err != nil {
		manager.setRecord(disconnecting, StateDisconnecting, "Hub relationship was revoked but durable local cleanup failed")
		manager.setFatal(err)
		return DisconnectResult{Status: manager.Status()}, err
	}
	manager.clearRecord()
	return DisconnectResult{Status: manager.Status()}, nil
}

func (manager *Manager) Close() {
	manager.opMu.Lock()
	defer manager.opMu.Unlock()
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return
	}
	manager.closed = true
	manager.mu.Unlock()
	manager.cancel()
	manager.stopLifecycle()
}

func (manager *Manager) enroll(ctx context.Context, pending record) (record, error) {
	sum := sha256.Sum256([]byte(pending.Credential.Secret))
	result, err := manager.remote.Enroll(ctx, enrollmentRequest{
		DaemonID: pending.Relationship.DaemonID, IdempotencyKey: pending.Relationship.IdempotencyKey,
		HubOrigin: pending.Relationship.HubOrigin, Token: pending.Enrollment.Token,
		Hostname: manager.hostname, ServerID: pending.Identity.ServerID,
		DaemonPublicKey:    pending.Identity.DaemonPublicKey,
		CredentialVerifier: base64.RawURLEncoding.EncodeToString(sum[:]),
		Scopes:             []string{executionScope},
	})
	if err != nil {
		return record{}, err
	}
	if result.DaemonID != pending.Relationship.DaemonID || len(result.Scopes) != 1 || result.Scopes[0] != executionScope {
		return record{}, &enrollmentRejectedError{reason: "Hub enrollment response did not match the pending relationship"}
	}
	if err := ValidateWebSocketURL(pending.Relationship.HubOrigin, result.WebSocketURL); err != nil {
		return record{}, &enrollmentRejectedError{reason: err.Error()}
	}
	return record{
		Version: relationshipVersion, State: "active", Relationship: pending.Relationship,
		Credential: pending.Credential,
		Transport:  &transport{Kind: "direct_websocket", WebSocketURL: result.WebSocketURL},
	}, nil
}

func (manager *Manager) startLifecycle(stored record) {
	manager.startLifecycleAfter(stored, 0)
}

func (manager *Manager) startLifecycleAfter(stored record, initialDelay time.Duration) {
	ctx, cancel := context.WithCancel(manager.ctx)
	done := make(chan struct{})
	manager.lifecycleCancel = cancel
	manager.lifecycleDone = done
	go func() {
		defer close(done)
		manager.runLifecycle(ctx, stored, initialDelay)
	}()
}

func (manager *Manager) startRevocation(stored record) {
	manager.startRevocationAfter(stored, 0)
}

func (manager *Manager) startRevocationAfter(stored record, initialDelay time.Duration) {
	ctx, cancel := context.WithCancel(manager.ctx)
	done := make(chan struct{})
	manager.lifecycleCancel = cancel
	manager.lifecycleDone = done
	go func() {
		defer close(done)
		if initialDelay > 0 && !sleepContext(ctx, initialDelay) {
			return
		}
		manager.runRevocation(ctx, stored)
	}()
}

func (manager *Manager) stopLifecycle() {
	cancel := manager.lifecycleCancel
	done := manager.lifecycleDone
	manager.lifecycleCancel = nil
	manager.lifecycleDone = nil
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (manager *Manager) runRevocation(ctx context.Context, stored record) {
	manager.setRecord(stored, StateDisconnecting, "")
	for attempt := 0; ; attempt++ {
		revokeCtx, cancel := context.WithTimeout(ctx, hubRequestTimeout)
		err := manager.remote.Revoke(revokeCtx, revocationRequest{
			DaemonID: stored.Relationship.DaemonID, HubOrigin: stored.Relationship.HubOrigin,
			Credential: stored.Credential.Secret,
		})
		cancel()
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			if discardErr := manager.store.Discard(); discardErr != nil {
				manager.setRecord(stored, StateDisconnecting, "Hub relationship was revoked but durable local cleanup failed")
				manager.setFatal(discardErr)
				return
			}
			manager.clearRecord()
			return
		}
		manager.setRecord(stored, StateDisconnecting, "Hub revocation retry failed; local authority is retained")
		if !sleepContext(ctx, manager.retryDelay(attempt)) {
			return
		}
	}
}

func (manager *Manager) runLifecycle(ctx context.Context, stored record, initialDelay time.Duration) {
	if initialDelay > 0 && !sleepContext(ctx, initialDelay) {
		return
	}
	attempt := 0
	for {
		if ctx.Err() != nil {
			return
		}
		if stored.State == "pending" {
			active, err := manager.enroll(ctx, stored)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				var rejected *enrollmentRejectedError
				if errors.As(err, &rejected) {
					_ = manager.discardRejectedAuthority(stored, err.Error())
					return
				}
				manager.setRecord(stored, StateReconnecting, err.Error())
				if !sleepContext(ctx, retryDelayFor(err, manager.retryDelay(attempt))) {
					return
				}
				attempt++
				continue
			}
			if err := manager.store.Save(active); err != nil {
				if relationshipWasReplaced(err) {
					manager.setRecord(active, StateReconnecting, "Hub relationship persistence is uncertain; restart the daemon")
					manager.setFatal(err)
					return
				}
				manager.setRecord(stored, StateReconnecting, "Hub relationship persistence failed")
				if !sleepContext(ctx, manager.retryDelay(attempt)) {
					return
				}
				attempt++
				continue
			}
			stored = active
			attempt = 0
			manager.setRecord(stored, StateConnecting, "")
		}

		manager.setRecord(stored, chooseSocketState(attempt), "")
		dialCtx, cancel := context.WithTimeout(ctx, hubRequestTimeout)
		socket, statusCode, err := manager.remote.Dial(dialCtx, socketRequest{
			DaemonID: stored.Relationship.DaemonID, WebSocketURL: stored.Transport.WebSocketURL,
			Credential: stored.Credential.Secret,
		})
		cancel()
		if ctx.Err() != nil {
			if socket != nil {
				_ = socket.CloseNow()
			}
			return
		}
		if err != nil {
			if statusCode == 401 || statusCode == 403 {
				manager.revoke(stored, fmt.Sprintf("Hub rejected socket authentication (%d)", statusCode))
				return
			}
			manager.setRecord(stored, StateReconnecting, "Hub WebSocket connection failed")
			if !sleepContext(ctx, manager.retryDelay(attempt)) {
				return
			}
			attempt++
			continue
		}
		attempt = 0
		manager.setConnected(stored)
		_, _, readErr := socket.Read(ctx)
		if ctx.Err() != nil {
			_ = socket.CloseNow()
			return
		}
		status := websocket.CloseStatus(readErr)
		if readErr == nil {
			_ = socket.Close(websocket.StatusPolicyViolation, "Hub execution protocol is not enabled")
			manager.setRecord(stored, StateReconnecting, "Hub execution protocol is not enabled")
		} else {
			_ = socket.CloseNow()
			if status == 4403 {
				manager.revoke(stored, "Hub revoked this relationship")
				return
			}
			manager.setRecord(stored, StateReconnecting, "Hub WebSocket connection closed")
		}
		if !sleepContext(ctx, manager.retryDelay(attempt)) {
			return
		}
		attempt++
	}
}

func (manager *Manager) revoke(stored record, reason string) {
	revoked := sanitizedRevokedRecord(stored, reason)
	if err := manager.store.Save(revoked); err != nil {
		if relationshipWasReplaced(err) {
			manager.setRecord(revoked, StateRevoked, reason)
			manager.setFatal(err)
			return
		}
		if discardErr := manager.store.Discard(); discardErr != nil {
			manager.setRecord(revoked, StateRevoked, "Hub relationship was revoked but durable authority cleanup failed")
			manager.setFatal(errors.Join(err, discardErr))
			return
		}
	}
	manager.setRecord(revoked, StateRevoked, reason)
}

func (manager *Manager) discardRejectedAuthority(stored record, reason string) error {
	if err := manager.store.Discard(); err != nil {
		revoked := sanitizedRevokedRecord(stored, reason)
		manager.setRecord(revoked, StateRevoked, "Hub rejected enrollment but durable authority cleanup failed")
		manager.setFatal(err)
		return err
	}
	manager.clearRecord()
	return nil
}

func sanitizedRevokedRecord(stored record, reason string) record {
	return record{
		Version: relationshipVersion, State: "revoked",
		Relationship: relationship{
			DaemonID: stored.Relationship.DaemonID, HubOrigin: stored.Relationship.HubOrigin,
			CreatedAt: stored.Relationship.CreatedAt, Scopes: []string{executionScope},
		},
		Transport: stored.Transport, Reason: reason,
	}
}

func (manager *Manager) setRecord(stored record, state State, lastError string) {
	manager.mu.Lock()
	copy := stored
	manager.record = &copy
	manager.status = statusForRecord(&copy)
	manager.status.State = state
	manager.status.ConnectedAt = nil
	if lastError != "" {
		manager.status.LastError = stringPointer(lastError)
	} else {
		manager.status.LastError = nil
	}
	manager.mu.Unlock()
}

func (manager *Manager) setConnected(stored record) {
	manager.setRecord(stored, StateConnected, "")
	connectedAt := manager.now().UTC().Format(time.RFC3339Nano)
	manager.mu.Lock()
	manager.status.ConnectedAt = &connectedAt
	manager.mu.Unlock()
}

func (manager *Manager) clearRecord() {
	manager.mu.Lock()
	manager.record = nil
	manager.status = Status{State: StateNotConnected, Scopes: []string{}}
	manager.mu.Unlock()
}

func (manager *Manager) ensureOpen() error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.closed {
		return errors.New("Hub relationship manager is closed")
	}
	if manager.fatal != nil {
		return errors.New("Hub relationship manager requires a daemon restart")
	}
	return nil
}

func (manager *Manager) setFatal(err error) {
	manager.mu.Lock()
	manager.fatal = err
	manager.mu.Unlock()
}

func statusForRecord(stored *record) Status {
	if stored == nil {
		return Status{State: StateNotConnected, Scopes: []string{}}
	}
	state := StateConnecting
	switch stored.State {
	case "revoked":
		state = StateRevoked
	case "disconnecting":
		state = StateDisconnecting
	}
	status := Status{
		State: state, DaemonID: stringPointer(stored.Relationship.DaemonID),
		HubOrigin: stringPointer(stored.Relationship.HubOrigin),
		Scopes:    append([]string(nil), stored.Relationship.Scopes...),
	}
	if stored.Reason != "" {
		status.LastError = stringPointer(stored.Reason)
	}
	return status
}

func cloneStatus(status Status) Status {
	status.Scopes = append([]string{}, status.Scopes...)
	if status.DaemonID != nil {
		status.DaemonID = stringPointer(*status.DaemonID)
	}
	if status.HubOrigin != nil {
		status.HubOrigin = stringPointer(*status.HubOrigin)
	}
	if status.ConnectedAt != nil {
		status.ConnectedAt = stringPointer(*status.ConnectedAt)
	}
	if status.LastError != nil {
		status.LastError = stringPointer(*status.LastError)
	}
	return status
}

func chooseSocketState(attempt int) State {
	if attempt == 0 {
		return StateConnecting
	}
	return StateReconnecting
}

func stringPointer(value string) *string { return &value }

func sleepContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func retryDelayFor(err error, fallback time.Duration) time.Duration {
	var retry *retryAfterError
	if errors.As(err, &retry) && retry.delay > fallback {
		return retry.delay
	}
	return fallback
}

func boundedRetryDelay(attempt int) time.Duration {
	base := 500 * time.Millisecond
	for index := 0; index < attempt && base < 30*time.Second; index++ {
		base *= 2
	}
	if base > 30*time.Second {
		base = 30 * time.Second
	}
	value, err := rand.Int(rand.Reader, big.NewInt(501))
	if err != nil {
		return base
	}
	factor := int64(750) + value.Int64()
	return time.Duration(int64(base) * factor / 1000)
}

func randomSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	), nil
}
