package chief

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ByteTrue/byspace/internal/home"
)

const (
	missionTransactionPrepared  = "prepared"
	missionTransactionCommitted = "committed"
)

type missionTransactionJournal struct {
	State       string  `json:"state"`
	Before      Mission `json:"before"`
	After       Mission `json:"after"`
	Event       Event   `json:"event"`
	EventOffset int64   `json:"eventOffset"`
}

func (s *Store) UpdateMissionAndAppendEvent(missionID string, fn func(*Mission) (Event, error)) (*Mission, Event, error) {
	if err := validateID(missionID); err != nil {
		return nil, Event{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.loadAndReconcileMissionLocked(missionID)
	if err != nil {
		return nil, Event{}, err
	}
	before := cloneMission(*current)
	working := cloneMission(*current)
	event, err := fn(&working)
	if err != nil {
		return nil, Event{}, err
	}

	now := s.nowString()
	event.Seq = working.HeadSeq + 1
	event.MissionID = missionID
	event.Summary = ClampSummary(event.Summary)
	if event.Ts == "" {
		event.Ts = now
	}
	working.HeadSeq = event.Seq
	working.UpdatedAt = now
	if target := derefStr(event.TargetAgentID); target != "" && target != "*" {
		queuePendingBellOnMission(&working, target, event.Seq, event.Kind, now)
	}
	after := normalizeMission(working)

	_, tornTail, eventOffset, err := s.readEventsFileLocked(missionID)
	if err != nil {
		return nil, Event{}, err
	}
	if tornTail {
		if err := os.Truncate(s.eventsPath(missionID), eventOffset); err != nil {
			return nil, Event{}, fmt.Errorf("repair torn event tail for mission %s: %w", missionID, err)
		}
	}

	journal := missionTransactionJournal{
		State: missionTransactionPrepared, Before: before, After: after, Event: event, EventOffset: eventOffset,
	}
	if err := s.writeMissionTransactionJournalLocked(missionID, journal); err != nil {
		return nil, Event{}, fmt.Errorf("prepare mission transaction %s: %w", missionID, err)
	}
	rollback := func(cause error) (*Mission, Event, error) {
		rollbackErr := s.rollbackMissionTransactionLocked(missionID, journal)
		return nil, Event{}, errors.Join(cause, rollbackErr)
	}
	if err := s.appendEventLineLocked(missionID, event); err != nil {
		return rollback(fmt.Errorf("append transaction event for mission %s: %w", missionID, err))
	}
	if err := s.writeMissionLocked(after); err != nil {
		return rollback(fmt.Errorf("write transaction mission %s: %w", missionID, err))
	}
	journal.State = missionTransactionCommitted
	if err := s.writeMissionTransactionJournalLocked(missionID, journal); err != nil {
		return rollback(fmt.Errorf("commit mission transaction %s: %w", missionID, err))
	}
	result := cloneMission(after)
	if err := s.removeMissionTransactionJournalLocked(missionID); err != nil {
		return &result, event, fmt.Errorf("clean committed mission transaction %s: %w", missionID, err)
	}
	return &result, event, nil
}

func (s *Store) missionTransactionJournalPath(missionID string) string {
	return filepath.Join(s.missionDir(missionID), "transaction.json")
}

func (s *Store) writeMissionTransactionJournalLocked(missionID string, journal missionTransactionJournal) error {
	payload, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	return home.WriteAtomic(s.missionTransactionJournalPath(missionID), append(payload, 10), 0o600)
}

func (s *Store) removeMissionTransactionJournalLocked(missionID string) error {
	if err := os.Remove(s.missionTransactionJournalPath(missionID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Store) recoverMissionTransactionLocked(missionID string) error {
	raw, err := os.ReadFile(s.missionTransactionJournalPath(missionID))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read mission transaction %s: %w", missionID, err)
	}
	var journal missionTransactionJournal
	if err := json.Unmarshal(raw, &journal); err != nil {
		return fmt.Errorf("parse mission transaction %s: %w", missionID, err)
	}
	if journal.Before.ID != missionID || journal.After.ID != missionID || journal.Event.MissionID != missionID || journal.EventOffset < 0 {
		return fmt.Errorf("invalid mission transaction %s", missionID)
	}
	switch journal.State {
	case missionTransactionPrepared:
		return s.rollbackMissionTransactionLocked(missionID, journal)
	case missionTransactionCommitted:
		if err := s.truncateMissionEventsForTransactionLocked(missionID, journal.EventOffset); err != nil {
			return fmt.Errorf("recover committed event log for mission %s: %w", missionID, err)
		}
		if err := s.appendEventLineLocked(missionID, journal.Event); err != nil {
			return fmt.Errorf("recover committed event for mission %s: %w", missionID, err)
		}
		if err := s.writeMissionLocked(journal.After); err != nil {
			return fmt.Errorf("recover committed mission %s: %w", missionID, err)
		}
		if err := s.removeMissionTransactionJournalLocked(missionID); err != nil {
			return fmt.Errorf("clean recovered mission transaction %s: %w", missionID, err)
		}
		return nil
	default:
		return fmt.Errorf("unknown mission transaction state %q for %s", journal.State, missionID)
	}
}

func (s *Store) rollbackMissionTransactionLocked(missionID string, journal missionTransactionJournal) error {
	var errs []error
	if err := s.writeMissionLocked(journal.Before); err != nil {
		errs = append(errs, fmt.Errorf("restore before mission %s: %w", missionID, err))
	}
	if err := s.truncateMissionEventsForTransactionLocked(missionID, journal.EventOffset); err != nil {
		errs = append(errs, fmt.Errorf("restore before event log for mission %s: %w", missionID, err))
	}
	if len(errs) == 0 {
		if err := s.removeMissionTransactionJournalLocked(missionID); err != nil {
			errs = append(errs, fmt.Errorf("clean rolled back mission transaction %s: %w", missionID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Store) truncateMissionEventsForTransactionLocked(missionID string, offset int64) error {
	info, err := os.Stat(s.eventsPath(missionID))
	if os.IsNotExist(err) {
		if offset == 0 {
			return nil
		}
		return fmt.Errorf("event log missing with valid prefix length %d", offset)
	}
	if err != nil {
		return err
	}
	if info.Size() < offset {
		return fmt.Errorf("event log length %d is shorter than valid prefix length %d", info.Size(), offset)
	}
	return os.Truncate(s.eventsPath(missionID), offset)
}
