package attention

import (
	"testing"
	"time"
)

var now = time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)

func ago(d time.Duration) *time.Time {
	t := now.Add(-d)
	return &t
}

// Notifying the client that is currently showing the agent is pure noise.
func TestFocusedVisibleClientSuppressesEverything(t *testing.T) {
	plan := ComputePlan([]ClientPresence{
		{AppVisible: true, LastActivityAt: ago(5 * time.Second), FocusedAgentID: "a1"},
	}, &FocusTarget{Kind: "agent", ID: "a1"}, true, now)

	if plan.InAppRecipient != -1 || plan.ShouldPush {
		t.Fatalf("expected full suppression, got %+v", plan)
	}
}

// A visible client looking at a *different* agent does not suppress.
func TestDifferentFocusDoesNotSuppress(t *testing.T) {
	plan := ComputePlan([]ClientPresence{
		{AppVisible: true, LastActivityAt: ago(5 * time.Second), FocusedAgentID: "other"},
	}, &FocusTarget{Kind: "agent", ID: "a1"}, true, now)

	if plan.InAppRecipient != 0 {
		t.Fatalf("expected the in-app notice on client 0, got %+v", plan)
	}
	if plan.ShouldPush {
		t.Fatal("a present client should get the in-app notice instead of a push")
	}
}

// The most recently active present client is the one that gets the notice: it is the device the
// user just touched.
func TestMostRecentPresentClientWins(t *testing.T) {
	plan := ComputePlan([]ClientPresence{
		{LastActivityAt: ago(120 * time.Second)},
		{LastActivityAt: ago(10 * time.Second)},
		{LastActivityAt: ago(60 * time.Second)},
	}, nil, true, now)

	if plan.InAppRecipient != 1 {
		t.Fatalf("expected client 1, got %+v", plan)
	}
}

// Nobody present (or everybody stale) leaves push as the only channel.
func TestNobodyPresentPushes(t *testing.T) {
	plan := ComputePlan([]ClientPresence{
		{LastActivityAt: ago(10 * time.Minute)},
		{LastActivityAt: nil},
	}, nil, true, now)

	if plan.InAppRecipient != -1 || !plan.ShouldPush {
		t.Fatalf("expected push only, got %+v", plan)
	}

	// A push that is not eligible stays silent.
	plan = ComputePlan(nil, nil, false, now)
	if plan.InAppRecipient != -1 || plan.ShouldPush {
		t.Fatalf("expected silence, got %+v", plan)
	}
}

// The threshold is inclusive: exactly three minutes still counts as present.
func TestPresenceThresholdBoundary(t *testing.T) {
	plan := ComputePlan([]ClientPresence{
		{LastActivityAt: ago(PresenceThreshold)},
	}, nil, true, now)
	if plan.InAppRecipient != 0 || plan.ShouldPush {
		t.Fatalf("at the boundary the client is present: %+v", plan)
	}

	plan = ComputePlan([]ClientPresence{
		{LastActivityAt: ago(PresenceThreshold + time.Second)},
	}, nil, true, now)
	if !plan.ShouldPush {
		t.Fatalf("past the boundary the client is absent: %+v", plan)
	}
}

// A client whose clock runs ahead of the daemon must not become permanently present.
func TestFutureClockIsClamped(t *testing.T) {
	future := now.Add(time.Hour)
	plan := ComputePlan([]ClientPresence{
		{LastActivityAt: &future},
	}, nil, true, now)
	if plan.InAppRecipient != 0 || plan.ShouldPush {
		t.Fatalf("expected a clamped, present client: %+v", plan)
	}
}

// Errors do not push: a failing provider would push on every retry.
func TestIsPushEligibleReason(t *testing.T) {
	if IsPushEligibleReason("error") {
		t.Fatal("error must not be push-eligible")
	}
	for _, reason := range []string{"waiting_input", "finished", ""} {
		if !IsPushEligibleReason(reason) {
			t.Fatalf("%q should be push-eligible", reason)
		}
	}
}
