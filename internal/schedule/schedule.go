// Package schedule persists schedules and runs them on their cadence.
//
// Ported from server/schedule/service.ts and store.ts in the archived Node daemon. The service owns
// the schedule records (one JSON file each under $BYSPACE_HOME/schedules) and the clock: a one-second
// tick fires every active schedule whose next run is due. What a run does — start an agent, prompt an
// existing one — lives with the daemon and is reached through Hooks.
package schedule

import (
	"context"
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

type Cadence struct {
	Type       string `json:"type"` // "every" | "cron"
	EveryMs    int64  `json:"everyMs,omitempty"`
	Expression string `json:"expression,omitempty"`
	Timezone   string `json:"timezone,omitempty"`
}

type TargetConfig struct {
	Provider         string `json:"provider"`
	Cwd              string `json:"cwd"`
	ModeID           string `json:"modeId,omitempty"`
	Model            string `json:"model,omitempty"`
	ThinkingOptionID string `json:"thinkingOptionId,omitempty"`
	// ArchiveOnFinish is a pointer because the field is tri-state: absent means "archive" (the
	// default the runner applies), false means the user turned it off. A plain bool with omitempty
	// dropped every explicit false, so the form read the knob back as "not set".
	ArchiveOnFinish *bool   `json:"archiveOnFinish,omitempty"`
	Isolation       string  `json:"isolation,omitempty"`
	Title           *string `json:"title,omitempty"`
	// The rest of a new agent's config. A schedule created from an agent carries them over so each
	// run starts the agent the way the caller runs; dropping them on save loses them for every run.
	ProviderOptions map[string]any `json:"providerOptions,omitempty"`
	FeatureValues   map[string]any `json:"featureValues,omitempty"`
	SystemPrompt    *string        `json:"systemPrompt,omitempty"`
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
	Name      *string
	Prompt    string
	Cadence   Cadence
	Target    Target
	MaxRuns   *int
	ExpiresAt *string
	// RunOnCreate nil means the default: an interval schedule fires at once, a cron one waits for
	// its first slot.
	RunOnCreate *bool
}

// Optional is a field an update may set, clear (Set with a nil Value), or leave alone (not Set).
type Optional[T any] struct {
	Set   bool
	Value *T
}

// Present returns an Optional that sets the field to v (nil clears it).
func Present[T any](v *T) Optional[T] { return Optional[T]{Set: true, Value: v} }

// NewAgentConfigPatch is the writable half of a new-agent target's config.
type NewAgentConfigPatch struct {
	Provider         *string
	Cwd              *string
	Model            Optional[string]
	ModeID           Optional[string]
	ThinkingOptionID Optional[string]
	ArchiveOnFinish  *bool
	Isolation        *string
}

type UpdateInput struct {
	ID             string
	Name           Optional[string]
	Prompt         *string
	Cadence        *Cadence
	NewAgentConfig *NewAgentConfigPatch
	MaxRuns        Optional[int]
	ExpiresAt      Optional[string]
}

type ExecutionResult struct {
	AgentID *string
	Output  *string
}

// RunHandle is the run an Execute call is performing.
type RunHandle struct {
	ID     string
	record func(workspaceID string, agentID *string)
}

// RecordWorkspace stores the workspace (and, once it exists, the agent) a run created on the run
// record. It has to happen as soon as they exist: a daemon that restarts mid-run finds the
// workspace there and archives it, instead of leaving it in the sidebar forever.
func (h RunHandle) RecordWorkspace(workspaceID string, agentID *string) {
	if h.record != nil {
		h.record(workspaceID, agentID)
	}
}

// Hooks connect the service to the daemon.
type Hooks struct {
	// Execute performs one run of a schedule.
	Execute func(ctx context.Context, sched StoredSchedule, run RunHandle) (ExecutionResult, error)
	// AgentLive reports whether an agent exists and is not archived.
	AgentLive func(agentID string) bool
	// ArchiveWorkspace archives the workspace of a run the daemon restart interrupted.
	ArchiveWorkspace func(workspaceID string) error
	// Now is the clock. Nil means time.Now.
	Now func() time.Time
	// Logf reports failures the tick cannot return to anyone. Nil discards them.
	Logf func(format string, args ...any)
}

// TargetGoneError reports that a schedule's target no longer exists.
//
// Ported from ScheduleTargetGoneError: the agent was deleted or archived, or a new-agent cwd was
// removed. These are permanent, so the schedule completes instead of being retried until it
// burns through its budget.
type TargetGoneError struct {
	Reason string
}

func (e TargetGoneError) Error() string { return e.Reason }

const tickInterval = time.Second

// Service manages persisted schedules under $BYSPACE_HOME/schedules/*.json.
type Service struct {
	// mu serializes every read-modify-write of the schedule files.
	mu      sync.Mutex
	baseDir string
	hooks   Hooks

	runningMu sync.Mutex
	running   map[string]bool

	stopOnce sync.Once
	stop     chan struct{}
}

func NewService(homeDir string, hooks Hooks) *Service {
	return &Service{
		baseDir: filepath.Join(homeDir, "schedules"),
		hooks:   hooks,
		running: map[string]bool{},
		stop:    make(chan struct{}),
	}
}

func (s *Service) now() time.Time {
	if s.hooks.Now != nil {
		return s.hooks.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) logf(format string, args ...any) {
	if s.hooks.Logf != nil {
		s.hooks.Logf(format, args...)
	}
}

// isoTime formats a time the way Node's toISOString does.
func isoTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func parseTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, value)
}

func stringPtr(value string) *string { return &value }

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// newScheduleID is eight hex characters, as Node's generateScheduleId.
func newScheduleID() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func notFound(id string) error { return fmt.Errorf("Schedule not found: %s", id) }

// ---------------------------------------------------------------------------------------- store

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

// getLocked reads one schedule; a missing file is (nil, nil).
func (s *Service) getLocked(id string) (*StoredSchedule, error) {
	if strings.TrimSpace(id) == "" || strings.ContainsAny(id, `/\`) {
		return nil, nil
	}
	raw, err := os.ReadFile(s.schedulePath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
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

// listLocked returns every schedule, oldest first, as Node's store.list.
//
// A file that does not parse is skipped rather than failing the list: Node's list throws, which
// stops every schedule from ticking because of one bad file.
func (s *Service) listLocked() ([]StoredSchedule, error) {
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
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt < out[j].CreatedAt
	})
	return out, nil
}

// update applies fn to one schedule under the lock. fn returns the next record and whether it
// changed; an unchanged record is not rewritten. A missing schedule is (nil, nil).
func (s *Service) update(id string, fn func(StoredSchedule) (StoredSchedule, bool, error)) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.getLocked(id)
	if err != nil || current == nil {
		return nil, err
	}
	next, changed, err := fn(*current)
	if err != nil {
		return nil, err
	}
	if !changed {
		return current, nil
	}
	if err := validateRecord(next); err != nil {
		return nil, err
	}
	if err := s.writeLocked(next); err != nil {
		return nil, err
	}
	return &next, nil
}

// validateRecord is the part of the protocol schema a record can violate through this service.
func validateRecord(sched StoredSchedule) error {
	if strings.TrimSpace(sched.Prompt) == "" {
		return errors.New("Schedule prompt is required")
	}
	if err := ValidateCadence(sched.Cadence); err != nil {
		return err
	}
	switch sched.Target.Type {
	case "agent":
		if strings.TrimSpace(sched.Target.AgentID) == "" {
			return errors.New("agentId is required for an agent target")
		}
	case "new-agent":
		config := sched.Target.Config
		if config == nil || strings.TrimSpace(config.Provider) == "" {
			return errors.New("provider is required when target is new-agent")
		}
		if strings.TrimSpace(config.Cwd) == "" {
			return errors.New("cwd is required when target is new-agent")
		}
		if config.Isolation != "" && config.Isolation != "local" && config.Isolation != "worktree" {
			return fmt.Errorf("Invalid isolation: %q", config.Isolation)
		}
	default:
		return fmt.Errorf("Invalid schedule target type: %q", sched.Target.Type)
	}
	if sched.MaxRuns != nil && *sched.MaxRuns <= 0 {
		return errors.New("maxRuns must be a positive integer")
	}
	return nil
}

// ------------------------------------------------------------------------------------- helpers

func trimOptionalName(name *string) *string {
	if name == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*name)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizePrompt(prompt string) (string, error) {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return "", errors.New("Schedule prompt is required")
	}
	return trimmed, nil
}

func normalizeMaxRuns(value *int) (*int, error) {
	if value == nil {
		return nil, nil
	}
	if *value <= 0 {
		return nil, errors.New("maxRuns must be a positive integer")
	}
	v := *value
	return &v, nil
}

func countCompletedRuns(sched StoredSchedule) int {
	count := 0
	for _, run := range sched.Runs {
		if run.Status != "running" {
			count++
		}
	}
	return count
}

// ShouldArchiveRunWorkspace: a run that never got an agent leaves nothing to inspect, so its
// workspace goes regardless of the setting; otherwise archiveOnFinish decides, defaulting to yes.
func ShouldArchiveRunWorkspace(agentID *string, archiveOnFinish *bool) bool {
	return agentID == nil || archiveOnFinish == nil || *archiveOnFinish
}

func shouldComplete(sched StoredSchedule, now time.Time) bool {
	if sched.ExpiresAt != nil {
		if expires, err := parseTime(*sched.ExpiresAt); err == nil && !expires.After(now) {
			return true
		}
	}
	if sched.MaxRuns == nil {
		return false
	}
	return countCompletedRuns(sched) >= *sched.MaxRuns
}

func completeSchedule(sched StoredSchedule, now time.Time) StoredSchedule {
	sched.Status = "completed"
	sched.NextRunAt = nil
	sched.PausedAt = nil
	sched.UpdatedAt = isoTime(now)
	return sched
}

// mergeCadenceTimezone keeps a cron schedule's time zone when an update sends a cron cadence
// without one.
func mergeCadenceTimezone(current, next Cadence) Cadence {
	if current.Type == "cron" && next.Type == "cron" && next.Timezone == "" && current.Timezone != "" {
		next.Timezone = current.Timezone
	}
	return next
}

// nextRunAfter advances from `from` until the next run is strictly after now.
func nextRunAfter(cadence Cadence, from, now time.Time) (time.Time, error) {
	next, err := ComputeNextRunAt(cadence, from)
	if err != nil {
		return time.Time{}, err
	}
	for !next.After(now) {
		if next, err = ComputeNextRunAt(cadence, next); err != nil {
			return time.Time{}, err
		}
	}
	return next, nil
}

func (s *Service) buildRecord(in CreateInput, name *string, prompt string, now time.Time) (StoredSchedule, error) {
	runOnCreate := in.Cadence.Type == "every"
	if in.RunOnCreate != nil {
		runOnCreate = *in.RunOnCreate
	}
	nextRunAt := now
	if !runOnCreate {
		computed, err := ComputeNextRunAt(in.Cadence, now)
		if err != nil {
			return StoredSchedule{}, err
		}
		nextRunAt = computed
	}
	maxRuns, err := normalizeMaxRuns(in.MaxRuns)
	if err != nil {
		return StoredSchedule{}, err
	}
	nowStr := isoTime(now)
	return StoredSchedule{
		Name:      name,
		Prompt:    prompt,
		Cadence:   in.Cadence,
		Target:    in.Target,
		Status:    "active",
		CreatedAt: nowStr,
		UpdatedAt: nowStr,
		NextRunAt: stringPtr(isoTime(nextRunAt)),
		ExpiresAt: in.ExpiresAt,
		MaxRuns:   maxRuns,
		Runs:      []Run{},
	}, nil
}

func (s *Service) createLocked(record StoredSchedule) (*StoredSchedule, error) {
	record.ID = newScheduleID()
	if err := validateRecord(record); err != nil {
		return nil, err
	}
	if err := s.writeLocked(record); err != nil {
		return nil, err
	}
	return &record, nil
}

// --------------------------------------------------------------------------------- operations

func (s *Service) Create(in CreateInput) (*StoredSchedule, error) {
	prompt, err := normalizePrompt(in.Prompt)
	if err != nil {
		return nil, err
	}
	if err := ValidateCadence(in.Cadence); err != nil {
		return nil, err
	}
	record, err := s.buildRecord(in, trimOptionalName(in.Name), prompt, s.now())
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createLocked(record)
}

// CreateOrReplace creates a schedule, or refreshes the live one with the same name and target.
//
// Ported from createOrReplace: the MCP create tools call it, and a model re-running "set up a
// nightly check" must not mint one schedule per call. The match is the name plus the whole target
// (an agent's id, or a new agent's full config), and a completed schedule never matches.
func (s *Service) CreateOrReplace(in CreateInput) (*StoredSchedule, error) {
	name := trimOptionalName(in.Name)
	prompt, err := normalizePrompt(in.Prompt)
	if err != nil {
		return nil, err
	}
	if err := ValidateCadence(in.Cadence); err != nil {
		return nil, err
	}
	if name == nil {
		return s.Create(in)
	}
	identity := targetIdentityKey(in.Target)

	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.listLocked()
	if err != nil {
		return nil, err
	}
	for _, current := range all {
		currentName := trimOptionalName(current.Name)
		if current.Status == "completed" || currentName == nil || *currentName != *name ||
			targetIdentityKey(current.Target) != identity {
			continue
		}
		now := s.now()
		cadence := mergeCadenceTimezone(current.Cadence, in.Cadence)
		runOnCreate := cadence.Type == "every"
		if in.RunOnCreate != nil {
			runOnCreate = *in.RunOnCreate
		}
		nextRunAt := now
		if !runOnCreate {
			if nextRunAt, err = ComputeNextRunAt(cadence, now); err != nil {
				return nil, err
			}
		}
		maxRuns, err := normalizeMaxRuns(in.MaxRuns)
		if err != nil {
			return nil, err
		}
		updated := current
		updated.Name = name
		updated.Prompt = prompt
		updated.Cadence = cadence
		updated.Target = in.Target
		updated.Status = "active"
		updated.PausedAt = nil
		updated.NextRunAt = stringPtr(isoTime(nextRunAt))
		updated.ExpiresAt = in.ExpiresAt
		updated.MaxRuns = maxRuns
		updated.UpdatedAt = isoTime(now)
		if err := validateRecord(updated); err != nil {
			return nil, err
		}
		if err := s.writeLocked(updated); err != nil {
			return nil, err
		}
		return &updated, nil
	}
	record, err := s.buildRecord(in, name, prompt, s.now())
	if err != nil {
		return nil, err
	}
	return s.createLocked(record)
}

// targetIdentityKey is the canonical JSON of what a schedule acts on.
func targetIdentityKey(target Target) string {
	var identity map[string]any
	if target.Type == "agent" {
		identity = map[string]any{"type": target.Type, "agentId": target.AgentID}
	} else {
		identity = map[string]any{"type": target.Type, "config": target.Config}
	}
	raw, err := json.Marshal(identity)
	if err != nil {
		return ""
	}
	// Round-trip through a generic value so every object's keys come out sorted.
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return string(raw)
	}
	canonical, _ := json.Marshal(generic)
	return string(canonical)
}

func (s *Service) List() ([]StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listLocked()
}

func (s *Service) Inspect(id string) (*StoredSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sched, err := s.getLocked(id)
	if err != nil {
		return nil, err
	}
	if sched == nil {
		return nil, notFound(id)
	}
	return sched, nil
}

// Logs returns a schedule's runs, oldest first.
func (s *Service) Logs(id string) ([]Run, error) {
	sched, err := s.Inspect(id)
	if err != nil {
		return nil, err
	}
	runs := append([]Run(nil), sched.Runs...)
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].StartedAt < runs[j].StartedAt })
	return runs, nil
}

func (s *Service) Pause(id string) (*StoredSchedule, error) {
	paused, err := s.update(id, func(sched StoredSchedule) (StoredSchedule, bool, error) {
		if sched.Status == "completed" {
			return sched, false, fmt.Errorf("Schedule %s is already completed", id)
		}
		if sched.Status == "paused" {
			return sched, false, nil
		}
		now := isoTime(s.now())
		sched.Status = "paused"
		sched.NextRunAt = nil
		sched.PausedAt = &now
		sched.UpdatedAt = now
		return sched, true, nil
	})
	if err != nil {
		return nil, err
	}
	if paused == nil {
		return nil, notFound(id)
	}
	return paused, nil
}

func (s *Service) Resume(id string) (*StoredSchedule, error) {
	resumed, err := s.update(id, func(sched StoredSchedule) (StoredSchedule, bool, error) {
		if sched.Status == "completed" {
			return sched, false, fmt.Errorf("Schedule %s is already completed", id)
		}
		if sched.Status == "active" {
			return sched, false, nil
		}
		now := s.now()
		next, err := ComputeNextRunAt(sched.Cadence, now)
		if err != nil {
			return sched, false, err
		}
		sched.Status = "active"
		sched.PausedAt = nil
		sched.NextRunAt = stringPtr(isoTime(next))
		sched.UpdatedAt = isoTime(now)
		return sched, true, nil
	})
	if err != nil {
		return nil, err
	}
	if resumed == nil {
		return nil, notFound(id)
	}
	return resumed, nil
}

func (s *Service) Update(in UpdateInput) (*StoredSchedule, error) {
	updated, err := s.update(in.ID, func(sched StoredSchedule) (StoredSchedule, bool, error) {
		now := s.now()
		if in.Prompt != nil {
			prompt, err := normalizePrompt(*in.Prompt)
			if err != nil {
				return sched, false, err
			}
			sched.Prompt = prompt
		}
		if in.Name.Set {
			sched.Name = trimOptionalName(in.Name.Value)
		}
		if in.Cadence != nil {
			cadence := mergeCadenceTimezone(sched.Cadence, *in.Cadence)
			if err := ValidateCadence(cadence); err != nil {
				return sched, false, err
			}
			sched.Cadence = cadence
			sched.NextRunAt = nil
			if sched.Status == "active" {
				next, err := ComputeNextRunAt(cadence, now)
				if err != nil {
					return sched, false, err
				}
				sched.NextRunAt = stringPtr(isoTime(next))
			}
		}
		if in.NewAgentConfig != nil {
			if sched.Target.Type != "new-agent" {
				return sched, false, errors.New("new-agent config updates are only valid for new-agent target schedules")
			}
			target, err := applyNewAgentConfig(sched.Target, *in.NewAgentConfig)
			if err != nil {
				return sched, false, err
			}
			sched.Target = target
		}
		if in.MaxRuns.Set {
			maxRuns, err := normalizeMaxRuns(in.MaxRuns.Value)
			if err != nil {
				return sched, false, err
			}
			sched.MaxRuns = maxRuns
		}
		if in.ExpiresAt.Set {
			sched.ExpiresAt = in.ExpiresAt.Value
		}
		sched.UpdatedAt = isoTime(now)
		return sched, true, nil
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, notFound(in.ID)
	}
	return updated, nil
}

// applyNewAgentConfig patches a new-agent target. A string field set to empty clears an optional
// knob (model, mode, thinking) and is refused for the two the run cannot do without.
func applyNewAgentConfig(target Target, patch NewAgentConfigPatch) (Target, error) {
	config := TargetConfig{}
	if target.Config != nil {
		config = *target.Config
	}
	if patch.Provider != nil {
		trimmed := strings.TrimSpace(*patch.Provider)
		if trimmed == "" {
			return target, errors.New("provider cannot be empty")
		}
		config.Provider = trimmed
	}
	if patch.Cwd != nil {
		trimmed := strings.TrimSpace(*patch.Cwd)
		if trimmed == "" {
			return target, errors.New("cwd cannot be empty")
		}
		config.Cwd = trimmed
	}
	setOptional := func(field Optional[string], into *string) {
		if !field.Set {
			return
		}
		if field.Value == nil {
			*into = ""
			return
		}
		*into = strings.TrimSpace(*field.Value)
	}
	setOptional(patch.Model, &config.Model)
	setOptional(patch.ModeID, &config.ModeID)
	setOptional(patch.ThinkingOptionID, &config.ThinkingOptionID)
	if patch.ArchiveOnFinish != nil {
		archive := *patch.ArchiveOnFinish
		config.ArchiveOnFinish = &archive
	}
	if patch.Isolation != nil {
		config.Isolation = *patch.Isolation
	}
	target.Config = &config
	return target, nil
}

func (s *Service) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(id) == "" || strings.ContainsAny(id, `/\`) {
		return nil
	}
	err := os.Remove(s.schedulePath(id))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// CompleteForAgent ends every heartbeat that targets an archived agent: it can never fire again.
func (s *Service) CompleteForAgent(agentID string) (int, error) {
	all, err := s.List()
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, sched := range all {
		if sched.Target.Type != "agent" || sched.Target.AgentID != agentID || sched.Status == "completed" {
			continue
		}
		changed := false
		if _, err := s.update(sched.ID, func(current StoredSchedule) (StoredSchedule, bool, error) {
			if current.Target.Type != "agent" || current.Target.AgentID != agentID || current.Status == "completed" {
				return current, false, nil
			}
			changed = true
			return completeSchedule(current, s.now()), true, nil
		}); err != nil {
			s.logf("schedule %s: failed to complete for archived agent %s: %v", sched.ID, agentID, err)
			continue
		}
		if changed {
			completed++
		}
	}
	return completed, nil
}

// RunOnce runs a schedule now, outside its cadence, and returns it once the run has finished.
//
// A manual run does not move the next scheduled run and does not count toward completion.
func (s *Service) RunOnce(ctx context.Context, id string) (*StoredSchedule, error) {
	sched, err := s.Inspect(id)
	if err != nil {
		return nil, err
	}
	if sched.Status == "completed" {
		return nil, fmt.Errorf("Schedule %s is already completed", id)
	}
	if !s.markRunning(id) {
		return nil, fmt.Errorf("Schedule %s is already running", id)
	}
	func() {
		defer s.unmarkRunning(id)
		s.runSchedule(ctx, *sched, s.now(), true)
	}()
	return s.Inspect(id)
}

func (s *Service) markRunning(id string) bool {
	s.runningMu.Lock()
	defer s.runningMu.Unlock()
	if s.running[id] {
		return false
	}
	s.running[id] = true
	return true
}

func (s *Service) unmarkRunning(id string) {
	s.runningMu.Lock()
	delete(s.running, id)
	s.runningMu.Unlock()
}

func (s *Service) isRunning(id string) bool {
	s.runningMu.Lock()
	defer s.runningMu.Unlock()
	return s.running[id]
}

// --------------------------------------------------------------------------------- the clock

// Start settles what the last daemon left behind, then fires due schedules every second.
func (s *Service) Start() {
	s.recoverInterruptedRuns()
	s.sweepOrphanedSchedules()
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.stop:
				return
			case <-ticker.C:
				s.Tick()
			}
		}
	}()
}

// Stop ends the clock. Runs in flight finish on their own.
func (s *Service) Stop() {
	s.stopOnce.Do(func() { close(s.stop) })
}

// Tick completes the schedules that have run out and starts the ones that are due.
func (s *Service) Tick() {
	now := s.now()
	all, err := s.List()
	if err != nil {
		s.logf("schedule tick: %v", err)
		return
	}
	for _, sched := range all {
		if sched.Status != "active" || sched.NextRunAt == nil || s.isRunning(sched.ID) {
			continue
		}
		if shouldComplete(sched, now) {
			s.completeIfDue(sched.ID, now)
			continue
		}
		next, err := parseTime(*sched.NextRunAt)
		if err != nil || next.After(now) {
			continue
		}
		if !s.markRunning(sched.ID) {
			continue
		}
		go func(sched StoredSchedule) {
			defer s.unmarkRunning(sched.ID)
			s.runSchedule(context.Background(), sched, now, false)
		}(sched)
	}
}

func (s *Service) completeIfDue(id string, now time.Time) {
	if _, err := s.update(id, func(sched StoredSchedule) (StoredSchedule, bool, error) {
		if sched.Status != "active" || sched.NextRunAt == nil || !shouldComplete(sched, now) {
			return sched, false, nil
		}
		return completeSchedule(sched, now), true, nil
	}); err != nil {
		s.logf("schedule %s: failed to complete: %v", id, err)
	}
}

// recoverInterruptedRuns fails the run a daemon restart cut off, archives the workspace it was
// working in, and moves an overdue schedule to its next slot instead of firing the missed one.
func (s *Service) recoverInterruptedRuns() {
	all, err := s.List()
	if err != nil {
		s.logf("schedule recovery: %v", err)
		return
	}
	now := s.now()
	for _, sched := range all {
		var interruptedWorkspace *string
		_, err := s.update(sched.ID, func(current StoredSchedule) (StoredSchedule, bool, error) {
			dirty := false
			for index, run := range current.Runs {
				if run.Status != "running" {
					continue
				}
				if current.Target.Type == "new-agent" && run.WorkspaceID != nil {
					var archiveOnFinish *bool
					if current.Target.Config != nil {
						archiveOnFinish = current.Target.Config.ArchiveOnFinish
					}
					if ShouldArchiveRunWorkspace(run.AgentID, archiveOnFinish) {
						interruptedWorkspace = run.WorkspaceID
					}
				}
				runs := append([]Run(nil), current.Runs...)
				ended := isoTime(now)
				message := "Daemon restarted before the scheduled run completed"
				runs[index].Status = "failed"
				runs[index].EndedAt = &ended
				runs[index].Error = &message
				current.Runs = runs
				dirty = true
				break
			}
			if current.Status == "active" && current.NextRunAt != nil {
				if due, parseErr := parseTime(*current.NextRunAt); parseErr == nil && !due.After(now) {
					next, err := nextRunAfter(current.Cadence, due, now)
					if err != nil {
						return current, false, err
					}
					current.NextRunAt = stringPtr(isoTime(next))
					dirty = true
				}
			}
			if dirty {
				current.UpdatedAt = isoTime(now)
			}
			return current, dirty, nil
		})
		if err != nil {
			s.logf("schedule %s: recovery failed: %v", sched.ID, err)
			continue
		}
		if interruptedWorkspace != nil && s.hooks.ArchiveWorkspace != nil {
			if err := s.hooks.ArchiveWorkspace(*interruptedWorkspace); err != nil {
				s.logf("schedule %s: failed to archive interrupted run workspace %s: %v", sched.ID, *interruptedWorkspace, err)
			}
		}
	}
}

// sweepOrphanedSchedules completes heartbeats whose agent was deleted or archived while the daemon
// was down: they can never fire successfully.
func (s *Service) sweepOrphanedSchedules() {
	if s.hooks.AgentLive == nil {
		return
	}
	all, err := s.List()
	if err != nil {
		s.logf("schedule sweep: %v", err)
		return
	}
	now := s.now()
	for _, sched := range all {
		if sched.Target.Type != "agent" || sched.Status == "completed" || s.hooks.AgentLive(sched.Target.AgentID) {
			continue
		}
		if _, err := s.update(sched.ID, func(current StoredSchedule) (StoredSchedule, bool, error) {
			if current.Target.Type != "agent" || current.Status == "completed" {
				return current, false, nil
			}
			return completeSchedule(current, now), true, nil
		}); err != nil {
			s.logf("schedule %s: failed to complete orphaned heartbeat: %v", sched.ID, err)
		}
	}
}

// runSchedule records a running run, executes it and records the outcome. The caller has already
// marked the schedule running.
func (s *Service) runSchedule(ctx context.Context, sched StoredSchedule, now time.Time, manual bool) {
	runID := newUUID()
	scheduledFor := isoTime(now)
	if !manual && sched.NextRunAt != nil {
		scheduledFor = *sched.NextRunAt
	}
	started := isoTime(now)
	running := Run{
		ID:           runID,
		ScheduledFor: scheduledFor,
		StartedAt:    started,
		Status:       "running",
	}
	withRun, err := s.update(sched.ID, func(current StoredSchedule) (StoredSchedule, bool, error) {
		current.Runs = append(append([]Run(nil), current.Runs...), running)
		current.UpdatedAt = started
		return current, true, nil
	})
	if err != nil || withRun == nil {
		if err != nil {
			s.logf("schedule %s: failed to record run start: %v", sched.ID, err)
		}
		return
	}

	handle := RunHandle{ID: runID, record: func(workspaceID string, agentID *string) {
		s.recordRunWorkspace(sched.ID, runID, workspaceID, agentID)
	}}
	var result ExecutionResult
	var execErr error
	if s.hooks.Execute == nil {
		execErr = errors.New("schedule runner is not configured")
	} else {
		result, execErr = s.hooks.Execute(ctx, *withRun, handle)
	}

	if execErr == nil {
		s.finishRun(sched.ID, runID, "succeeded", result.AgentID, result.Output, nil, false, manual)
		return
	}
	var gone TargetGoneError
	message := execErr.Error()
	s.finishRun(sched.ID, runID, "failed", nil, nil, &message, errors.As(execErr, &gone), manual)
}

func (s *Service) recordRunWorkspace(scheduleID, runID, workspaceID string, agentID *string) {
	if _, err := s.update(scheduleID, func(current StoredSchedule) (StoredSchedule, bool, error) {
		runs := append([]Run(nil), current.Runs...)
		for index := range runs {
			if runs[index].ID == runID && runs[index].Status == "running" {
				ws := workspaceID
				runs[index].WorkspaceID = &ws
				runs[index].AgentID = agentID
			}
		}
		current.Runs = runs
		current.UpdatedAt = isoTime(s.now())
		return current, true, nil
	}); err != nil {
		s.logf("schedule %s: failed to record run workspace: %v", scheduleID, err)
	}
}

func (s *Service) finishRun(scheduleID, runID, status string, agentID, output, runErr *string, targetGone, manual bool) {
	_, err := s.update(scheduleID, func(current StoredSchedule) (StoredSchedule, bool, error) {
		now := s.now()
		ended := isoTime(now)
		runs := append([]Run(nil), current.Runs...)
		for index := range runs {
			if runs[index].ID != runID {
				continue
			}
			runs[index].Status = status
			runs[index].EndedAt = &ended
			if agentID != nil {
				runs[index].AgentID = agentID
			}
			runs[index].Output = output
			runs[index].Error = runErr
		}
		previousNext := current.NextRunAt
		current.Runs = runs
		current.LastRunAt = &ended
		current.UpdatedAt = ended

		switch {
		case targetGone:
			// The target is permanently gone; retrying only burns the schedule down to its expiry,
			// so complete it now whether the run was manual or scheduled.
			current = completeSchedule(current, now)
		case current.Status == "completed":
			// Completed while running (the target agent was archived mid-run): keep the outcome and
			// leave the schedule ended.
		case manual:
			// A manual run moves neither the cadence nor completion.
		case shouldComplete(current, now):
			current = completeSchedule(current, now)
		case current.Status == "paused":
			current.NextRunAt = nil
		default:
			from := now
			if previousNext != nil {
				if parsed, err := parseTime(*previousNext); err == nil {
					from = parsed
				}
			}
			next, err := nextRunAfter(current.Cadence, from, now)
			if err != nil {
				return current, false, err
			}
			current.NextRunAt = stringPtr(isoTime(next))
		}
		return current, true, nil
	})
	if err != nil {
		s.logf("schedule %s: failed to record run outcome: %v", scheduleID, err)
	}
}
