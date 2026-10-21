package schedule

import (
	"context"
	"crypto/rand"
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

type Cadence struct {
	Type       string `json:"type"` // "every" | "cron"
	EveryMs    int64  `json:"everyMs,omitempty"`
	Expression string `json:"expression,omitempty"`
	Timezone   string `json:"timezone,omitempty"`
}

type TargetConfig struct {
	Provider         string  `json:"provider"`
	Cwd              string  `json:"cwd"`
	ModeID           string  `json:"modeId,omitempty"`
	Model            string  `json:"model,omitempty"`
	ThinkingOptionID string  `json:"thinkingOptionId,omitempty"`
	ArchiveOnFinish  bool    `json:"archiveOnFinish,omitempty"`
	Isolation        string  `json:"isolation,omitempty"`
	Title            *string `json:"title,omitempty"`
}

type Target struct {
	Type    string        `json:"type"` // "agent" | "new-agent"
	AgentID string        `json:"agentId,omitempty"`
	Config  *TargetConfig `json:"config,omitempty"`
}

type Run struct {
	ID           string  `json:"id"`
	ScheduledFor string  `json:"scheduledFor"`
	StartedAt    string  `json:"startedAt"`
	EndedAt      *string `json:"endedAt"`
	Status       string  `json:"status"` // "running" | "succeeded" | "failed"
	AgentID      *string `json:"agentId"`
	WorkspaceID  *string `json:"workspaceId,omitempty"`
	Output       *string `json:"output"`
	Error        *string `json:"error"`
}

type StoredSchedule struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Prompt    string  `json:"prompt"`
	Cadence   Cadence `json:"cadence"`
	Target    Target  `json:"target"`
	Status    string  `json:"status"` // "active" | "paused" | "completed"
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	NextRunAt *string `json:"nextRunAt"`
	LastRunAt *string `json:"lastRunAt"`
	PausedAt  *string `json:"pausedAt"`
	ExpiresAt *string `json:"expiresAt"`
	MaxRuns   *int    `json:"maxRuns"`
	Runs      []Run   `json:"runs"`
}

type Summary struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Prompt    string  `json:"prompt"`
	Cadence   Cadence `json:"cadence"`
	Target    Target  `json:"target"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	NextRunAt *string `json:"nextRunAt"`
	LastRunAt *string `json:"lastRunAt"`
	PausedAt  *string `json:"pausedAt"`
	ExpiresAt *string `json:"expiresAt"`
	MaxRuns   *int    `json:"maxRuns"`
}

func (s StoredSchedule) ToSummary() Summary {
	return Summary{
		ID:        s.ID,
		Name:      s.Name,
		Prompt:    s.Prompt,
		Cadence:   s.Cadence,
		Target:    s.Target,
		Status:    s.Status,
		CreatedAt: s.CreatedAt,
		UpdatedAt: s.UpdatedAt,
		NextRunAt: s.NextRunAt,
		LastRunAt: s.LastRunAt,
		PausedAt:  s.PausedAt,
		ExpiresAt: s.ExpiresAt,
		MaxRuns:   s.MaxRuns,
	}
}

type CreateInput struct {
	Name        *string
	Prompt      string
	Cadence     Cadence
	Target      Target
	MaxRuns     *int
	ExpiresAt   *string
	RunOnCreate bool
}

type UpdateInput struct {
	ID        string
	Name      *string
	HasName   bool
	Prompt    *string
	Cadence   *Cadence
	MaxRuns   *int
	ExpiresAt *string
}

type ExecutionResult struct {
	AgentID     *string
	WorkspaceID *string
	Output      *string
}

type Executor func(ctx context.Context, sched StoredSchedule) (ExecutionResult, error)

// Service manages persisted schedules under $BYSPACE_HOME/schedules/*.json.
type Service struct {
	mu       sync.Mutex
	baseDir  string
	executor Executor
}

func NewService(homeDir string, executor Executor) *Service {
	return &Service{
		baseDir:  filepath.Join(homeDir, "schedules"),
		executor: executor,
	}
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func computeNextRunAt(now time.Time, c Cadence) *string {
	var next time.Time
	switch c.Type {
	case "every":
		ms := c.EveryMs
		if ms <= 0 {
			ms = 60_000
		}
		next = now.Add(time.Duration(ms) * time.Millisecond)
	case "cron":
		parsed, err := ParseCron(c.Expression)
		if err != nil {
			// An unparseable expression must not fall back to "every minute": that turns a
			// daily schedule into a runaway loop. Park it far out so it is visibly broken
			// rather than quietly wrong.
			return nil
		}
		scheduled, err := parsed.Next(now)
		if err != nil {
			return nil
		}
		next = scheduled
	default:
		next = now.Add(time.Minute)
	}
	s := next.UTC().Format(time.RFC3339Nano)
	return &s
}

func (s *Service) schedulePath(id string) string {
	return filepath.Join(s.baseDir, id+".json")
}

func (s *Service) writeLocked(sched StoredSchedule) error {
	if sched.Runs == nil {
		sched.Runs = []Run{}
	}
	b, err := json.MarshalIndent(sched, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(s.schedulePath(sched.ID), append(b, '\n'), 0o600)
}

func (s *Service) readLocked(id string) (*StoredSchedule, error) {
	raw, err := os.ReadFile(s.schedulePath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("schedule not found: %s", id)
		}
		return nil, err
	}
	var sched StoredSchedule
	if err := json.Unmarshal(raw, &sched); err != nil {
		return nil, err
	}
	if sched.Runs == nil {
		sched.Runs = []Run{}
	}
	return &sched, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*StoredSchedule, error) {
	if strings.TrimSpace(in.Prompt) == "" {
		return nil, errors.New("prompt is required")
	}
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339Nano)
	sched := StoredSchedule{
		ID:        newUUID(),
		Name:      in.Name,
		Prompt:    in.Prompt,
		Cadence:   in.Cadence,
		Target:    in.Target,
		Status:    "active",
		CreatedAt: nowStr,
		UpdatedAt: nowStr,
		NextRunAt: computeNextRunAt(now, in.Cadence),
		ExpiresAt: in.ExpiresAt,
		MaxRuns:   in.MaxRuns,
		Runs:      []Run{},
	}

	s.mu.Lock()
	if err := s.writeLocked(sched); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	if in.RunOnCreate {
		return s.RunOnce(ctx, sched.ID)
	}
	return &sched, nil
}

func (s *Service) List() ([]StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []StoredSchedule{}, nil
		}
		return nil, err
	}

	out := make([]StoredSchedule, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.baseDir, e.Name()))
		if err != nil {
			continue
		}
		var sched StoredSchedule
		if err := json.Unmarshal(raw, &sched); err != nil || sched.ID == "" {
			continue
		}
		if sched.Runs == nil {
			sched.Runs = []Run{}
		}
		out = append(out, sched)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out, nil
}

func (s *Service) Inspect(id string) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLocked(id)
}

func (s *Service) Logs(id string) ([]Run, error) {
	sched, err := s.Inspect(id)
	if err != nil {
		return nil, err
	}
	return sched.Runs, nil
}

func (s *Service) Pause(id string) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sched, err := s.readLocked(id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	sched.Status = "paused"
	sched.PausedAt = &now
	sched.NextRunAt = nil
	sched.UpdatedAt = now
	if err := s.writeLocked(*sched); err != nil {
		return nil, err
	}
	return sched, nil
}

func (s *Service) Resume(id string) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sched, err := s.readLocked(id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339Nano)
	sched.Status = "active"
	sched.PausedAt = nil
	sched.NextRunAt = computeNextRunAt(now, sched.Cadence)
	sched.UpdatedAt = nowStr
	if err := s.writeLocked(*sched); err != nil {
		return nil, err
	}
	return sched, nil
}

func (s *Service) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.schedulePath(id))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *Service) Update(in UpdateInput) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sched, err := s.readLocked(in.ID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if in.HasName {
		sched.Name = in.Name
	}
	if in.Prompt != nil && strings.TrimSpace(*in.Prompt) != "" {
		sched.Prompt = *in.Prompt
	}
	if in.Cadence != nil {
		sched.Cadence = *in.Cadence
		if sched.Status == "active" {
			sched.NextRunAt = computeNextRunAt(now, sched.Cadence)
		}
	}
	if in.MaxRuns != nil {
		sched.MaxRuns = in.MaxRuns
	}
	if in.ExpiresAt != nil {
		sched.ExpiresAt = in.ExpiresAt
	}
	sched.UpdatedAt = now.Format(time.RFC3339Nano)
	if err := s.writeLocked(*sched); err != nil {
		return nil, err
	}
	return sched, nil
}

func (s *Service) RunOnce(ctx context.Context, id string) (*StoredSchedule, error) {
	s.mu.Lock()
	sched, err := s.readLocked(id)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	now := time.Now().UTC()
	startedStr := now.Format(time.RFC3339Nano)
	runEntry := Run{
		ID:           newUUID(),
		ScheduledFor: startedStr,
		StartedAt:    startedStr,
		Status:       "running",
	}

	if s.executor != nil {
		res, execErr := s.executor(ctx, *sched)
		endedStr := time.Now().UTC().Format(time.RFC3339Nano)
		runEntry.EndedAt = &endedStr
		runEntry.AgentID = res.AgentID
		runEntry.WorkspaceID = res.WorkspaceID
		runEntry.Output = res.Output
		if execErr != nil {
			runEntry.Status = "failed"
			msg := execErr.Error()
			runEntry.Error = &msg
		} else {
			runEntry.Status = "succeeded"
		}
	} else {
		endedStr := time.Now().UTC().Format(time.RFC3339Nano)
		runEntry.EndedAt = &endedStr
		runEntry.Status = "succeeded"
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	latest, err := s.readLocked(id)
	if err != nil {
		return nil, err
	}
	latest.Runs = append(latest.Runs, runEntry)
	latest.LastRunAt = &startedStr
	latest.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if latest.MaxRuns != nil && len(latest.Runs) >= *latest.MaxRuns {
		latest.Status = "completed"
		latest.NextRunAt = nil
	} else if latest.Status == "active" {
		latest.NextRunAt = computeNextRunAt(time.Now().UTC(), latest.Cadence)
	}
	if err := s.writeLocked(*latest); err != nil {
		return nil, err
	}
	return latest, nil
}
