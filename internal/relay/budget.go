package relay

import (
	"fmt"
	"math"
	"time"
)

// BudgetLimits is a hosted relay's cost protection. DailyRequests includes the request to the
// global meter itself: a room message followed by a meter fetch costs two DO requests, not one.
type BudgetLimits struct {
	DailyRequests   int64
	FramesPerSecond float64
	Burst           float64
}

var DefaultBudgetLimits = BudgetLimits{
	DailyRequests:   80_000,
	FramesPerSecond: 40,
	Burst:           120,
}

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
	Allow  bool
	Reason string
}

// Take requests cost billable requests, including the meter invocation and rejected triggers. Only
// a successful transaction can change the stored counter; a failed storage call fails closed.
func (s MeterState) Take(now time.Time, cost, dailyLimit int64) MeterDecision {
	if s.Day != BudgetDay(now) {
		s = MeterState{Day: BudgetDay(now)}
	}
	s.Requests += cost
	if dailyLimit > 0 && s.Requests > dailyLimit {
		return MeterDecision{State: s, Reason: "relay daily request budget exhausted; retry after 00:00 UTC"}
	}
	return MeterDecision{State: s, Allow: true}
}

// RateState is one room's durable token bucket. Bursts survive hibernation too: an in-memory token
// bucket would refill every time the runtime evicted the room.
type RateState struct {
	Bursts    map[string]float64 `json:"bursts,omitempty"`
	LastFrame map[string]int64   `json:"lastFrame,omitempty"`
}

type RateDecision struct {
	State  RateState
	Allow  bool
	Reason string
}

// TakeFrame accounts only for rate; the global daily cost is charged separately by MeterState.Take.
func (s RateState) TakeFrame(now time.Time, connectionKey string, limits BudgetLimits) RateDecision {
	if s.Bursts == nil {
		s.Bursts = map[string]float64{}
	}
	if s.LastFrame == nil {
		s.LastFrame = map[string]int64{}
	}
	if connectionKey == "" || limits.FramesPerSecond <= 0 || limits.Burst <= 0 {
		return RateDecision{State: s, Allow: true}
	}
	last := s.LastFrame[connectionKey]
	nowMillis := now.UnixMilli()
	available := limits.Burst
	if previous, ok := s.Bursts[connectionKey]; ok && last > 0 && nowMillis >= last {
		available = math.Min(limits.Burst, previous+float64(nowMillis-last)*limits.FramesPerSecond/1000)
	}
	s.Bursts[connectionKey] = available
	s.LastFrame[connectionKey] = nowMillis
	if available < 1 {
		return RateDecision{State: s, Reason: "frame rate exceeded; back off before reconnecting"}
	}
	s.Bursts[connectionKey] = available - 1
	return RateDecision{State: s, Allow: true}
}

// ReleaseConnection removes the socket's rate state, bounding the durable map to live connections.
func (s RateState) ReleaseConnection(connectionKey string) RateState {
	delete(s.Bursts, connectionKey)
	delete(s.LastFrame, connectionKey)
	return s
}

// BudgetConnectionKey separates the daemon and app halves of a multiplexed connection.
func BudgetConnectionKey(conn Connection) string {
	if conn.ConnectionID() == "" {
		return fmt.Sprintf("%s:%s", conn.Role(), conn.Version())
	}
	return conn.Role() + ":" + conn.ConnectionID()
}
