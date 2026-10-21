// Package agentroles holds the built-in agent roles and their system prompts.
//
// Ported from server/agent/agent-roles.ts. A role is more than a label: it carries the instructions
// that make the agent behave as that role. The Go daemon wrote the label and never appended the
// prompt, so Chief was created with no idea what it was — the label existed and the behaviour did
// not.
package agentroles

import "strings"

// RoleLabel is the reserved label key that carries an agent's role name.
const RoleLabel = "byspace.agent-role"

// reservedLabels are keys the daemon owns and a client must not set.
var reservedLabels = map[string]bool{RoleLabel: true}

// StripReserved removes daemon-owned keys from a client-supplied label map.
//
// Without it a client can label an agent `byspace.agent-role: chief` and receive Chief's privileges
// and prompt for an agent of its own making.
func StripReserved(labels map[string]string) map[string]string {
	stripped := make(map[string]string, len(labels))
	for key, value := range labels {
		if reservedLabels[key] {
			continue
		}
		stripped[key] = value
	}
	return stripped
}

// Definition is one built-in role.
type Definition struct {
	// Name is the stable identifier on labels and the wire.
	Name string
	// Description is what a picker shows.
	Description string
	// SystemPrompt is appended to agents carrying this role.
	SystemPrompt string
}

// chiefSystemPrompt is the instruction Chief runs on.
//
// Ported verbatim: the wording is the behaviour. Each bullet was written because the agent got it
// wrong otherwise — naming a feature instead of doing the work, treating an ordinary request as one
// needing confirmation, or promising follow-ups it had no mechanism to keep.
const chiefSystemPrompt = `You are Chief, the built-in assistant of BySpace — the user's single conversation entry point for everything running on this daemon.

## Working model
- The user brings you a goal, not a routing decision. Never answer by naming the feature or workspace they should go find — do it yourself with the tools below, then tell them what you did.
- Answer in chat when one turn is enough. Start or steer a workspace agent when the work needs a repository, tools, or more than one turn.
- Use the byspace CLI (agents, workspaces, projects, schedules, heartbeats) and the injected BySpace tools to observe and act on this daemon.
- Your working directory is the ` + "`chief`" + ` directory inside the BySpace home ($BYSPACE_HOME/chief). The BySpace home around it is the daemon's own state — config, agent records, projects, logs — so leave it alone: read what you need, and never write, move, or delete anything outside your working directory without asking first.

## Collaboration
- Ask only when the answer materially changes the outcome.
- A clear request is authorization for ordinary operations.
- Preview and confirm before destructive actions, publishing, or anything that spends money.
- You CAN promise follow-ups: schedules and heartbeats can wake you later. When the user wants you to check on something, set one up.`

// BuiltIn lists every role, in the order the UI shows them.
var BuiltIn = []Definition{
	{
		Name:         "chief",
		Description:  "BySpace's built-in assistant. A single conversation entry point that observes and drives the workspaces on this daemon.",
		SystemPrompt: chiefSystemPrompt,
	},
}

// Names returns the built-in role names.
func Names() []string {
	out := make([]string, 0, len(BuiltIn))
	for _, role := range BuiltIn {
		out = append(out, role.Name)
	}
	return out
}

// Get resolves a role by wire name.
//
// Case-insensitive and trimmed, because the name arrives from a label a client wrote. An unknown
// name resolves to nil rather than an error: a role that was removed must not make the agent
// unloadable, it just stops contributing a prompt.
func Get(name string) *Definition {
	trimmed := strings.ToLower(strings.TrimSpace(name))
	if trimmed == "" {
		return nil
	}
	for index := range BuiltIn {
		if BuiltIn[index].Name == trimmed {
			return &BuiltIn[index]
		}
	}
	return nil
}

// SystemPrompt returns the prompt for a role name, or "" when there is none.
func SystemPrompt(name string) string {
	if role := Get(name); role != nil {
		return role.SystemPrompt
	}
	return ""
}

// ComposeSystemPromptParts joins prompt segments into one system prompt.
//
// Ported from composeSystemPromptParts. Each part is trimmed and empty parts are dropped, and the
// result is "" when nothing survives. Both details matter: a nil or empty part left in produces a
// stray blank line, and returning a string of separators instead of "" makes the caller send a
// system prompt that says nothing — which some providers treat as a real prompt and prepend to every
// turn.
func ComposeSystemPromptParts(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		kept = append(kept, trimmed)
	}
	if len(kept) == 0 {
		return ""
	}
	return strings.Join(kept, "\n\n")
}
