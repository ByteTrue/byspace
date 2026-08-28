package agent

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	restartInterruptedMessage     = "daemon restarted while the Agent turn was active"
	restartPendingDeliveryMessage = "daemon restarted before provider acceptance was recorded"
)

// OpenManager restores a persistent Agent catalog. A missing state file creates
// an empty catalog; malformed state is returned without being rewritten.
func OpenManager(ctx context.Context, providers map[string]Provider, statePath string) (*Manager, error) {
	store := newFileStateStore(statePath)
	state, err := store.Load()
	if err != nil {
		return nil, err
	}
	if err := validatePersistedState(state); err != nil {
		return nil, fmt.Errorf("validate Agent state %s: %w", statePath, err)
	}
	manager := newManager(providers, store)
	for _, record := range state.Agents {
		manager.restoreAgent(ctx, record)
	}
	if err := manager.persist(); err != nil {
		manager.closeRestoredSessions()
		return nil, err
	}
	manager.startRestoredWatchers()
	return manager, nil
}

func (manager *Manager) restoreAgent(ctx context.Context, record persistedAgent) {
	snapshot := cloneSnapshot(record.Snapshot)
	snapshot.Labels = cloneLabels(snapshot.Labels)
	entry := &managedAgent{
		operation:  make(chan struct{}, 1),
		timeline:   timelineFromSnapshot(record.Timeline),
		deliveries: restoredDeliveries(record.Deliveries),
		snapshot:   snapshot,
	}
	entry.operation <- struct{}{}

	if snapshot.Lifecycle == LifecycleClosed {
		entry.providerEnded = true
		manager.addRestoredEntry(entry)
		return
	}
	if snapshot.Lifecycle == LifecycleRunning {
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.ActiveTurnID = ""
		entry.snapshot.LastError = restartInterruptedMessage
		entry.snapshot.UpdatedAt = time.Now().UTC()
	}

	provider := manager.providers[snapshot.Provider]
	if provider == nil {
		manager.markRestoreFailure(entry, fmt.Errorf("%w: %s", ErrProviderNotFound, snapshot.Provider))
		manager.addRestoredEntry(entry)
		return
	}
	if snapshot.Persistence == nil || strings.TrimSpace(snapshot.Persistence.NativeHandle) == "" {
		manager.markRestoreFailure(entry, errors.New("Agent has no resumable provider handle"))
		manager.addRestoredEntry(entry)
		return
	}
	resume := *snapshot.Persistence
	config := Config{
		Provider:         snapshot.Provider,
		CWD:              snapshot.CWD,
		WorkspaceID:      snapshot.WorkspaceID,
		Model:            snapshot.RuntimeInfo.Model,
		ThinkingOptionID: snapshot.RuntimeInfo.ThinkingOptionID,
		Title:            snapshot.Title,
		Labels:           cloneLabels(snapshot.Labels),
		Resume:           &resume,
	}
	session, err := provider.Start(ctx, config)
	if err != nil {
		manager.markRestoreFailure(entry, fmt.Errorf("resume %s provider: %w", snapshot.Provider, err))
		manager.addRestoredEntry(entry)
		return
	}
	runtimeInfo := session.RuntimeInfo()
	if runtimeInfo.Provider == "" {
		runtimeInfo.Provider = snapshot.Provider
	}
	if err := validateResumedIdentity(resume, runtimeInfo); err != nil {
		closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = session.Close(closeCtx)
		cancel()
		manager.markRestoreFailure(entry, err)
		manager.addRestoredEntry(entry)
		return
	}
	entry.session = session
	entry.snapshot.RuntimeInfo = runtimeInfo
	entry.snapshot.Capabilities = session.Capabilities()
	entry.snapshot.Persistence = &PersistenceHandle{
		Provider:     runtimeInfo.Provider,
		SessionID:    runtimeInfo.SessionID,
		NativeHandle: runtimeInfo.NativeHandle,
	}
	manager.addRestoredEntry(entry)
}

func (manager *Manager) startRestoredWatchers() {
	manager.mu.RLock()
	entries := make([]*managedAgent, 0, len(manager.agents))
	for _, entry := range manager.agents {
		if entry.session != nil {
			entries = append(entries, entry)
		}
	}
	manager.mu.RUnlock()
	manager.watchers.Add(len(entries))
	for _, entry := range entries {
		go manager.watchProvider(entry.snapshot.ID, entry)
	}
}

func (manager *Manager) addRestoredEntry(entry *managedAgent) {
	manager.stateMu.Lock()
	manager.mu.Lock()
	manager.agents[entry.snapshot.ID] = entry
	manager.mu.Unlock()
	manager.stateMu.Unlock()
}

func (manager *Manager) markRestoreFailure(entry *managedAgent, err error) {
	entry.providerEnded = true
	entry.snapshot.ActiveTurnID = ""
	entry.snapshot.Lifecycle = LifecycleError
	entry.snapshot.LastError = err.Error()
	entry.snapshot.UpdatedAt = time.Now().UTC()
}

func validateResumedIdentity(expected PersistenceHandle, actual RuntimeInfo) error {
	if actual.Provider != expected.Provider {
		return fmt.Errorf("resumed provider is %q, want %q", actual.Provider, expected.Provider)
	}
	if expected.SessionID != "" && actual.SessionID != expected.SessionID {
		return fmt.Errorf("resumed session ID is %q, want %q", actual.SessionID, expected.SessionID)
	}
	if expected.NativeHandle != "" && filepath.Clean(actual.NativeHandle) != filepath.Clean(expected.NativeHandle) {
		return fmt.Errorf("resumed native handle is %q, want %q", actual.NativeHandle, expected.NativeHandle)
	}
	return nil
}

func restoredDeliveries(records []persistedDelivery) map[string]*delivery {
	deliveries := make(map[string]*delivery, len(records))
	for _, record := range records {
		done := make(chan struct{})
		close(done)
		resultErr := error(nil)
		if record.Error != "" {
			resultErr = errors.New(record.Error)
		} else if !record.Accepted {
			resultErr = errors.New(restartPendingDeliveryMessage)
		}
		deliveries[record.ClientMessageID] = &delivery{
			result: SendResult{Accepted: record.Accepted, TurnID: record.TurnID},
			err:    resultErr,
			done:   done,
		}
	}
	return deliveries
}

func timelineFromSnapshot(snapshot TimelineSnapshot) timeline {
	rows := make([]TimelineRow, len(snapshot.Rows))
	for index, row := range snapshot.Rows {
		rows[index] = cloneTimelineRow(row)
	}
	return timeline{epoch: snapshot.Epoch, nextSeq: uint64(len(rows)) + 1, rows: rows}
}

func (manager *Manager) persist() error {
	if manager.store == nil {
		return nil
	}
	manager.persistMu.Lock()
	defer manager.persistMu.Unlock()
	if err := manager.store.Save(manager.persistedState()); err != nil {
		return fmt.Errorf("persist Agent state: %w", err)
	}
	return nil
}

func (manager *Manager) persistOrPoison(entry *managedAgent, rollback func()) error {
	if err := manager.persist(); err != nil {
		if stateWasReplaced(err) {
			manager.failPersistentManager(err)
			return err
		}
		entry.mu.Lock()
		if rollback != nil {
			rollback()
		}
		if entry.persistenceFailed {
			entry.mu.Unlock()
			return err
		}
		entry.persistenceFailed = true
		entry.providerEnded = true
		entry.snapshot.ActiveTurnID = ""
		entry.snapshot.Lifecycle = LifecycleError
		entry.snapshot.LastError = err.Error()
		entry.snapshot.UpdatedAt = time.Now().UTC()
		snapshot := cloneSnapshot(entry.snapshot)
		session := entry.session
		entry.mu.Unlock()
		manager.dispatch(stateEvent(snapshot))
		manager.stopSessionAfterPersistenceFailure(session)
		return err
	}
	return nil
}

func (manager *Manager) failPersistentManager(err error) {
	manager.mu.Lock()
	if manager.persistenceErr == nil {
		manager.persistenceErr = err
		manager.cancel()
	}
	if manager.closed {
		manager.mu.Unlock()
		return
	}
	entries := make([]*managedAgent, 0, len(manager.agents))
	for _, entry := range manager.agents {
		entries = append(entries, entry)
	}
	manager.mu.Unlock()
	for _, entry := range entries {
		entry.mu.Lock()
		entry.persistenceFailed = true
		entry.providerEnded = true
		session := entry.session
		closing := entry.closing
		entry.mu.Unlock()
		if !closing {
			manager.stopSessionAfterPersistenceFailure(session)
		}
	}
}

func (manager *Manager) stopSessionAfterPersistenceFailure(session Session) {
	if session == nil {
		return
	}
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return
	}
	manager.watchers.Add(1)
	manager.mu.Unlock()
	go func() {
		defer manager.watchers.Done()
		closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = session.Close(closeCtx)
	}()
}

func (manager *Manager) persistedState() persistedState {
	manager.mu.RLock()
	ids := make([]string, 0, len(manager.agents))
	for id := range manager.agents {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	entries := make([]*managedAgent, 0, len(ids))
	for _, id := range ids {
		entries = append(entries, manager.agents[id])
	}
	manager.mu.RUnlock()
	state := persistedState{Version: stateVersion, Agents: make([]persistedAgent, 0, len(entries))}
	for _, entry := range entries {
		entry.mu.Lock()
		deliveryIDs := make([]string, 0, len(entry.deliveries))
		for clientMessageID := range entry.deliveries {
			deliveryIDs = append(deliveryIDs, clientMessageID)
		}
		sort.Strings(deliveryIDs)
		deliveries := make([]persistedDelivery, 0, len(deliveryIDs))
		for _, clientMessageID := range deliveryIDs {
			current := entry.deliveries[clientMessageID]
			record := persistedDelivery{
				ClientMessageID: clientMessageID,
				TurnID:          current.result.TurnID,
				Accepted:        current.result.Accepted,
			}
			if current.err != nil {
				record.Error = current.err.Error()
			}
			deliveries = append(deliveries, record)
		}
		state.Agents = append(state.Agents, persistedAgent{
			Snapshot:   cloneSnapshot(entry.snapshot),
			Timeline:   entry.timeline.snapshot(),
			Deliveries: deliveries,
		})
		entry.mu.Unlock()
	}
	return state
}

func (manager *Manager) closeRestoredSessions() {
	manager.cancel()
	manager.mu.RLock()
	entries := make([]*managedAgent, 0, len(manager.agents))
	for _, entry := range manager.agents {
		entries = append(entries, entry)
	}
	manager.mu.RUnlock()
	for _, entry := range entries {
		if entry.session == nil {
			continue
		}
		closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = entry.session.Close(closeCtx)
		cancel()
	}
	manager.watchers.Wait()
}

func validatePersistedState(state persistedState) error {
	seenAgents := make(map[string]struct{}, len(state.Agents))
	for index, record := range state.Agents {
		snapshot := record.Snapshot
		if !strings.HasPrefix(snapshot.ID, "agt_") {
			return fmt.Errorf("agents[%d] has invalid ID %q", index, snapshot.ID)
		}
		if _, exists := seenAgents[snapshot.ID]; exists {
			return fmt.Errorf("duplicate Agent ID %q", snapshot.ID)
		}
		seenAgents[snapshot.ID] = struct{}{}
		if strings.TrimSpace(snapshot.Provider) == "" {
			return fmt.Errorf("Agent %s has empty provider", snapshot.ID)
		}
		if !filepath.IsAbs(snapshot.CWD) {
			return fmt.Errorf("Agent %s cwd is not absolute", snapshot.ID)
		}
		if snapshot.CreatedAt.IsZero() || snapshot.UpdatedAt.IsZero() {
			return fmt.Errorf("Agent %s has zero lifecycle timestamp", snapshot.ID)
		}
		switch snapshot.Lifecycle {
		case LifecycleIdle, LifecycleRunning, LifecycleError, LifecycleClosed:
		default:
			return fmt.Errorf("Agent %s has invalid lifecycle %q", snapshot.ID, snapshot.Lifecycle)
		}
		if snapshot.Lifecycle == LifecycleRunning && snapshot.ActiveTurnID == "" {
			return fmt.Errorf("running Agent %s has no active turn", snapshot.ID)
		}
		if snapshot.Lifecycle != LifecycleRunning && snapshot.ActiveTurnID != "" {
			return fmt.Errorf("non-running Agent %s has active turn %q", snapshot.ID, snapshot.ActiveTurnID)
		}
		if record.Timeline.Epoch == "" || snapshot.TimelineEpoch != record.Timeline.Epoch {
			return fmt.Errorf("Agent %s has inconsistent Timeline epoch", snapshot.ID)
		}
		if snapshot.TimelineHeadSeq != uint64(len(record.Timeline.Rows)) {
			return fmt.Errorf("Agent %s Timeline head is %d, want %d", snapshot.ID, snapshot.TimelineHeadSeq, len(record.Timeline.Rows))
		}
		seenMessages := make(map[string]string)
		for rowIndex, row := range record.Timeline.Rows {
			wantSeq := uint64(rowIndex + 1)
			if row.Seq != wantSeq {
				return fmt.Errorf("Agent %s Timeline row %d has seq %d, want %d", snapshot.ID, rowIndex, row.Seq, wantSeq)
			}
			if row.Timestamp.IsZero() {
				return fmt.Errorf("Agent %s Timeline row %d has zero timestamp", snapshot.ID, rowIndex)
			}
			if !validTimelineItemType(row.Item.Type) {
				return fmt.Errorf("Agent %s Timeline row %d has invalid type %q", snapshot.ID, rowIndex, row.Item.Type)
			}
			if row.Item.Type == TimelineUserMessage {
				if row.Item.ClientMessageID == "" || row.TurnID == "" {
					return fmt.Errorf("Agent %s Timeline user row %d has no delivery identity", snapshot.ID, rowIndex)
				}
				if _, exists := seenMessages[row.Item.ClientMessageID]; exists {
					return fmt.Errorf("Agent %s has duplicate clientMessageId %q", snapshot.ID, row.Item.ClientMessageID)
				}
				seenMessages[row.Item.ClientMessageID] = row.TurnID
			}
		}
		if len(record.Deliveries) != len(seenMessages) {
			return fmt.Errorf("Agent %s has %d deliveries for %d user messages", snapshot.ID, len(record.Deliveries), len(seenMessages))
		}
		seenDeliveries := make(map[string]struct{}, len(record.Deliveries))
		for deliveryIndex, delivery := range record.Deliveries {
			wantTurnID, exists := seenMessages[delivery.ClientMessageID]
			if !exists || delivery.TurnID == "" || delivery.TurnID != wantTurnID {
				return fmt.Errorf("Agent %s delivery %d does not match its Timeline user message", snapshot.ID, deliveryIndex)
			}
			if _, exists := seenDeliveries[delivery.ClientMessageID]; exists {
				return fmt.Errorf("Agent %s has duplicate delivery %q", snapshot.ID, delivery.ClientMessageID)
			}
			seenDeliveries[delivery.ClientMessageID] = struct{}{}
		}
		if snapshot.Persistence != nil {
			if snapshot.Persistence.Provider != snapshot.Provider {
				return fmt.Errorf("Agent %s persistence provider is %q, want %q", snapshot.ID, snapshot.Persistence.Provider, snapshot.Provider)
			}
			if strings.TrimSpace(snapshot.Persistence.SessionID) == "" || strings.TrimSpace(snapshot.Persistence.NativeHandle) == "" {
				return fmt.Errorf("Agent %s has incomplete persistence identity", snapshot.ID)
			}
		}
	}
	return nil
}

func validTimelineItemType(value TimelineItemType) bool {
	switch value {
	case TimelineUserMessage, TimelineAssistantMessage, TimelineReasoning, TimelineToolCall, TimelineError:
		return true
	default:
		return false
	}
}
