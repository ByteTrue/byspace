package schedule

import (
	"context"
	"errors"
	"testing"
)

func TestScheduleCreatePauseResumeRunOnceAndMaxRuns(t *testing.T) {
	tmp := t.TempDir()
	ranCount := 0
	svc := NewService(tmp, func(_ context.Context, sched StoredSchedule) (ExecutionResult, error) {
		ranCount++
		agt := "agt_sched_1"
		out := "Executed: " + sched.Prompt
		return ExecutionResult{
			AgentID: &agt,
			Output:  &out,
		}, nil
	})

	ctx := context.Background()
	name := "Nightly Check"
	maxRuns := 1
	created, err := svc.Create(ctx, CreateInput{
		Name:   &name,
		Prompt: "Run checks",
		Cadence: Cadence{
			Type:    "every",
			EveryMs: 60_000,
		},
		Target: Target{
			Type:    "agent",
			AgentID: "agt_target_1",
		},
		MaxRuns: &maxRuns,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != "active" || created.NextRunAt == nil {
		t.Fatalf("unexpected initial schedule: %+v", created)
	}

	paused, err := svc.Pause(created.ID)
	if err != nil || paused.Status != "paused" || paused.NextRunAt != nil {
		t.Fatalf("unexpected paused state: %+v (%v)", paused, err)
	}

	resumed, err := svc.Resume(created.ID)
	if err != nil || resumed.Status != "active" || resumed.NextRunAt == nil {
		t.Fatalf("unexpected resumed state: %+v (%v)", resumed, err)
	}

	afterRun, err := svc.RunOnce(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ranCount != 1 || len(afterRun.Runs) != 1 || afterRun.Runs[0].Status != "succeeded" {
		t.Fatalf("unexpected run state: %+v", afterRun)
	}
	// Since maxRuns == 1, status should transition to "completed"
	if afterRun.Status != "completed" || afterRun.NextRunAt != nil {
		t.Fatalf("expected completed schedule after reaching maxRuns, got %+v", afterRun)
	}
}

// A target that no longer exists is permanent: retrying burns the schedule's budget until it
// expires, and every run fails the same way. Completion says what happened; failing forever does
// not.
func TestTargetGoneCompletesSchedule(t *testing.T) {
	dir := t.TempDir()
	svc := NewService(dir, func(ctx context.Context, sched StoredSchedule) (ExecutionResult, error) {
		return ExecutionResult{}, TargetGoneError{Reason: "agent agt_x was deleted"}
	})

	created, err := svc.Create(context.Background(), CreateInput{
		Prompt:  "check things",
		Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target:  Target{Type: "agent", AgentID: "agt_x"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != "active" {
		t.Fatalf("status = %q", created.Status)
	}

	updated, err := svc.RunOnce(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "completed" {
		t.Fatalf("a gone target must complete the schedule, got %q", updated.Status)
	}
	if updated.NextRunAt != nil {
		t.Fatal("a completed schedule must have no next run")
	}
	if len(updated.Runs) != 1 || updated.Runs[0].Status != "failed" {
		t.Fatalf("the run should still be recorded as failed: %+v", updated.Runs)
	}
}

// An ordinary failure stays active: a transient provider error must not kill the schedule.
func TestOrdinaryFailureKeepsScheduleActive(t *testing.T) {
	dir := t.TempDir()
	svc := NewService(dir, func(ctx context.Context, sched StoredSchedule) (ExecutionResult, error) {
		return ExecutionResult{}, errors.New("provider timed out")
	})

	created, err := svc.Create(context.Background(), CreateInput{
		Prompt:  "check things",
		Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target:  Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.RunOnce(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "active" {
		t.Fatalf("a transient failure must not complete the schedule, got %q", updated.Status)
	}
	if updated.NextRunAt == nil {
		t.Fatal("an active schedule needs a next run time")
	}
}
