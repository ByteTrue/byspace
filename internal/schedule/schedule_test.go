package schedule

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// testClock is a settable clock for the service.
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Set(t time.Time) {
	c.mu.Lock()
	c.now = t
	c.mu.Unlock()
}

type harness struct {
	svc      *Service
	clock    *testClock
	mu       sync.Mutex
	runs     []string
	archived []string
	execute  func(ctx context.Context, sched StoredSchedule, run RunHandle) (ExecutionResult, error)
	live     map[string]bool
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		clock: &testClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)},
		live:  map[string]bool{},
	}
	h.svc = NewService(t.TempDir(), Hooks{
		Execute: func(ctx context.Context, sched StoredSchedule, run RunHandle) (ExecutionResult, error) {
			h.mu.Lock()
			h.runs = append(h.runs, sched.ID)
			execute := h.execute
			h.mu.Unlock()
			if execute != nil {
				return execute(ctx, sched, run)
			}
			out := "done: " + sched.Prompt
			return ExecutionResult{Output: &out}, nil
		},
		AgentLive: func(agentID string) bool { return h.live[agentID] },
		ArchiveWorkspace: func(workspaceID string) error {
			h.mu.Lock()
			h.archived = append(h.archived, workspaceID)
			h.mu.Unlock()
			return nil
		},
		Now: h.clock.Now,
	})
	return h
}

func (h *harness) runCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.runs)
}

// waitIdle waits for the runs a Tick started to finish.
func (h *harness) waitIdle(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		h.svc.runningMu.Lock()
		idle := len(h.svc.running) == 0
		h.svc.runningMu.Unlock()
		if idle {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("runs did not finish")
}

func newAgentTarget() Target {
	return Target{Type: "new-agent", Config: &TargetConfig{Provider: "mock", Cwd: "/tmp/project"}}
}

func every(ms int64) Cadence { return Cadence{Type: "every", EveryMs: ms} }

func mustCreate(t *testing.T, h *harness, in CreateInput) *StoredSchedule {
	t.Helper()
	if in.Target.Type == "" {
		in.Target = newAgentTarget()
	}
	if in.Prompt == "" {
		in.Prompt = "check things"
	}
	created, err := h.svc.Create(in)
	if err != nil {
		t.Fatal(err)
	}
	return created
}

func boolPtr(v bool) *bool { return &v }
func intPtr(v int) *int    { return &v }

// An interval schedule fires as soon as it is created; a cron one waits for its first slot; either
// can be told otherwise. Creating never runs anything by itself.
func TestCreateSetsTheFirstRun(t *testing.T) {
	h := newHarness(t)
	now := h.clock.Now()

	interval := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	if *interval.NextRunAt != isoTime(now) {
		t.Fatalf("interval next run = %s, want now", *interval.NextRunAt)
	}
	waiting := mustCreate(t, h, CreateInput{Cadence: every(60_000), RunOnCreate: boolPtr(false)})
	if *waiting.NextRunAt != isoTime(now.Add(time.Minute)) {
		t.Fatalf("runOnCreate=false next run = %s", *waiting.NextRunAt)
	}
	daily := mustCreate(t, h, CreateInput{Cadence: cron("0 9 * * *")})
	if *daily.NextRunAt != "2026-11-03T09:00:00.000Z" {
		t.Fatalf("cron next run = %s", *daily.NextRunAt)
	}
	if h.runCount() != 0 {
		t.Fatal("create must not run the schedule")
	}
	if len(interval.ID) != 8 {
		t.Fatalf("schedule id %q, want eight hex characters", interval.ID)
	}

	for _, bad := range []CreateInput{
		{Prompt: "   ", Cadence: every(1000), Target: newAgentTarget()},
		{Prompt: "p", Cadence: cron("nope"), Target: newAgentTarget()},
		{Prompt: "p", Cadence: every(1000), Target: newAgentTarget(), MaxRuns: intPtr(0)},
		{Prompt: "p", Cadence: every(1000), Target: Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp"}}},
	} {
		if _, err := h.svc.Create(bad); err == nil {
			t.Fatalf("create %+v should fail", bad)
		}
	}
}

// The tick fires a due schedule once, records the run, and moves the next run along the cadence
// from the slot it fired for — not from when it finished.
func TestTickFiresDueSchedules(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	firedFor := *created.NextRunAt

	h.svc.Tick()
	h.waitIdle(t)
	if h.runCount() != 1 {
		t.Fatalf("runs = %d, want 1", h.runCount())
	}
	got, _ := h.svc.Inspect(created.ID)
	if len(got.Runs) != 1 || got.Runs[0].Status != "succeeded" || got.Runs[0].ScheduledFor != firedFor {
		t.Fatalf("run = %+v", got.Runs)
	}
	if got.Runs[0].Output == nil || *got.Runs[0].Output != "done: check things" {
		t.Fatalf("output = %v", got.Runs[0].Output)
	}
	if *got.NextRunAt != isoTime(h.clock.Now().Add(time.Minute)) || got.LastRunAt == nil {
		t.Fatalf("next run = %v, last run = %v", got.NextRunAt, got.LastRunAt)
	}

	// Not due yet: nothing fires.
	h.svc.Tick()
	h.waitIdle(t)
	if h.runCount() != 1 {
		t.Fatalf("a schedule fired before its next run: %d", h.runCount())
	}

	// Due again.
	h.clock.Set(h.clock.Now().Add(time.Minute))
	h.svc.Tick()
	h.waitIdle(t)
	if h.runCount() != 2 {
		t.Fatalf("runs = %d, want 2", h.runCount())
	}
}

// A schedule still running is not started again by the next tick.
func TestTickDoesNotOverlapARunningSchedule(t *testing.T) {
	h := newHarness(t)
	release := make(chan struct{})
	h.execute = func(context.Context, StoredSchedule, RunHandle) (ExecutionResult, error) {
		<-release
		return ExecutionResult{}, nil
	}
	created := mustCreate(t, h, CreateInput{Cadence: every(1000)})
	h.svc.Tick()
	time.Sleep(20 * time.Millisecond)
	h.clock.Set(h.clock.Now().Add(time.Hour))
	h.svc.Tick()
	time.Sleep(20 * time.Millisecond)
	if h.runCount() != 1 {
		t.Fatalf("runs = %d, want 1", h.runCount())
	}
	if _, err := h.svc.RunOnce(context.Background(), created.ID); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("run now during a run: %v", err)
	}
	running, _ := h.svc.Inspect(created.ID)
	if len(running.Runs) != 1 || running.Runs[0].Status != "running" {
		t.Fatalf("the run in flight is recorded as running: %+v", running.Runs)
	}
	close(release)
	h.waitIdle(t)
}

// Run now leaves the cadence alone: the next scheduled run does not move, and the run does not
// count toward maxRuns until the next tick sees it.
func TestRunOnceIsOutsideTheCadence(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h, CreateInput{Cadence: cron("0 9 * * *"), MaxRuns: intPtr(1)})

	after, err := h.svc.RunOnce(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "active" || *after.NextRunAt != *created.NextRunAt {
		t.Fatalf("a manual run moved the schedule: status %s next %v", after.Status, after.NextRunAt)
	}
	if after.Runs[0].ScheduledFor != isoTime(h.clock.Now()) {
		t.Fatalf("a manual run is scheduled for now: %s", after.Runs[0].ScheduledFor)
	}

	// The next tick sees the spent budget and completes the schedule without running it.
	h.svc.Tick()
	h.waitIdle(t)
	done, _ := h.svc.Inspect(created.ID)
	if done.Status != "completed" || done.NextRunAt != nil || h.runCount() != 1 {
		t.Fatalf("after the tick: status %s next %v runs %d", done.Status, done.NextRunAt, h.runCount())
	}
	if _, err := h.svc.RunOnce(context.Background(), created.ID); err == nil || !strings.Contains(err.Error(), "already completed") {
		t.Fatalf("run now on a completed schedule: %v", err)
	}
}

// A scheduled run that spends the budget completes the schedule.
func TestMaxRunsCompletesAfterScheduledRuns(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h, CreateInput{Cadence: every(60_000), MaxRuns: intPtr(1)})
	h.svc.Tick()
	h.waitIdle(t)
	got, _ := h.svc.Inspect(created.ID)
	if got.Status != "completed" || got.NextRunAt != nil {
		t.Fatalf("status %s next %v", got.Status, got.NextRunAt)
	}
}

// A target that no longer exists completes the schedule; an ordinary failure keeps it going.
func TestFailuresAndGoneTargets(t *testing.T) {
	h := newHarness(t)
	h.execute = func(context.Context, StoredSchedule, RunHandle) (ExecutionResult, error) {
		return ExecutionResult{}, TargetGoneError{Reason: "Agent x no longer exists"}
	}
	gone := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	got, err := h.svc.RunOnce(context.Background(), gone.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "completed" || got.Runs[0].Status != "failed" || *got.Runs[0].Error != "Agent x no longer exists" {
		t.Fatalf("gone target: %+v", got)
	}

	h.execute = func(context.Context, StoredSchedule, RunHandle) (ExecutionResult, error) {
		return ExecutionResult{}, errors.New("provider timed out")
	}
	failing := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	h.svc.Tick()
	h.waitIdle(t)
	got, _ = h.svc.Inspect(failing.ID)
	if got.Status != "active" || got.NextRunAt == nil || got.Runs[0].Status != "failed" {
		t.Fatalf("ordinary failure: %+v", got)
	}
}

func TestPauseAndResume(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	paused, err := h.svc.Pause(created.ID)
	if err != nil || paused.Status != "paused" || paused.NextRunAt != nil || paused.PausedAt == nil {
		t.Fatalf("pause: %+v %v", paused, err)
	}
	h.svc.Tick()
	h.waitIdle(t)
	if h.runCount() != 0 {
		t.Fatal("a paused schedule fired")
	}
	resumed, err := h.svc.Resume(created.ID)
	if err != nil || resumed.Status != "active" || *resumed.NextRunAt != isoTime(h.clock.Now().Add(time.Minute)) {
		t.Fatalf("resume: %+v %v", resumed, err)
	}
	if again, err := h.svc.Resume(created.ID); err != nil || again.UpdatedAt != resumed.UpdatedAt {
		t.Fatalf("resuming an active schedule is a no-op: %v", err)
	}

	completed := mustCreate(t, h, CreateInput{Cadence: every(60_000), MaxRuns: intPtr(1)})
	h.svc.Tick()
	h.waitIdle(t)
	if _, err := h.svc.Pause(completed.ID); err == nil || !strings.Contains(err.Error(), "already completed") {
		t.Fatalf("pause completed: %v", err)
	}
	if _, err := h.svc.Resume(completed.ID); err == nil || !strings.Contains(err.Error(), "already completed") {
		t.Fatalf("resume completed: %v", err)
	}
	if _, err := h.svc.Pause("nope"); err == nil || err.Error() != "Schedule not found: nope" {
		t.Fatalf("pause missing: %v", err)
	}
}

// Update patches: an absent field stays, a null clears, and a new-agent config patch applies only
// to a new-agent schedule.
func TestUpdatePatches(t *testing.T) {
	h := newHarness(t)
	name := "nightly"
	expires := "2027-01-01T00:00:00.000Z"
	created := mustCreate(t, h, CreateInput{
		Name: &name, Cadence: cron("0 9 * * *"), MaxRuns: intPtr(3), ExpiresAt: &expires,
		Target: Target{Type: "new-agent", Config: &TargetConfig{Provider: "mock", Cwd: "/tmp/p", Model: "m1", ModeID: "plan"}},
	})

	model := "  m2  "
	updated, err := h.svc.Update(UpdateInput{
		ID:        created.ID,
		Name:      Present[string](nil),
		MaxRuns:   Present[int](nil),
		ExpiresAt: Present[string](nil),
		NewAgentConfig: &NewAgentConfigPatch{
			Model:           Present(&model),
			ModeID:          Present[string](nil),
			ArchiveOnFinish: boolPtr(false),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != nil || updated.MaxRuns != nil || updated.ExpiresAt != nil {
		t.Fatalf("nulls did not clear: %+v", updated)
	}
	config := updated.Target.Config
	if config.Model != "m2" || config.ModeID != "" || config.ArchiveOnFinish == nil || *config.ArchiveOnFinish || config.Provider != "mock" {
		t.Fatalf("config patch: %+v", config)
	}
	if updated.Prompt != created.Prompt || updated.Cadence != created.Cadence || *updated.NextRunAt != *created.NextRunAt {
		t.Fatal("absent fields changed")
	}

	// A new cadence on an active schedule recomputes the next run, keeping the time zone it had.
	zoned := mustCreate(t, h, CreateInput{Cadence: Cadence{Type: "cron", Expression: "0 9 * * *", Timezone: "Asia/Hong_Kong"}})
	recadenced, err := h.svc.Update(UpdateInput{ID: zoned.ID, Cadence: &Cadence{Type: "cron", Expression: "0 10 * * *"}})
	if err != nil {
		t.Fatal(err)
	}
	if recadenced.Cadence.Timezone != "Asia/Hong_Kong" || *recadenced.NextRunAt != "2026-11-03T02:00:00.000Z" {
		t.Fatalf("cadence update: %+v next %s", recadenced.Cadence, *recadenced.NextRunAt)
	}

	empty := ""
	heartbeat := mustCreate(t, h, CreateInput{Cadence: every(60_000), Target: Target{Type: "agent", AgentID: "11111111-1111-4111-8111-111111111111"}})
	for _, bad := range []UpdateInput{
		{ID: heartbeat.ID, NewAgentConfig: &NewAgentConfigPatch{Model: Present(&model)}},
		{ID: created.ID, NewAgentConfig: &NewAgentConfigPatch{Provider: &empty}},
		{ID: created.ID, NewAgentConfig: &NewAgentConfigPatch{Cwd: &empty}},
		{ID: created.ID, Prompt: &empty},
		{ID: created.ID, MaxRuns: Present(intPtr(-1))},
		{ID: created.ID, Cadence: &Cadence{Type: "cron", Expression: "bad"}},
	} {
		if _, err := h.svc.Update(bad); err == nil {
			t.Fatalf("update %+v should fail", bad)
		}
	}
}

// A run records its workspace and agent while it is still running.
func TestRunRecordsItsWorkspace(t *testing.T) {
	h := newHarness(t)
	var during *StoredSchedule
	created := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	agent := "22222222-2222-4222-8222-222222222222"
	h.execute = func(_ context.Context, sched StoredSchedule, run RunHandle) (ExecutionResult, error) {
		run.RecordWorkspace("wks_run", nil)
		run.RecordWorkspace("wks_run", &agent)
		during, _ = h.svc.Inspect(sched.ID)
		return ExecutionResult{AgentID: &agent}, nil
	}
	got, err := h.svc.RunOnce(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := during.Runs[0]
	if run.Status != "running" || run.WorkspaceID == nil || *run.WorkspaceID != "wks_run" || run.AgentID == nil || *run.AgentID != agent {
		t.Fatalf("run while running: %+v", run)
	}
	if *got.Runs[0].WorkspaceID != "wks_run" || *got.Runs[0].AgentID != agent {
		t.Fatalf("finished run: %+v", got.Runs[0])
	}
}

// A daemon restart fails the run it cut off, archives the workspace that run was using, and skips
// the slots it missed rather than firing them all.
func TestStartRecoversInterruptedRuns(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h, CreateInput{Cadence: cron("0 * * * *")})
	agent := "33333333-3333-4333-8333-333333333333"
	workspace := "wks_interrupted"
	started := "2026-11-02T08:00:00.000Z"
	overdue := "2026-11-02T08:00:00.000Z"
	if _, err := h.svc.update(created.ID, func(sched StoredSchedule) (StoredSchedule, bool, error) {
		sched.Runs = []Run{{ID: "run-1", ScheduledFor: started, StartedAt: started, Status: "running", AgentID: &agent, WorkspaceID: &workspace}}
		sched.NextRunAt = &overdue
		return sched, true, nil
	}); err != nil {
		t.Fatal(err)
	}

	h.svc.Start()
	defer h.svc.Stop()

	got, _ := h.svc.Inspect(created.ID)
	run := got.Runs[0]
	if run.Status != "failed" || run.Error == nil || *run.Error != "Daemon restarted before the scheduled run completed" || run.EndedAt == nil {
		t.Fatalf("interrupted run: %+v", run)
	}
	if *got.NextRunAt != "2026-11-02T11:00:00.000Z" {
		t.Fatalf("next run after recovery = %s, want the next slot after now", *got.NextRunAt)
	}
	if len(h.archived) != 1 || h.archived[0] != workspace {
		t.Fatalf("archived = %v", h.archived)
	}
}

// A heartbeat whose agent is gone or archived completes at startup, and when its agent is archived.
func TestHeartbeatsEndWithTheirAgent(t *testing.T) {
	h := newHarness(t)
	alive := "44444444-4444-4444-8444-444444444444"
	dead := "55555555-5555-4555-8555-555555555555"
	h.live[alive] = true
	aliveBeat := mustCreate(t, h, CreateInput{Cadence: every(60_000), Target: Target{Type: "agent", AgentID: alive}})
	deadBeat := mustCreate(t, h, CreateInput{Cadence: every(60_000), Target: Target{Type: "agent", AgentID: dead}})

	h.svc.Start()
	defer h.svc.Stop()
	if got, _ := h.svc.Inspect(deadBeat.ID); got.Status != "completed" {
		t.Fatalf("orphaned heartbeat status = %s", got.Status)
	}
	if got, _ := h.svc.Inspect(aliveBeat.ID); got.Status != "active" {
		t.Fatalf("live heartbeat status = %s", got.Status)
	}

	count, err := h.svc.CompleteForAgent(alive)
	if err != nil || count != 1 {
		t.Fatalf("CompleteForAgent = %d, %v", count, err)
	}
	if got, _ := h.svc.Inspect(aliveBeat.ID); got.Status != "completed" || got.NextRunAt != nil {
		t.Fatalf("heartbeat after its agent was archived: %+v", got)
	}
}

// Lists and logs read oldest first, and a schedule file that does not parse does not hide the rest.
func TestListAndLogsOrder(t *testing.T) {
	h := newHarness(t)
	first := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	h.clock.Set(h.clock.Now().Add(time.Second))
	second := mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	if err := os.WriteFile(filepath.Join(h.svc.baseDir, "broken.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	all, err := h.svc.List()
	if err != nil || len(all) != 2 || all[0].ID != first.ID || all[1].ID != second.ID {
		t.Fatalf("list = %v, %v", all, err)
	}

	_, _ = h.svc.RunOnce(context.Background(), first.ID)
	h.clock.Set(h.clock.Now().Add(time.Minute))
	_, _ = h.svc.RunOnce(context.Background(), first.ID)
	runs, _ := h.svc.Logs(first.ID)
	if len(runs) != 2 || runs[0].StartedAt > runs[1].StartedAt {
		t.Fatalf("logs = %+v", runs)
	}
	if err := h.svc.Delete(first.ID); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.Delete(first.ID); err != nil {
		t.Fatal("deleting a missing schedule is not an error")
	}
}

// Stop ends the clock.
func TestStartTicksUntilStopped(t *testing.T) {
	h := newHarness(t)
	h.svc.Start()
	mustCreate(t, h, CreateInput{Cadence: every(60_000)})
	deadline := time.Now().Add(3 * time.Second)
	for h.runCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if h.runCount() != 1 {
		t.Fatalf("the clock did not fire the due schedule: %d", h.runCount())
	}
	h.svc.Stop()
	h.waitIdle(t)
	h.clock.Set(h.clock.Now().Add(time.Hour))
	time.Sleep(1500 * time.Millisecond)
	if h.runCount() != 1 {
		t.Fatalf("the clock kept firing after Stop: %d", h.runCount())
	}
}
