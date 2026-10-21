// Package toolpolicy decides which BySpace tools an agent may call.
//
// Ported from agent/byspace-tool-policy.ts. The daemon injects its own MCP server into every
// agent, and those tools are powerful: they can create agents, send them messages, read files. A
// user working with a provider they half trust, or running a prompt they are unsure about, needs a
// way to take specific tools away without disabling the whole bridge — disabling the bridge also
// removes the harmless ones.
package toolpolicy

import "strings"

// Policy is one provider's BySpace-tool settings.
type Policy struct {
	// Enabled is nil when the user has not touched it; an empty policy means enabled.
	Enabled *bool `json:"enabled,omitempty"`
	// DisabledTools names tools to withhold.
	DisabledTools []string `json:"disabledTools,omitempty"`
}

// SpeakToolName is always allowed.
//
// `speak` only produces speech output; it cannot read, write or spawn anything. Letting a policy
// disable it would turn "I turned off BySpace tools" into "the agent went silent", which is a
// confusing way to learn what the switch does.
const SpeakToolName = "speak"

// Resolve reads a provider's policy out of the settings object.
//
// The settings shape is `{providers: {<id>: {byspaceTools: {...}}}}`. A missing entry means "no
// policy", which is enabled — the default has to be on, or upgrading would silently remove the
// tools from every existing agent.
func Resolve(providerID string, providerSettings map[string]any) *Policy {
	if providerSettings == nil {
		return nil
	}
	entry, ok := providerSettings[providerID].(map[string]any)
	if !ok {
		return nil
	}
	rawPolicy, ok := entry["byspaceTools"].(map[string]any)
	if !ok {
		return nil
	}
	policy := &Policy{}
	if enabled, isBool := rawPolicy["enabled"].(bool); isBool {
		policy.Enabled = &enabled
	}
	if disabled, isList := rawPolicy["disabledTools"].([]any); isList {
		for _, item := range disabled {
			if name, isString := item.(string); isString && strings.TrimSpace(name) != "" {
				policy.DisabledTools = append(policy.DisabledTools, name)
			}
		}
	}
	return policy
}

// PolicyEnabled reports whether the policy allows BySpace tools at all.
func PolicyEnabled(policy *Policy) bool {
	return policy == nil || policy.Enabled == nil || *policy.Enabled
}

// IsToolEnabled reports whether one tool may be offered to the agent.
func IsToolEnabled(policy *Policy, toolName string) bool {
	if toolName == SpeakToolName {
		return true
	}
	if policy == nil {
		// No policy means everything is allowed. Returning here rather than relying on
		// PolicyEnabled is the difference between "enabled" and a nil dereference — the daemon
		// panicked on the very first tool call without a policy.
		return true
	}
	if !PolicyEnabled(policy) {
		return false
	}
	for _, disabled := range policy.DisabledTools {
		if disabled == toolName {
			return false
		}
	}
	return true
}

// Filter narrows a tool list to the ones the policy allows, preserving order.
func Filter(policy *Policy, toolNames []string) []string {
	out := make([]string, 0, len(toolNames))
	for _, name := range toolNames {
		if IsToolEnabled(policy, name) {
			out = append(out, name)
		}
	}
	return out
}
