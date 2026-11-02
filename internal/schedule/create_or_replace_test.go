package schedule

import (
	"context"
	"testing"
)

// A model re-running "set up a nightly check" must not accumulate one schedule per call.
func TestCreateOrReplaceUpdatesInPlace(t *testing.T) {
	h := newHarness(t)
	name := "nightly"

	first, err := h.svc.CreateOrReplace(CreateInput{
		Name: &name, Prompt: "check the build", Cadence: every(60000), Target: newAgentTarget(), MaxRuns: intPtr(5),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Pause(first.ID); err != nil {
		t.Fatal(err)
	}

	second, err := h.svc.CreateOrReplace(CreateInput{
		Name: &name, Prompt: "check the build and the tests", Cadence: every(120000), Target: newAgentTarget(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("a same-name same-target call created a second schedule: %q vs %q", second.ID, first.ID)
	}
	// The replacement is the new definition in full: active again, and limits it does not state are
	// cleared rather than inherited.
	if second.Prompt != "check the build and the tests" || second.Cadence.EveryMs != 120000 ||
		second.Status != "active" || second.PausedAt != nil || second.MaxRuns != nil {
		t.Fatalf("replaced schedule: %+v", second)
	}
	all, _ := h.svc.List()
	if len(all) != 1 {
		t.Fatalf("%d schedules for one name", len(all))
	}
}

// The identity is the name plus the whole target: another agent, or a new agent configured
// differently, is different work.
func TestCreateOrReplaceKeepsDifferentTargets(t *testing.T) {
	h := newHarness(t)
	name := "nightly"
	targets := []Target{
		{Type: "agent", AgentID: "66666666-6666-4666-8666-666666666666"},
		{Type: "agent", AgentID: "77777777-7777-4777-8777-777777777777"},
		{Type: "new-agent", Config: &TargetConfig{Provider: "mock", Cwd: "/tmp/a"}},
		{Type: "new-agent", Config: &TargetConfig{Provider: "claude", Cwd: "/tmp/a"}},
	}
	for _, target := range targets {
		if _, err := h.svc.CreateOrReplace(CreateInput{Name: &name, Prompt: "p", Cadence: every(60000), Target: target}); err != nil {
			t.Fatal(err)
		}
	}
	all, _ := h.svc.List()
	if len(all) != len(targets) {
		t.Fatalf("expected %d schedules, got %d", len(targets), len(all))
	}
}

// An unnamed schedule has no identity to match on, so each call is a new one.
func TestCreateOrReplaceWithNoNameAlwaysCreates(t *testing.T) {
	h := newHarness(t)
	for i := 0; i < 2; i++ {
		if _, err := h.svc.CreateOrReplace(CreateInput{Prompt: "p", Cadence: every(60000), Target: newAgentTarget()}); err != nil {
			t.Fatal(err)
		}
	}
	all, _ := h.svc.List()
	if len(all) != 2 {
		t.Fatalf("expected two unnamed schedules, got %d", len(all))
	}
}

// A completed schedule is finished business: a repeat call starts a fresh one.
func TestCreateOrReplaceAfterCompletionCreatesNew(t *testing.T) {
	h := newHarness(t)
	name := "once"
	first, err := h.svc.CreateOrReplace(CreateInput{Name: &name, Prompt: "p", Cadence: every(60000), Target: newAgentTarget(), MaxRuns: intPtr(1)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.RunOnce(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	h.svc.Tick()
	h.waitIdle(t)
	if got, _ := h.svc.Inspect(first.ID); got.Status != "completed" {
		t.Fatalf("status = %s", got.Status)
	}

	second, err := h.svc.CreateOrReplace(CreateInput{Name: &name, Prompt: "p2", Cadence: every(60000), Target: newAgentTarget()})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.Status != "active" {
		t.Fatalf("second = %+v", second)
	}
}
