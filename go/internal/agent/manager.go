package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	mu             sync.RWMutex
	stateMu        sync.RWMutex
	ctx            context.Context
	cancel         context.CancelFunc
	providers      map[string]Provider
	agents         map[string]*managedAgent
	listeners      map[uint64]*subscriber
	nextListener   uint64
	closed         bool
	closeDone      chan struct{}
	closeErr       error
	persistenceErr error
	starts         sync.WaitGroup
	mutations      sync.WaitGroup
	watchers       sync.WaitGroup
	store          stateStore
	persistMu      sync.Mutex
}

type subscriber struct {
	queue  chan Event
	stop   chan struct{}
	once   sync.Once
	listen func(Event)
}

type managedAgent struct {
	operation         chan struct{}
	mu                sync.Mutex
	snapshot          Snapshot
	session           Session
	timeline          timeline
	deliveries        map[string]*delivery
	aborting          bool
	abort             *abortCall
	abortTerminal     *ProviderEvent
	closing           bool
	domainClosing     bool
	providerEnded     bool
	sessionClosed     bool
	persistenceFailed bool
	closeDone         chan struct{}
	closeErr          error
}

type delivery struct {
	result SendResult
	err    error
	done   chan struct{}
}

type abortCall struct {
	err  error
	done chan struct{}
}

func NewManager(providers map[string]Provider) *Manager {
	return newManager(providers, nil)
}

func newManager(providers map[string]Provider, store stateStore) *Manager {
	copied := make(map[string]Provider, len(providers))
	for name, provider := range providers {
		copied[name] = provider
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{
		ctx:       ctx,
		cancel:    cancel,
		providers: copied,
		agents:    make(map[string]*managedAgent),
		listeners: make(map[uint64]*subscriber),
		closeDone: make(chan struct{}),
		store:     store,
	}
}

func (manager *Manager) Create(ctx context.Context, config Config) (Snapshot, error) {
	if err := validateConfig(config); err != nil {
		return Snapshot{}, err
	}

	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return Snapshot{}, ErrManagerClosed
	}
	if manager.persistenceErr != nil {
		err := manager.persistenceErr
		manager.mu.Unlock()
		return Snapshot{}, err
	}
	provider, ok := manager.providers[config.Provider]
	if !ok {
		manager.mu.Unlock()
		return Snapshot{}, fmt.Errorf("%w: %s", ErrProviderNotFound, config.Provider)
	}
	manager.starts.Add(1)
	manager.mu.Unlock()
	defer manager.starts.Done()

	startCtx, cancelStart := context.WithCancel(ctx)
	stopManagerCancel := context.AfterFunc(manager.ctx, cancelStart)
	defer func() {
		stopManagerCancel()
		cancelStart()
	}()

	agentID, err := randomID("agt_", 12)
	if err != nil {
		return Snapshot{}, err
	}
	epoch, err := randomID("tl_", 12)
	if err != nil {
		return Snapshot{}, err
	}
	session, err := provider.Start(startCtx, config)
	if err != nil {
		return Snapshot{}, fmt.Errorf("start %s provider: %w", config.Provider, err)
	}

	registered := false
	defer func() {
		if !registered {
			closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = session.Close(closeCtx)
		}
	}()

	runtimeInfo := session.RuntimeInfo()
	if runtimeInfo.Provider == "" {
		runtimeInfo.Provider = config.Provider
	}
	if runtimeInfo.Provider != config.Provider {
		return Snapshot{}, fmt.Errorf("provider returned runtime for %q, want %q", runtimeInfo.Provider, config.Provider)
	}
	now := time.Now().UTC()
	entry := &managedAgent{
		operation:  make(chan struct{}, 1),
		session:    session,
		timeline:   newTimeline(epoch),
		deliveries: make(map[string]*delivery),
		snapshot: Snapshot{
			ID:            agentID,
			Provider:      config.Provider,
			CWD:           config.CWD,
			WorkspaceID:   config.WorkspaceID,
			Title:         config.Title,
			Labels:        cloneLabels(config.Labels),
			Lifecycle:     LifecycleIdle,
			CreatedAt:     now,
			UpdatedAt:     now,
			RuntimeInfo:   runtimeInfo,
			Capabilities:  session.Capabilities(),
			TimelineEpoch: epoch,
		},
	}
	entry.operation <- struct{}{}
	if runtimeInfo.SessionID != "" {
		entry.snapshot.Persistence = &PersistenceHandle{
			Provider:     config.Provider,
			SessionID:    runtimeInfo.SessionID,
			NativeHandle: runtimeInfo.NativeHandle,
		}
	}

	manager.stateMu.Lock()
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		manager.stateMu.Unlock()
		return Snapshot{}, ErrManagerClosed
	}
	if manager.persistenceErr != nil {
		err := manager.persistenceErr
		manager.mu.Unlock()
		manager.stateMu.Unlock()
		return Snapshot{}, err
	}
	manager.agents[agentID] = entry
	manager.mu.Unlock()
	if err := manager.persist(); err != nil {
		if stateWasReplaced(err) {
			manager.failPersistentManager(err)
			registered = true
		} else {
			manager.mu.Lock()
			if manager.agents[agentID] == entry {
				delete(manager.agents, agentID)
			}
			manager.mu.Unlock()
		}
		manager.stateMu.Unlock()
		return Snapshot{}, err
	}
	manager.stateMu.Unlock()
	manager.watchers.Add(1)
	registered = true

	// Publish the immutable initial snapshot before the watcher can mutate it.
	snapshot := cloneSnapshot(entry.snapshot)
	manager.dispatch(stateEvent(snapshot))
	go manager.watchProvider(agentID, entry)
	return snapshot, nil
}

func (manager *Manager) List() []Snapshot {
	manager.stateMu.RLock()
	defer manager.stateMu.RUnlock()
	manager.mu.RLock()
	entries := make([]*managedAgent, 0, len(manager.agents))
	for _, entry := range manager.agents {
		entries = append(entries, entry)
	}
	manager.mu.RUnlock()

	result := make([]Snapshot, 0, len(entries))
	for _, entry := range entries {
		entry.mu.Lock()
		result = append(result, cloneSnapshot(entry.snapshot))
		entry.mu.Unlock()
	}
	sort.Slice(result, func(left, right int) bool { return result[left].ID < result[right].ID })
	return result
}

func (manager *Manager) Get(agentID string) (Snapshot, error) {
	manager.stateMu.RLock()
	defer manager.stateMu.RUnlock()
	entry, err := manager.get(agentID)
	if err != nil {
		return Snapshot{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return cloneSnapshot(entry.snapshot), nil
}

func (manager *Manager) Timeline(agentID string) (TimelineSnapshot, error) {
	manager.stateMu.RLock()
	defer manager.stateMu.RUnlock()
	entry, err := manager.get(agentID)
	if err != nil {
		return TimelineSnapshot{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return entry.timeline.snapshot(), nil
}

func (manager *Manager) Send(ctx context.Context, agentID, clientMessageID, prompt string) (SendResult, error) {
	return manager.send(ctx, agentID, clientMessageID, prompt, false)
}

// SendInterrupt preserves delivery idempotency while implementing the legacy
// client behavior of canceling a different active turn before sending.
func (manager *Manager) SendInterrupt(ctx context.Context, agentID, clientMessageID, prompt string) (SendResult, error) {
	return manager.send(ctx, agentID, clientMessageID, prompt, true)
}

func (manager *Manager) send(ctx context.Context, agentID, clientMessageID, prompt string, interrupt bool) (SendResult, error) {
	if strings.TrimSpace(clientMessageID) == "" {
		return SendResult{}, errors.New("client message ID must not be empty")
	}
	entry, mutationDone, err := manager.beginMutation(agentID)
	if err != nil {
		return SendResult{}, err
	}
	defer mutationDone()

	select {
	case <-ctx.Done():
		return SendResult{}, ctx.Err()
	case <-entry.operation:
	}
	defer func() { entry.operation <- struct{}{} }()

	if interrupt {
		if result, resultErr, duplicate := awaitDelivery(ctx, entry, clientMessageID); duplicate {
			return result, resultErr
		}
		entry.mu.Lock()
		hasActiveTurn := entry.snapshot.ActiveTurnID != ""
		entry.mu.Unlock()
		if hasActiveTurn {
			if err := manager.Abort(ctx, agentID); err != nil && !errors.Is(err, ErrAgentNotRunning) {
				return SendResult{}, err
			}
		}
	}
	return manager.sendEntry(ctx, agentID, entry, clientMessageID, prompt)
}

func (manager *Manager) sendEntry(ctx context.Context, agentID string, entry *managedAgent, clientMessageID, prompt string) (SendResult, error) {
	if result, resultErr, duplicate := awaitDelivery(ctx, entry, clientMessageID); duplicate {
		return result, resultErr
	}
	manager.stateMu.Lock()
	entry.mu.Lock()
	if entry.snapshot.Lifecycle == LifecycleClosed || entry.closing {
		entry.mu.Unlock()
		manager.stateMu.Unlock()
		return SendResult{}, ErrAgentClosed
	}
	if entry.providerEnded {
		entry.mu.Unlock()
		manager.stateMu.Unlock()
		return SendResult{}, ErrProviderExited
	}
	if entry.snapshot.ActiveTurnID != "" {
		entry.mu.Unlock()
		manager.stateMu.Unlock()
		return SendResult{}, ErrAgentBusy
	}
	turnID, err := randomID("turn_", 12)
	if err != nil {
		entry.mu.Unlock()
		manager.stateMu.Unlock()
		return SendResult{}, err
	}
	now := time.Now().UTC()
	previousLifecycle := entry.snapshot.Lifecycle
	previousActiveTurnID := entry.snapshot.ActiveTurnID
	previousLastError := entry.snapshot.LastError
	previousUpdatedAt := entry.snapshot.UpdatedAt
	previousLastUserMessageAt := entry.snapshot.LastUserMessageAt
	previousTimelineHeadSeq := entry.snapshot.TimelineHeadSeq
	delivery := &delivery{
		result: SendResult{TurnID: turnID},
		done:   make(chan struct{}),
	}
	entry.deliveries[clientMessageID] = delivery
	entry.snapshot.Lifecycle = LifecycleRunning
	entry.snapshot.ActiveTurnID = turnID
	entry.snapshot.LastError = ""
	entry.snapshot.UpdatedAt = now
	entry.snapshot.LastUserMessageAt = now
	row := entry.timeline.append(now, turnID, TimelineItem{
		Type:            TimelineUserMessage,
		Text:            prompt,
		ClientMessageID: clientMessageID,
	})
	entry.snapshot.TimelineHeadSeq = row.Seq
	snapshot := cloneSnapshot(entry.snapshot)
	epoch := entry.timeline.epoch
	entry.mu.Unlock()

	if err := manager.persist(); err != nil {
		if stateWasReplaced(err) {
			manager.failPersistentManager(err)
			entry.mu.Lock()
			delivery.err = err
			close(delivery.done)
			entry.mu.Unlock()
		} else {
			entry.mu.Lock()
			delete(entry.deliveries, clientMessageID)
			entry.timeline.removeLast(row.Seq)
			entry.snapshot.Lifecycle = previousLifecycle
			entry.snapshot.ActiveTurnID = previousActiveTurnID
			entry.snapshot.LastError = previousLastError
			entry.snapshot.UpdatedAt = previousUpdatedAt
			entry.snapshot.LastUserMessageAt = previousLastUserMessageAt
			entry.snapshot.TimelineHeadSeq = previousTimelineHeadSeq
			entry.mu.Unlock()
		}
		manager.stateMu.Unlock()
		return SendResult{}, err
	}
	manager.stateMu.Unlock()

	manager.dispatch(stateEvent(snapshot))
	manager.dispatch(streamEvent(agentID, ProviderEvent{
		Type:   ProviderEventTimeline,
		TurnID: turnID,
		Item:   row.Item,
	}, &row, epoch))

	promptErr := entry.session.Prompt(ctx, turnID, prompt)
	manager.stateMu.Lock()
	entry.mu.Lock()
	previousDeliveryResult := delivery.result
	previousDeliveryErr := delivery.err
	previousProviderEnded := entry.providerEnded
	if promptErr == nil {
		delivery.result.Accepted = true
	} else {
		delivery.err = fmt.Errorf("send prompt: %w", promptErr)
		if errors.Is(promptErr, ErrSessionUnusable) {
			entry.providerEnded = true
		}
	}
	entry.mu.Unlock()
	persistErr := manager.persistOrPoison(entry, func() {
		delivery.result = previousDeliveryResult
		delivery.err = previousDeliveryErr
		entry.providerEnded = previousProviderEnded
	})
	entry.mu.Lock()
	if persistErr != nil {
		delivery.err = errors.Join(delivery.err, persistErr)
	}
	result, resultErr := delivery.result, delivery.err
	close(delivery.done)
	entry.mu.Unlock()
	manager.stateMu.Unlock()
	if promptErr != nil && persistErr == nil {
		manager.failTurn(agentID, entry, turnID, promptErr.Error())
	}
	return result, resultErr
}

func awaitDelivery(ctx context.Context, entry *managedAgent, clientMessageID string) (SendResult, error, bool) {
	entry.mu.Lock()
	previous, ok := entry.deliveries[clientMessageID]
	if !ok {
		entry.mu.Unlock()
		return SendResult{}, nil, false
	}
	done := previous.done
	entry.mu.Unlock()
	select {
	case <-ctx.Done():
		return SendResult{}, ctx.Err(), true
	case <-done:
	}
	entry.mu.Lock()
	result, resultErr := previous.result, previous.err
	entry.mu.Unlock()
	result.Duplicate = true
	return result, resultErr, true
}

func (manager *Manager) Abort(ctx context.Context, agentID string) error {
	entry, mutationDone, err := manager.beginMutation(agentID)
	if err != nil {
		return err
	}
	defer mutationDone()

	entry.mu.Lock()
	if entry.snapshot.Lifecycle == LifecycleClosed || entry.closing {
		entry.mu.Unlock()
		return ErrAgentClosed
	}
	if current := entry.abort; current != nil {
		entry.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-current.done:
			return current.err
		}
	}
	if entry.providerEnded {
		entry.mu.Unlock()
		return ErrProviderExited
	}
	turnID := entry.snapshot.ActiveTurnID
	if turnID == "" {
		entry.mu.Unlock()
		return ErrAgentNotRunning
	}
	entry.aborting = true
	current := &abortCall{done: make(chan struct{})}
	entry.abort = current
	entry.abortTerminal = nil
	entry.mu.Unlock()

	abortErr := entry.session.Abort(ctx)
	if abortErr != nil {
		resultErr := fmt.Errorf("abort agent turn: %w", abortErr)
		entry.mu.Lock()
		pending := entry.abortTerminal
		entry.abortTerminal = nil
		entry.aborting = false
		current.err = resultErr
		if errors.Is(abortErr, ErrSessionUnusable) {
			entry.providerEnded = true
		}
		entry.mu.Unlock()
		if pending != nil {
			manager.handleProviderEvent(agentID, entry, *pending)
		}
		entry.mu.Lock()
		close(current.done)
		entry.abort = nil
		entry.mu.Unlock()
		return resultErr
	}

	manager.stateMu.Lock()
	entry.mu.Lock()
	entry.abortTerminal = nil
	entry.aborting = false
	if entry.snapshot.ActiveTurnID != turnID {
		current.err = nil
		close(current.done)
		entry.abort = nil
		entry.mu.Unlock()
		manager.stateMu.Unlock()
		return nil
	}
	previousSnapshot := cloneSnapshot(entry.snapshot)
	entry.snapshot.ActiveTurnID = ""
	entry.snapshot.Lifecycle = LifecycleIdle
	entry.snapshot.UpdatedAt = time.Now().UTC()
	snapshot := cloneSnapshot(entry.snapshot)
	entry.mu.Unlock()

	persistErr := manager.persistOrPoison(entry, func() {
		entry.snapshot = previousSnapshot
	})
	manager.stateMu.Unlock()
	entry.mu.Lock()
	current.err = persistErr
	close(current.done)
	entry.abort = nil
	entry.mu.Unlock()
	if persistErr != nil {
		return persistErr
	}
	manager.dispatch(streamEvent(agentID, ProviderEvent{
		Type:   ProviderEventTurnCanceled,
		TurnID: turnID,
		Error:  "aborted",
	}, nil, ""))
	manager.dispatch(stateEvent(snapshot))
	return nil
}

func (manager *Manager) CloseAgent(ctx context.Context, agentID string) error {
	entry, mutationDone, err := manager.beginMutation(agentID)
	if err != nil {
		return err
	}
	defer mutationDone()
	entry.mu.Lock()
	entry.domainClosing = true
	entry.mu.Unlock()
	return manager.closeEntry(ctx, entry)
}

func (manager *Manager) Close(ctx context.Context) error {
	manager.mu.Lock()
	if manager.closed {
		done := manager.closeDone
		manager.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-done:
			manager.mu.RLock()
			err := manager.closeErr
			manager.mu.RUnlock()
			return err
		}
	}
	manager.closed = true
	manager.cancel()
	manager.mu.Unlock()

	var firstErr error
	if err := waitGroup(ctx, &manager.starts); err != nil {
		firstErr = err
	}

	manager.mu.RLock()
	entries := make([]*managedAgent, 0, len(manager.agents))
	for _, entry := range manager.agents {
		entries = append(entries, entry)
	}
	manager.mu.RUnlock()
	for _, entry := range entries {
		var err error
		if manager.store == nil {
			err = manager.closeEntry(ctx, entry)
		} else {
			err = manager.shutdownEntry(ctx, entry)
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if err := waitGroup(ctx, &manager.mutations); err != nil {
		if firstErr != nil {
			firstErr = errors.Join(firstErr, err)
		} else {
			firstErr = err
		}
	}
	if err := waitGroup(ctx, &manager.watchers); err != nil {
		if firstErr != nil {
			firstErr = errors.Join(firstErr, err)
		} else {
			firstErr = err
		}
	}
	if err := manager.persist(); err != nil {
		firstErr = errors.Join(firstErr, err)
	}

	manager.mu.Lock()
	listeners := make([]*subscriber, 0, len(manager.listeners))
	for id, listener := range manager.listeners {
		listeners = append(listeners, listener)
		delete(manager.listeners, id)
	}
	manager.closeErr = firstErr
	close(manager.closeDone)
	manager.mu.Unlock()
	for _, listener := range listeners {
		listener.stopNow()
	}
	return firstErr
}

func (manager *Manager) Subscribe(listener func(Event)) func() {
	if listener == nil {
		return func() {}
	}
	subscription := newSubscriber(listener)
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		subscription.stopNow()
		return func() {}
	}
	manager.nextListener++
	id := manager.nextListener
	manager.listeners[id] = subscription
	manager.mu.Unlock()
	return func() {
		manager.mu.Lock()
		delete(manager.listeners, id)
		manager.mu.Unlock()
		subscription.stopNow()
	}
}

func (manager *Manager) shutdownEntry(ctx context.Context, entry *managedAgent) error {
	entry.mu.Lock()
	if entry.domainClosing {
		entry.mu.Unlock()
		return manager.closeEntry(ctx, entry)
	}
	if entry.snapshot.Lifecycle == LifecycleClosed || entry.session == nil {
		entry.mu.Unlock()
		return nil
	}
	if entry.closing {
		done := entry.closeDone
		entry.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-done:
			entry.mu.Lock()
			err := entry.closeErr
			entry.mu.Unlock()
			return err
		}
	}
	entry.closing = true
	entry.closeDone = make(chan struct{})
	done := entry.closeDone
	session := entry.session
	activeTurnID := entry.snapshot.ActiveTurnID
	entry.mu.Unlock()

	closeErr := session.Close(ctx)
	manager.stateMu.Lock()
	entry.mu.Lock()
	entry.providerEnded = true
	entry.sessionClosed = closeErr == nil
	entry.snapshot.ActiveTurnID = ""
	if closeErr != nil {
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.LastError = closeErr.Error()
		entry.snapshot.UpdatedAt = time.Now().UTC()
	} else if activeTurnID != "" {
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.LastError = restartInterruptedMessage
		entry.snapshot.UpdatedAt = time.Now().UTC()
	}
	entry.mu.Unlock()
	persistErr := manager.persist()
	if stateWasReplaced(persistErr) {
		manager.failPersistentManager(persistErr)
	}
	resultErr := persistErr
	if closeErr != nil {
		resultErr = errors.Join(fmt.Errorf("stop Agent provider: %w", closeErr), persistErr)
	}
	entry.mu.Lock()
	entry.closing = false
	entry.closeErr = resultErr
	close(done)
	entry.mu.Unlock()
	manager.stateMu.Unlock()
	return resultErr
}

func (manager *Manager) closeEntry(ctx context.Context, entry *managedAgent) error {
	entry.mu.Lock()
	for entry.closing {
		done := entry.closeDone
		entry.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-done:
		}
		entry.mu.Lock()
	}
	if entry.snapshot.Lifecycle == LifecycleClosed {
		err := entry.closeErr
		entry.mu.Unlock()
		return err
	}
	entry.closing = true
	entry.closeDone = make(chan struct{})
	done := entry.closeDone
	session := entry.session
	if entry.sessionClosed {
		session = nil
	}
	agentID := entry.snapshot.ID
	entry.mu.Unlock()

	var closeErr error
	if session != nil {
		closeErr = session.Close(ctx)
	}
	var resultErr error
	if closeErr != nil {
		resultErr = fmt.Errorf("close agent %s: %w", agentID, closeErr)
	}
	manager.stateMu.Lock()
	entry.mu.Lock()
	entry.sessionClosed = closeErr == nil
	entry.snapshot.ActiveTurnID = ""
	entry.snapshot.UpdatedAt = time.Now().UTC()
	if closeErr == nil {
		entry.snapshot.Lifecycle = LifecycleClosed
		entry.snapshot.LastError = ""
	} else {
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.LastError = closeErr.Error()
	}
	entry.mu.Unlock()

	if persistErr := manager.persist(); persistErr != nil {
		resultErr = errors.Join(resultErr, persistErr)
		if stateWasReplaced(persistErr) {
			manager.failPersistentManager(persistErr)
		} else {
			entry.mu.Lock()
			entry.persistenceFailed = true
			entry.snapshot.Lifecycle = LifecycleError
			entry.snapshot.LastError = persistErr.Error()
			entry.snapshot.UpdatedAt = time.Now().UTC()
			entry.mu.Unlock()
		}
	}
	entry.mu.Lock()
	entry.closing = false
	entry.closeErr = resultErr
	snapshot := cloneSnapshot(entry.snapshot)
	close(done)
	entry.mu.Unlock()
	manager.stateMu.Unlock()
	manager.dispatch(stateEvent(snapshot))
	return resultErr
}

func (manager *Manager) watchProvider(agentID string, entry *managedAgent) {
	defer manager.watchers.Done()
	for event := range entry.session.Events() {
		manager.handleProviderEvent(agentID, entry, event)
	}
	entry.mu.Lock()
	unexpected := !entry.closing && !entry.providerEnded
	entry.mu.Unlock()
	if unexpected {
		manager.handleProviderEvent(agentID, entry, ProviderEvent{
			Type:  ProviderEventProcessExited,
			Error: "provider event stream closed",
		})
	}
}

func (manager *Manager) handleProviderEvent(agentID string, entry *managedAgent, event ProviderEvent) {
	manager.stateMu.Lock()
	defer manager.stateMu.Unlock()
	entry.mu.Lock()
	if entry.closing || entry.persistenceFailed {
		entry.mu.Unlock()
		return
	}
	previousProviderEnded := entry.providerEnded
	if event.Type == ProviderEventProcessExited {
		entry.providerEnded = true
	}
	activeTurn := entry.snapshot.ActiveTurnID
	switch event.Type {
	case ProviderEventTurnStarted, ProviderEventTimeline, ProviderEventTurnCompleted, ProviderEventTurnFailed:
		if event.TurnID == "" || event.TurnID != activeTurn {
			entry.mu.Unlock()
			return
		}
	}

	switch event.Type {
	case ProviderEventThreadStarted:
		previousSnapshot := cloneSnapshot(entry.snapshot)
		if event.SessionID != "" {
			entry.snapshot.RuntimeInfo.SessionID = event.SessionID
			if entry.snapshot.Persistence == nil {
				entry.snapshot.Persistence = &PersistenceHandle{Provider: entry.snapshot.Provider}
			}
			entry.snapshot.Persistence.SessionID = event.SessionID
		}
		snapshot := cloneSnapshot(entry.snapshot)
		entry.mu.Unlock()
		if manager.persistOrPoison(entry, func() {
			entry.snapshot = previousSnapshot
			entry.providerEnded = previousProviderEnded
		}) != nil {
			return
		}
		manager.dispatch(streamEvent(agentID, event, nil, ""))
		manager.dispatch(stateEvent(snapshot))
	case ProviderEventTurnStarted:
		entry.mu.Unlock()
		manager.dispatch(streamEvent(agentID, event, nil, ""))
	case ProviderEventTimeline:
		if event.TurnID != "" && event.TurnID != activeTurn {
			entry.mu.Unlock()
			return
		}
		now := time.Now().UTC()
		previousHead := entry.snapshot.TimelineHeadSeq
		previousUpdatedAt := entry.snapshot.UpdatedAt
		row := entry.timeline.append(now, event.TurnID, event.Item)
		entry.snapshot.TimelineHeadSeq = row.Seq
		entry.snapshot.UpdatedAt = now
		epoch := entry.timeline.epoch
		entry.mu.Unlock()
		if manager.persistOrPoison(entry, func() {
			entry.timeline.removeLast(row.Seq)
			entry.snapshot.TimelineHeadSeq = previousHead
			entry.snapshot.UpdatedAt = previousUpdatedAt
			entry.providerEnded = previousProviderEnded
		}) != nil {
			return
		}
		manager.dispatch(streamEvent(agentID, event, &row, epoch))
	case ProviderEventTurnCompleted:
		if event.TurnID == "" || event.TurnID != activeTurn {
			entry.mu.Unlock()
			return
		}
		if entry.aborting {
			copy := cloneProviderEvent(event)
			entry.abortTerminal = &copy
			entry.mu.Unlock()
			return
		}
		previousSnapshot := cloneSnapshot(entry.snapshot)
		entry.snapshot.ActiveTurnID = ""
		entry.snapshot.Lifecycle = LifecycleIdle
		entry.snapshot.UpdatedAt = time.Now().UTC()
		snapshot := cloneSnapshot(entry.snapshot)
		entry.mu.Unlock()
		if manager.persistOrPoison(entry, func() {
			entry.snapshot = previousSnapshot
			entry.providerEnded = previousProviderEnded
		}) != nil {
			return
		}
		manager.dispatch(streamEvent(agentID, event, nil, ""))
		manager.dispatch(stateEvent(snapshot))
	case ProviderEventTurnFailed:
		if event.TurnID == "" || event.TurnID != activeTurn {
			entry.mu.Unlock()
			return
		}
		if entry.aborting {
			copy := cloneProviderEvent(event)
			entry.abortTerminal = &copy
			entry.mu.Unlock()
			return
		}
		entry.mu.Unlock()
		manager.failTurnLocked(agentID, entry, event.TurnID, event.Error)
	case ProviderEventProcessExited:
		if entry.snapshot.Lifecycle == LifecycleClosed {
			entry.mu.Unlock()
			return
		}
		turnID := activeTurn
		message := strings.TrimSpace(event.Error)
		if message == "" {
			message = "provider process exited"
		}
		now := time.Now().UTC()
		previousSnapshot := cloneSnapshot(entry.snapshot)
		entry.snapshot.ActiveTurnID = ""
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.LastError = message
		entry.snapshot.UpdatedAt = now
		row := entry.timeline.append(now, turnID, TimelineItem{Type: TimelineError, Text: message, Error: message})
		entry.snapshot.TimelineHeadSeq = row.Seq
		snapshot := cloneSnapshot(entry.snapshot)
		epoch := entry.timeline.epoch
		entry.mu.Unlock()
		if manager.persistOrPoison(entry, func() {
			entry.snapshot = previousSnapshot
			entry.timeline.removeLast(row.Seq)
			entry.providerEnded = previousProviderEnded
		}) != nil {
			return
		}
		if turnID != "" {
			manager.dispatch(streamEvent(agentID, ProviderEvent{Type: ProviderEventTurnFailed, TurnID: turnID, Error: message}, nil, ""))
		}
		manager.dispatch(streamEvent(agentID, ProviderEvent{Type: ProviderEventTimeline, TurnID: turnID, Item: row.Item}, &row, epoch))
		manager.dispatch(stateEvent(snapshot))
	default:
		entry.mu.Unlock()
	}
}

func (manager *Manager) failTurn(agentID string, entry *managedAgent, turnID, message string) {
	manager.stateMu.Lock()
	defer manager.stateMu.Unlock()
	manager.failTurnLocked(agentID, entry, turnID, message)
}

func (manager *Manager) failTurnLocked(agentID string, entry *managedAgent, turnID, message string) {
	entry.mu.Lock()
	if entry.snapshot.ActiveTurnID != turnID || entry.aborting || entry.closing || entry.persistenceFailed {
		entry.mu.Unlock()
		return
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "provider turn failed"
	}
	now := time.Now().UTC()
	previousSnapshot := cloneSnapshot(entry.snapshot)
	entry.snapshot.ActiveTurnID = ""
	entry.snapshot.Lifecycle = LifecycleError
	entry.snapshot.LastError = message
	entry.snapshot.UpdatedAt = now
	row := entry.timeline.append(now, turnID, TimelineItem{Type: TimelineError, Text: message, Error: message})
	entry.snapshot.TimelineHeadSeq = row.Seq
	snapshot := cloneSnapshot(entry.snapshot)
	epoch := entry.timeline.epoch
	entry.mu.Unlock()

	if manager.persistOrPoison(entry, func() {
		entry.snapshot = previousSnapshot
		entry.timeline.removeLast(row.Seq)
	}) != nil {
		return
	}
	manager.dispatch(streamEvent(agentID, ProviderEvent{Type: ProviderEventTurnFailed, TurnID: turnID, Error: message}, nil, ""))
	manager.dispatch(streamEvent(agentID, ProviderEvent{Type: ProviderEventTimeline, TurnID: turnID, Item: row.Item}, &row, epoch))
	manager.dispatch(stateEvent(snapshot))
}

func (manager *Manager) beginMutation(agentID string) (*managedAgent, func(), error) {
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return nil, nil, ErrManagerClosed
	}
	if manager.persistenceErr != nil {
		err := manager.persistenceErr
		manager.mu.Unlock()
		return nil, nil, err
	}
	entry := manager.agents[agentID]
	if entry == nil {
		manager.mu.Unlock()
		return nil, nil, fmt.Errorf("%w: %s", ErrAgentNotFound, agentID)
	}
	manager.mutations.Add(1)
	manager.mu.Unlock()
	return entry, manager.mutations.Done, nil
}

func (manager *Manager) get(agentID string) (*managedAgent, error) {
	manager.mu.RLock()
	entry := manager.agents[agentID]
	manager.mu.RUnlock()
	if entry == nil {
		return nil, fmt.Errorf("%w: %s", ErrAgentNotFound, agentID)
	}
	return entry, nil
}

func (manager *Manager) dispatch(event Event) {
	manager.mu.RLock()
	listeners := make([]*subscriber, 0, len(manager.listeners))
	for _, listener := range manager.listeners {
		listeners = append(listeners, listener)
	}
	manager.mu.RUnlock()
	for _, listener := range listeners {
		select {
		case listener.queue <- cloneEvent(event):
		default:
			// Timeline rows remain authoritative and can be fetched after a slow
			// listener misses a best-effort live notification.
		}
	}
}

func newSubscriber(listener func(Event)) *subscriber {
	subscription := &subscriber{
		queue:  make(chan Event, 256),
		stop:   make(chan struct{}),
		listen: listener,
	}
	go subscription.run()
	return subscription
}

func (subscription *subscriber) run() {
	for {
		select {
		case event := <-subscription.queue:
			subscription.listen(event)
		case <-subscription.stop:
			for {
				select {
				case event := <-subscription.queue:
					subscription.listen(event)
				default:
					return
				}
			}
		}
	}
}

func (subscription *subscriber) stopNow() {
	subscription.once.Do(func() { close(subscription.stop) })
}

func waitGroup(ctx context.Context, group *sync.WaitGroup) error {
	done := make(chan struct{})
	go func() {
		group.Wait()
		close(done)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return nil
	}
}

func cloneProviderEvent(event ProviderEvent) ProviderEvent {
	event.Item = cloneTimelineItem(event.Item)
	return event
}

func stateEvent(snapshot Snapshot) Event {
	copy := cloneSnapshot(snapshot)
	return Event{Type: EventAgentState, AgentID: snapshot.ID, Agent: &copy}
}

func streamEvent(agentID string, stream ProviderEvent, row *TimelineRow, epoch string) Event {
	stream.Item = cloneTimelineItem(stream.Item)
	event := Event{Type: EventAgentStream, AgentID: agentID, Stream: &stream, Epoch: epoch}
	if row != nil {
		copy := cloneTimelineRow(*row)
		event.Row = &copy
	}
	return event
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	if snapshot.Persistence != nil {
		copy := *snapshot.Persistence
		snapshot.Persistence = &copy
	}
	snapshot.Labels = cloneLabels(snapshot.Labels)
	return snapshot
}

func cloneLabels(labels map[string]string) map[string]string {
	copy := make(map[string]string, len(labels))
	for key, value := range labels {
		copy[key] = value
	}
	return copy
}

func cloneEvent(event Event) Event {
	if event.Agent != nil {
		copy := cloneSnapshot(*event.Agent)
		event.Agent = &copy
	}
	if event.Stream != nil {
		copy := *event.Stream
		copy.Item = cloneTimelineItem(copy.Item)
		event.Stream = &copy
	}
	if event.Row != nil {
		copy := cloneTimelineRow(*event.Row)
		event.Row = &copy
	}
	return event
}

func validateConfig(config Config) error {
	if strings.TrimSpace(config.Provider) == "" {
		return errors.New("provider must not be empty")
	}
	if !filepath.IsAbs(config.CWD) {
		return errors.New("agent cwd must be absolute")
	}
	info, err := os.Stat(config.CWD)
	if err != nil {
		return fmt.Errorf("inspect agent cwd: %w", err)
	}
	if !info.IsDir() {
		return errors.New("agent cwd must be a directory")
	}
	return nil
}

func randomID(prefix string, size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate %s ID: %w", prefix, err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(data), nil
}
