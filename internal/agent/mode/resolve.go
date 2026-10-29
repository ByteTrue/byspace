// Package agentmode decides which mode a new agent starts in.
//
// Ported from create-agent-mode.ts. A mode is a provider-specific permission posture (plan, accept
// edits, unattended), and the mode ids are not portable: `acceptEdits` means nothing to a provider
// that calls it `auto`. So a mode cannot simply be copied from a parent agent to a child, and getting
// this wrong hands a child a mode its provider does not recognise — it then runs with the provider's
// default, silently not the posture the caller asked for.
package agentmode

import (
	"errors"
	"fmt"
	"strings"
)

// Parent describes the agent a child is being created from.
type Parent struct {
	Provider string
	// ModeID is the parent's mode, nil when it has none recorded.
	ModeID *string
	// Unattended mirrors AgentMode.isUnattended for the parent's mode.
	Unattended bool
}

// Input is what the create request carries plus what is known about the target provider.
type Input struct {
	// Requested is the mode the client asked for, nil when it did not ask.
	Requested *string
	// Provider is the target provider.
	Provider string
	// Parent is the creating agent, nil when a user is creating this one.
	Parent *Parent
	// Unattended is the create request's unattended flag.
	Unattended bool
	// AvailableModes are the target provider's mode ids.
	//
	// Nil means unknown: an explicit mode passes through unvalidated, but cross-provider
	// inheritance is still refused, because "unknown" cannot be checked and a wrong mode is worse
	// than a refusal. An empty non-nil slice means the provider has no modes at all, which is a
	// different answer — use the provider's default behaviour.
	AvailableModes []string
	// TargetUnattendedMode is the target provider's own unattended mode, when it has one. It bridges
	// an unattended parent into an unattended child across providers.
	TargetUnattendedMode *string
}

// ErrModeNotInheritable reports a mode that cannot be carried across providers.
var ErrModeNotInheritable = errors.New("mode cannot be inherited across providers")

// Resolve returns the mode a new agent should start in, or nil for the provider's default.
func Resolve(in Input) (*string, error) {
	if in.Requested != nil {
		if in.AvailableModes != nil && !contains(in.AvailableModes, *in.Requested) {
			return nil, fmt.Errorf("Invalid mode '%s' for provider '%s'. Available modes: %s",
				*in.Requested, in.Provider, listModes(in.AvailableModes))
		}
		return in.Requested, nil
	}

	if in.Parent == nil {
		if in.Unattended && in.TargetUnattendedMode != nil {
			return in.TargetUnattendedMode, nil
		}
		return nil, nil
	}

	// Same provider: the parent's mode id means the same thing, so it carries over.
	if in.Parent.Provider == in.Provider {
		return in.Parent.ModeID, nil
	}

	// Different provider, but both sides are unattended and the target has an unattended mode:
	// bridge to it. The caller's intent (run without asking) survives even though the id does not.
	if (in.Unattended || in.Parent.Unattended) && in.TargetUnattendedMode != nil {
		return in.TargetUnattendedMode, nil
	}

	// The target explicitly has no modes, so there is nothing to inherit and nothing to inherit
	// into. Its default behaviour is the right answer.
	if in.AvailableModes != nil && len(in.AvailableModes) == 0 {
		return nil, nil
	}

	// Anything else would hand the child a mode its provider does not know. Refusing is the honest
	// outcome: the caller can pass an explicit mode.
	return nil, fmt.Errorf(
		"%w: cannot inherit mode '%s' from caller (provider '%s') for new agent (provider '%s'). "+
			"Pass an explicit mode. Available modes for '%s': %s",
		ErrModeNotInheritable, formatMode(in.Parent.ModeID), in.Parent.Provider, in.Provider,
		in.Provider, listModes(in.AvailableModes))
}

// contains reports whether a slice holds a value.
func contains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

// listModes renders the available modes for an error message.
func listModes(modes []string) string {
	if modes == nil {
		return "unknown"
	}
	if len(modes) == 0 {
		return "(none)"
	}
	return strings.Join(modes, ", ")
}

// formatMode renders a mode id for an error message.
func formatMode(mode *string) string {
	if mode == nil {
		return "<none>"
	}
	return *mode
}

// IsUnattended reports whether a mode id is the provider's unattended mode.
//
// Used to decide whether an agent runs without asking. Ported from
// isDefaultAgentCreateConfigUnattended: a nil mode is never unattended.
func IsUnattended(modeID *string, availableModes map[string]bool) bool {
	if modeID == nil {
		return false
	}
	return availableModes[*modeID]
}
