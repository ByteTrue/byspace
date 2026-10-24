// Package attention decides whether an agent's attention request should notify anyone.
//
// Ported from agent-attention-policy.ts. The rule exists because a phone and a laptop are usually
// both connected: notifying the laptop about an agent whose output the user is currently reading
// is noise, and pushing to a phone that is already looking at the same agent interrupts for no
// reason.
package attention

import (
	"time"
)

// PresenceThreshold is how recently a client must have acted to count as present.
//
// Three minutes: long enough that reading a long message does not make the user "absent", short
// enough that a phone left on a desk overnight does not suppress every notification.
const PresenceThreshold = 3 * time.Minute

// ClientPresence is what one connected client reports about itself.
type ClientPresence struct {
	AppVisible        bool
	LastActivityAt    *time.Time
	FocusedAgentID    string
	FocusedTerminalID string
}

// FocusTarget is what a client is looking at.
type FocusTarget struct {
	Kind string // "agent" | "terminal" | ""
	ID   string
}

// Plan is the decision.
type Plan struct {
	// InAppRecipient is the index of the client that should show the in-app notice, or -1.
	InAppRecipient int
	// ShouldPush is whether a Web Push notification should be sent.
	ShouldPush bool
}

// ComputePlan decides who to notify.
//
// A present, app-visible client focused on the target suppresses everything: the user is looking
// at the thing that wants attention. Otherwise the most recently active present client gets the
// in-app notice; if nobody is present, the push is the only channel left.
func ComputePlan(states []ClientPresence, focus *FocusTarget, pushEligible bool, now time.Time) Plan {
	mostRecentIndex := -1
	mostRecentAt := time.Time{}

	for i, state := range states {
		activity := state.LastActivityAt
		if activity != nil && activity.After(now) {
			// A client clock ahead of the daemon must not make it permanently present.
			clamped := now
			activity = &clamped
		}

		present := activity != nil && now.Sub(*activity) <= PresenceThreshold
		if !present {
			continue
		}

		if state.AppVisible && focusedOn(state, focus) {
			return Plan{InAppRecipient: -1, ShouldPush: false}
		}

		if activity != nil && activity.After(mostRecentAt) {
			mostRecentIndex = i
			mostRecentAt = *activity
		}
	}

	if mostRecentIndex >= 0 {
		return Plan{InAppRecipient: mostRecentIndex, ShouldPush: false}
	}
	return Plan{InAppRecipient: -1, ShouldPush: pushEligible}
}

func focusedOn(state ClientPresence, target *FocusTarget) bool {
	if target == nil || target.ID == "" {
		return false
	}
	switch target.Kind {
	case "agent":
		return state.FocusedAgentID == target.ID
	case "terminal":
		return state.FocusedTerminalID == target.ID
	default:
		return false
	}
}

// IsPushEligibleReason reports whether an attention reason may produce a push.
//
// Errors are excluded: a failing provider would otherwise push on every retry, and the failure
// is already visible in the app the moment the user opens it.
func IsPushEligibleReason(reason string) bool {
	return reason != "error"
}
