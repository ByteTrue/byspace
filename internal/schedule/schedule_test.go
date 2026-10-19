package schedule

import (
	"context"
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
