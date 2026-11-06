package relay

import (
	"testing"
	"time"
)

func TestMeterSharesOneUTCBudgetAcrossRoomsAndIncludesMeterCalls(t *testing.T) {
	now := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	state := MeterState{}
	for i := int64(0); i < 4; i++ {
		decision := state.Take(now, MeterCost, 8)
		if !decision.Allow || decision.State.Requests != (i+1)*MeterCost {
			t.Fatalf("meter decision %d = %+v", i, decision)
		}
		state = decision.State
	}
	decision := state.Take(now, MeterCost, 8)
	if decision.Allow || decision.State.Requests != 10 {
		t.Fatalf("the rejected meter invocation must be counted: %+v", decision)
	}
	decision = decision.State.Take(now.Add(24*time.Hour), MeterCost, 8)
	if !decision.Allow || decision.State.Requests != MeterCost {
		t.Fatalf("UTC reset = %+v", decision)
	}
}

func TestBudgetSurvivesHibernationAndRefillsByElapsedTime(t *testing.T) {
	now := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	limits := BudgetLimits{FramesPerSecond: 10, Burst: 2}
	state := RateState{}
	for i := 0; i < 2; i++ {
		decision := state.TakeFrame(now, "server:one", limits)
		if !decision.Allow {
			t.Fatalf("burst frame %d rejected: %+v", i, decision)
		}
		state = decision.State
	}
	decision := state.TakeFrame(now, "server:one", limits)
	if decision.Allow || len(decision.State.Bursts) != 1 {
		t.Fatalf("burst should reject the third frame: %+v", decision)
	}
	// A fresh room starts from the stored snapshot, not a newly full in-memory bucket.
	var restored RateState = decision.State
	decision = restored.TakeFrame(now.Add(50*time.Millisecond), "server:one", limits)
	if decision.Allow {
		t.Fatal("hibernation refilled the rate bucket")
	}
	decision = decision.State.TakeFrame(now.Add(150*time.Millisecond), "server:one", limits)
	if !decision.Allow {
		t.Fatalf("elapsed time did not refill one token: %+v", decision)
	}
}

func TestRateReleaseCannotLoseAnotherConnection(t *testing.T) {
	state := RateState{}.TakeFrame(time.Now(), "server:one", DefaultBudgetLimits).State
	state = state.TakeFrame(time.Now(), "client:two", DefaultBudgetLimits).State
	state = state.ReleaseConnection("server:one")
	if _, ok := state.Bursts["server:one"]; ok {
		t.Fatal("closed connection retained a bucket")
	}
	if _, ok := state.Bursts["client:two"]; !ok {
		t.Fatal("closing one connection removed another connection's bucket")
	}
}

func TestBudgetNormalStreamHasHeadroom(t *testing.T) {
	now := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	state := RateState{}
	// 16.7 frames/sec/agent, four simultaneous agents sharing one daemon socket.
	for i := 0; i < 4*20; i++ {
		decision := state.TakeFrame(now, "server:one", DefaultBudgetLimits)
		if !decision.Allow {
			t.Fatalf("normal stream rejected at frame %d: %+v", i, decision)
		}
		state = decision.State
		now = now.Add(15 * time.Millisecond)
	}
}
