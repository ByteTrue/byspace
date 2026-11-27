package chief

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
)

var (
	// ErrMissionNotFound indicates a mission ID has no persisted state.
	ErrMissionNotFound = errors.New("mission not found")
	// ErrThreadNotFound indicates a thread ID does not exist inside the mission.
	ErrThreadNotFound = errors.New("thread not found")
	// ErrInvalidID rejects empty or path-traversing identifiers.
	ErrInvalidID = errors.New("invalid orchestration identifier")
)

// PendingBellEntry identifies a pending bell discovered for boot replay or queue drain.
type PendingBellEntry struct {
	MissionID string `json:"missionId"`
	AgentID   string `json:"agentId"`
	TargetSeq int64  `json:"targetSeq"`
	Reason    string `json:"reason,omitempty"`
}

// Store persists Chief missions and append-only event logs under
// $BYSPACE_HOME/orchestration/missions/<missionId>/.
type Store struct {
	mu      sync.Mutex
	baseDir string
	now     func() time.Time
}

// NewStore creates a Store rooted at $BYSPACE_HOME/orchestration/missions.
func NewStore(homeDir string) *Store {
	return &Store{
		baseDir: filepath.Join(homeDir, "orchestration", "missions"),
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// NewID generates an opaque prefixed hex identifier (e.g. "msn_<16 hex>", "thr_<16 hex>").
func NewID(prefix string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func (s *Store) nowString() string {
	return s.now().UTC().Format(time.RFC3339Nano)
}

func validateID(id string) error {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" || trimmed == "." || trimmed == ".." || strings.ContainsAny(trimmed, `/\`) {
		return ErrInvalidID
	}
	return nil
}

func (s *Store) missionDir(missionID string) string {
	return filepath.Join(s.baseDir, missionID)
}

func (s *Store) missionPath(missionID string) string {
	return filepath.Join(s.missionDir(missionID), "mission.json")
}

func (s *Store) eventsPath(missionID string) string {
	return filepath.Join(s.missionDir(missionID), "events.jsonl")
}

// CreateMission persists a new Mission atomically and initializes empty collections.
func (s *Store) CreateMission(m Mission) (Mission, error) {
	if strings.TrimSpace(m.ID) == "" {
		m.ID = NewID("msn")
	}
	if err := validateID(m.ID); err != nil {
		return Mission{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.recoverMissionTransactionLocked(m.ID); err != nil {
		return Mission{}, err
	}
	if _, err := os.Stat(s.missionPath(m.ID)); err == nil {
		return Mission{}, fmt.Errorf("mission already exists: %s", m.ID)
	}

	now := s.nowString()
	if m.CreatedAt == "" {
		m.CreatedAt = now
	}
	if m.UpdatedAt == "" {
		m.UpdatedAt = now
	}
	if m.Tier == "" {
		m.Tier = TierL1
	}
	if m.Status == "" {
		m.Status = MissionStatusActive
	}
	if m.Landing == nil {
		lp := DefaultLandingPolicy()
		m.Landing = &lp
	}
	normalized := normalizeMission(m)
	if err := s.writeMissionLocked(normalized); err != nil {
		return Mission{}, err
	}
	return cloneMission(normalized), nil
}

// GetMission loads one Mission by ID, reconciling any trailing committed events from events.jsonl.
func (s *Store) GetMission(missionID string) (*Mission, error) {
	if err := validateID(missionID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadAndReconcileMissionLocked(missionID)
	if err != nil {
		return nil, err
	}
	cp := cloneMission(*m)
	return &cp, nil
}

// FindMissionByThread resolves the Mission owning threadID across persisted missions.
func (s *Store) FindMissionByThread(threadID string) (*Mission, error) {
	if err := validateID(threadID); err != nil {
		return nil, err
	}
	missions, err := s.ListMissions()
	if err != nil {
		return nil, err
	}
	for i := range missions {
		for _, th := range missions[i].Threads {
			if th.ID == threadID {
				cp := cloneMission(missions[i])
				return &cp, nil
			}
		}
	}
	return nil, ErrThreadNotFound
}

// ListMissions returns all persisted missions sorted newest-updated first.
func (s *Store) ListMissions() ([]Mission, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Mission{}, nil
		}
		return nil, err
	}

	missions := make([]Mission, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		m, loadErr := s.loadAndReconcileMissionLocked(entry.Name())
		if loadErr != nil {
			return nil, fmt.Errorf("load mission %s: %w", entry.Name(), loadErr)
		}
		missions = append(missions, cloneMission(*m))
	}
	sort.SliceStable(missions, func(i, j int) bool {
		if missions[i].UpdatedAt != missions[j].UpdatedAt {
			return missions[i].UpdatedAt > missions[j].UpdatedAt
		}
		return missions[i].ID < missions[j].ID
	})
	return missions, nil
}

// SaveMission atomically writes the full Mission record.
func (s *Store) SaveMission(m Mission) error {
	if err := validateID(m.ID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.recoverMissionTransactionLocked(m.ID); err != nil {
		return err
	}
	if m.UpdatedAt == "" {
		m.UpdatedAt = s.nowString()
	}
	return s.writeMissionLocked(normalizeMission(m))
}

// UpdateMission runs a read-modify-write cycle under the store lock and persists atomically.
func (s *Store) UpdateMission(missionID string, fn func(*Mission) error) (*Mission, error) {
	if err := validateID(missionID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	m, err := s.loadAndReconcileMissionLocked(missionID)
	if err != nil {
		return nil, err
	}
	if err := fn(m); err != nil {
		return nil, err
	}
	m.UpdatedAt = s.nowString()
	normalized := normalizeMission(*m)
	if err := s.writeMissionLocked(normalized); err != nil {
		return nil, err
	}
	cp := cloneMission(normalized)
	return &cp, nil
}

// AppendEvent assigns the next monotonic seq, clamps Summary <= 600 chars, appends to
// events.jsonl, updates HeadSeq (and queues a PendingBell when TargetAgentID is non-empty),
// and persists mission.json atomically.
func (s *Store) AppendEvent(missionID string, ev Event) (Event, error) {
	_, committed, err := s.UpdateMissionAndAppendEvent(missionID, func(*Mission) (Event, error) {
		return ev, nil
	})
	return committed, err
}

// EnqueueBell records a durable pending bell on mission.json without emitting a new event.
func (s *Store) EnqueueBell(missionID, agentID string, targetSeq int64, reason string) error {
	if err := validateID(missionID); err != nil {
		return err
	}
	if strings.TrimSpace(agentID) == "" {
		return nil
	}
	_, err := s.UpdateMission(missionID, func(m *Mission) error {
		if targetSeq <= 0 {
			targetSeq = m.HeadSeq
		}
		queuePendingBellOnMission(m, agentID, targetSeq, reason, s.nowString())
		return nil
	})
	return err
}

// RecordBellAttempt records a failed delivery attempt without advancing the agent's cursor.
func (s *Store) RecordBellAttempt(missionID, agentID, errMsg string) error {
	if err := validateID(missionID); err != nil {
		return err
	}
	_, err := s.UpdateMission(missionID, func(m *Mission) error {
		if _, retired := m.RetiredAgents[agentID]; retired {
			delete(m.PendingBells, agentID)
			delete(m.Cursors, agentID)
			return nil
		}
		if m.PendingBells == nil {
			m.PendingBells = make(map[string]*PendingBell)
		}
		pb := m.PendingBells[agentID]
		if pb == nil {
			pb = &PendingBell{
				AgentID:   agentID,
				TargetSeq: m.HeadSeq,
				QueuedAt:  s.nowString(),
			}
			m.PendingBells[agentID] = pb
		}
		pb.Attempts++
		pb.LastError = errMsg
		return nil
	})
	return err
}

// MarkBellDelivered advances Cursors[agentID] monotonically and clears satisfied pending bells.
func (s *Store) MarkBellDelivered(missionID, agentID string, seq int64) error {
	if err := validateID(missionID); err != nil {
		return err
	}
	if strings.TrimSpace(agentID) == "" {
		return nil
	}
	_, err := s.UpdateMission(missionID, func(m *Mission) error {
		if _, retired := m.RetiredAgents[agentID]; retired {
			delete(m.PendingBells, agentID)
			delete(m.Cursors, agentID)
			return nil
		}
		if m.Cursors == nil {
			m.Cursors = make(map[string]int64)
		}
		if seq > m.Cursors[agentID] {
			m.Cursors[agentID] = seq
		}
		if m.PendingBells != nil {
			if pb, ok := m.PendingBells[agentID]; ok && (pb == nil || pb.TargetSeq <= m.Cursors[agentID]) {
				delete(m.PendingBells, agentID)
			}
		}
		return nil
	})
	return err
}

// ReadEvents reads events with Seq > afterSeq. Passing limit <= 0 returns all matching events.
func (s *Store) ReadEvents(missionID string, afterSeq int64, limit int) ([]Event, error) {
	if err := validateID(missionID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.recoverMissionTransactionLocked(missionID); err != nil {
		return nil, err
	}
	if _, err := s.readMissionFileLocked(missionID); err != nil {
		return nil, err
	}
	events, _, _, err := s.readEventsFileLocked(missionID)
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(events))
	for _, ev := range events {
		if ev.Seq > afterSeq {
			out = append(out, ev)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

// ReadEventsForAgent reads unread events in (afterSeq, headSeq] addressed to agentID or "*".
func (s *Store) ReadEventsForAgent(missionID, agentID string, afterSeq int64) ([]Event, error) {
	events, err := s.ReadEvents(missionID, afterSeq, 0)
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(events))
	for _, ev := range events {
		target := derefStr(ev.TargetAgentID)
		if target == agentID || target == "*" {
			out = append(out, ev)
		}
	}
	return out, nil
}

// RecoverPendingBells reconciles mission.json against events.jsonl across all non-terminal
// missions and returns every pending bell needing boot replay.
func (s *Store) RecoverPendingBells() ([]PendingBellEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []PendingBellEntry{}, nil
		}
		return nil, err
	}

	var pending []PendingBellEntry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		m, loadErr := s.loadAndReconcileMissionLocked(entry.Name())
		if loadErr != nil {
			return nil, fmt.Errorf("load mission %s: %w", entry.Name(), loadErr)
		}
		if m.Status == MissionStatusCompleted || m.Status == MissionStatusCanceled || m.Status == MissionStatusFailed {
			continue
		}
		for agentID, pb := range m.PendingBells {
			if pb == nil {
				continue
			}
			if m.Cursors[agentID] < pb.TargetSeq {
				pending = append(pending, PendingBellEntry{
					MissionID: m.ID,
					AgentID:   agentID,
					TargetSeq: pb.TargetSeq,
					Reason:    pb.Reason,
				})
			}
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		if pending[i].MissionID != pending[j].MissionID {
			return pending[i].MissionID < pending[j].MissionID
		}
		return pending[i].AgentID < pending[j].AgentID
	})
	return pending, nil
}

func (s *Store) writeMissionLocked(m Mission) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(s.missionPath(m.ID), append(b, '\n'), 0o600)
}

func (s *Store) readMissionFileLocked(missionID string) (*Mission, error) {
	raw, err := os.ReadFile(s.missionPath(missionID))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrMissionNotFound
		}
		return nil, err
	}
	var m Mission
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parse mission %s: %w", missionID, err)
	}
	if m.ID == "" {
		m.ID = missionID
	}
	normalized := normalizeMission(m)
	return &normalized, nil
}

func (s *Store) loadAndReconcileMissionLocked(missionID string) (*Mission, error) {
	if err := s.recoverMissionTransactionLocked(missionID); err != nil {
		return nil, err
	}
	m, err := s.readMissionFileLocked(missionID)
	if err != nil {
		return nil, err
	}
	events, tornTail, validBytes, err := s.readEventsFileLocked(missionID)
	if err != nil {
		return nil, err
	}
	if tornTail {
		if err := os.Truncate(s.eventsPath(missionID), validBytes); err != nil {
			return nil, err
		}
	}

	dirty := false
	for _, ev := range events {
		if ev.Seq > m.HeadSeq {
			m.HeadSeq = ev.Seq
			dirty = true
		}
		if target := derefStr(ev.TargetAgentID); target != "" && target != "*" {
			if _, retired := m.RetiredAgents[target]; retired {
				continue
			}
			if m.Cursors[target] < ev.Seq {
				if pb := m.PendingBells[target]; pb == nil || pb.TargetSeq < ev.Seq {
					ts := ev.Ts
					if ts == "" {
						ts = s.nowString()
					}
					queuePendingBellOnMission(m, target, ev.Seq, ev.Kind, ts)
					dirty = true
				}
			}
		}
	}
	if dirty {
		m.UpdatedAt = s.nowString()
		if writeErr := s.writeMissionLocked(normalizeMission(*m)); writeErr != nil {
			return nil, writeErr
		}
	}
	return m, nil
}

func (s *Store) appendEventLineLocked(missionID string, ev Event) error {
	dir := s.missionDir(missionID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	line, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	f, err := os.OpenFile(s.eventsPath(missionID), os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	if info.Size() > 0 {
		var lastByte [1]byte
		if _, err := f.ReadAt(lastByte[:], info.Size()-1); err != nil {
			_ = f.Close()
			return err
		}
		if lastByte[0] != '\n' {
			line = append([]byte{'\n'}, line...)
		}
	}
	_, writeErr := f.Write(line)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

func (s *Store) readEventsFileLocked(missionID string) ([]Event, bool, int64, error) {
	raw, err := os.ReadFile(s.eventsPath(missionID))
	if err != nil {
		if os.IsNotExist(err) {
			return []Event{}, false, 0, nil
		}
		return nil, false, 0, err
	}

	events := make([]Event, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	lines := make([]string, 0)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if scanErr := scanner.Err(); scanErr != nil {
		return nil, false, 0, scanErr
	}

	tornTail := false
	validBytes := int64(len(raw))
	for idx, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		var ev Event
		if unmarshalErr := json.Unmarshal([]byte(trimmed), &ev); unmarshalErr != nil {
			if idx == len(lines)-1 && raw[len(raw)-1] != '\n' {
				tornTail = true
				validBytes = int64(bytes.LastIndexByte(raw, '\n') + 1)
				break
			}
			return nil, false, 0, fmt.Errorf("corrupt event line %d in %s: %w", idx+1, missionID, unmarshalErr)
		}
		events = append(events, ev)
	}
	return events, tornTail, validBytes, nil
}

func queuePendingBellOnMission(m *Mission, agentID string, seq int64, reason, now string) {
	if _, retired := m.RetiredAgents[agentID]; retired {
		return
	}
	if m.PendingBells == nil {
		m.PendingBells = make(map[string]*PendingBell)
	}
	existing := m.PendingBells[agentID]
	if existing == nil {
		m.PendingBells[agentID] = &PendingBell{
			AgentID:   agentID,
			TargetSeq: seq,
			Reason:    reason,
			QueuedAt:  now,
		}
		return
	}
	if seq > existing.TargetSeq {
		existing.TargetSeq = seq
	}
	if reason != "" {
		existing.Reason = reason
	}
}

func normalizeMission(m Mission) Mission {
	cp := cloneMission(m)
	if cp.SharedLocks == nil {
		cp.SharedLocks = map[string]string{}
	}
	if cp.Cursors == nil {
		cp.Cursors = map[string]int64{}
	}
	if cp.Threads == nil {
		cp.Threads = []Thread{}
	}
	if cp.Landing == nil {
		lp := DefaultLandingPolicy()
		cp.Landing = &lp
	}
	return cp
}
