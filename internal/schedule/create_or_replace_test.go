package schedule

import (
	"context"
	"testing"
)

// A model re-running "set up a nightly check" must not accumulate one schedule per call — the
// user asked for one schedule and would get a dozen, all firing.
func TestCreateOrReplaceUpdatesInPlace(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	name := "nightly"

	first, err := svc.CreateOrReplace(context.Background(), CreateInput{
		Name:    &name,
		Prompt:  "check the build",
		Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target:  Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp/a"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	second, err := svc.CreateOrReplace(context.Background(), CreateInput{
		Name:    &name,
		Prompt:  "check the build and the tests",
		Cadence: Cadence{Type: "every", EveryMs: 120000},
		Target:  Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp/a"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if second.ID != first.ID {
		t.Fatalf("a same-name same-target call created a second schedule: %q vs %q", second.ID, first.ID)
	}
	if second.Prompt != "check the build and the tests" {
		t.Fatalf("prompt not updated: %q", second.Prompt)
	}
	if second.Cadence.EveryMs != 120000 {
		t.Fatalf("cadence not updated: %d", second.Cadence.EveryMs)
	}

	all, err := svc.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("%d schedules for one name", len(all))
	}
}

// "nightly check" against agent A and against agent B are different work.
func TestCreateOrReplaceKeepsDifferentTargets(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	name := "nightly"

	_, err := svc.CreateOrReplace(context.Background(), CreateInput{
		Name: &name, Prompt: "p", Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target: Target{Type: "agent", AgentID: "agt_a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreateOrReplace(context.Background(), CreateInput{
		Name: &name, Prompt: "p", Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target: Target{Type: "agent", AgentID: "agt_b"},
	})
	if err != nil {
		t.Fatal(err)
	}

	all, _ := svc.List()
	if len(all) != 2 {
		t.Fatalf("two targets should stay separate, got %d", len(all))
	}
}

// An unnamed schedule has no identity to match on, so each call is a new one.
func TestCreateOrReplaceWithNoNameAlwaysCreates(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	for i := 0; i < 2; i++ {
		if _, err := svc.CreateOrReplace(context.Background(), CreateInput{
			Prompt: "p", Cadence: Cadence{Type: "every", EveryMs: 60000},
			Target: Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp/x"}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	all, _ := svc.List()
	if len(all) != 2 {
		t.Fatalf("expected two unnamed schedules, got %d", len(all))
	}
}

// A completed schedule is finished business; the caller wants a fresh one rather than a revived
// series whose run count is already spent.
func TestCreateOrReplaceAfterCompletionCreatesNew(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	name := "once"
	maxRuns := 1

	first, err := svc.CreateOrReplace(context.Background(), CreateInput{
		Name: &name, Prompt: "p", Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target: Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp/c"}}, MaxRuns: &maxRuns,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RunOnce(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}

	second, err := svc.CreateOrReplace(context.Background(), CreateInput{
		Name: &name, Prompt: "p2", Cadence: Cadence{Type: "every", EveryMs: 60000},
		Target: Target{Type: "new-agent", Config: &TargetConfig{Cwd: "/tmp/c"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("a completed schedule should not be revived")
	}
	if second.Status != "active" {
		t.Fatalf("new schedule status = %q", second.Status)
	}
}
