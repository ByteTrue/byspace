package relay

import "time"

// BudgetLimits is a hosted relay's observation threshold. DailyRequests includes the request to the
// global meter itself: a room message followed by a meter fetch costs two DO requests, not one.
type BudgetLimits struct {
	DailyRequests int64
}

var DefaultBudgetLimits = BudgetLimits{DailyRequests: 80_000}

// MeterCost is the billable number of DO invocations for a room trigger and its global-meter fetch.
const MeterCost int64 = 2

// BudgetDay is the UTC day in which a budget snapshot applies. Cloudflare resets its daily request
// allowance at the same boundary.
func BudgetDay(now time.Time) string {
	return now.UTC().Format("2006-01-02")
}

// MeterState is the one shared daily counter for a Worker namespace. All server ids and both
// protocol-version rooms use it. Beta and production are different Worker namespaces, and unrelated
// DO consumers remain outside its view.
type MeterState struct {
	Day      string `json:"day"`
	Requests int64  `json:"requests"`
}

type MeterDecision struct {
	State  MeterState
	Reason string
}

// Take records billable requests, including the meter invocation itself. The threshold reports
// overuse; it never rejects traffic because valid streams have no fixed rate ceiling and cutting
// a relay socket destroys in-flight responses.
func (s MeterState) Take(now time.Time, cost, dailyLimit int64) MeterDecision {
	if s.Day != BudgetDay(now) {
		s = MeterState{Day: BudgetDay(now)}
	}
	s.Requests += cost
	decision := MeterDecision{State: s}
	if dailyLimit > 0 && s.Requests > dailyLimit {
		decision.Reason = "relay daily request observation threshold exceeded"
	}
	return decision
}
