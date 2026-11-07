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
		if decision.Reason != "" || decision.State.Requests != (i+1)*MeterCost {
			t.Fatalf("meter decision %d = %+v", i, decision)
		}
		state = decision.State
	}
	decision := state.Take(now, MeterCost, 8)
	if decision.Reason == "" || decision.State.Requests != 10 {
		t.Fatalf("the threshold must be observable without rejecting traffic: %+v", decision)
	}
	decision = decision.State.Take(now.Add(24*time.Hour), MeterCost, 8)
	if decision.Reason != "" || decision.State.Requests != MeterCost {
		t.Fatalf("UTC reset = %+v", decision)
	}
}
