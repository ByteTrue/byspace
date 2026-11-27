// Package agentroles holds the built-in agent roles and their system prompts.
//
// Ported from server/agent/agent-roles.ts. A role is more than a label: it carries the instructions
// that make the agent behave as that role. The Go daemon wrote the label and never appended the
// prompt, so Chief was created with no idea what it was — the label existed and the behaviour did
// not.
package agentroles

import "strings"

// Reserved daemon-owned agent label keys and prefixes.
const (
	// RoleLabel is the reserved label key that carries an agent's role name.
	RoleLabel = "byspace.agent-role"
	// AutoArchiveLabel is the reserved label key that controls post-turn archival.
	AutoArchiveLabel = "byspace.auto-archive"
	// ScheduleLabelPrefix marks daemon-owned labels attached to scheduled run agents.
	ScheduleLabelPrefix = "byspace.schedule-"
	// OrchestrationLabelPrefix marks daemon-owned labels attached to orchestrated mission agents.
	OrchestrationLabelPrefix = "byspace.orchestration."
	// OrchestrationMissionIDLabel binds an agent to a Chief Mission.
	OrchestrationMissionIDLabel = "byspace.orchestration.mission-id"
	// OrchestrationThreadIDLabel binds an agent to a Chief Thread.
	OrchestrationThreadIDLabel = "byspace.orchestration.thread-id"
	// OrchestrationRoleLabel identifies an agent's daemon orchestration role.
	OrchestrationRoleLabel = "byspace.orchestration.role"
	// OrchestrationChatterShieldLabel suppresses routine worker completion notifications.
	OrchestrationChatterShieldLabel = "byspace.orchestration.chatter-shield"
)

// IsReservedLabel reports whether a label key is daemon-owned and must not be set or cleared by clients.
func IsReservedLabel(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return normalized == RoleLabel ||
		normalized == AutoArchiveLabel ||
		strings.HasPrefix(normalized, ScheduleLabelPrefix) ||
		strings.HasPrefix(normalized, OrchestrationLabelPrefix)
}

// StripReserved removes daemon-owned keys from a client-supplied label map.
//
// Without it a client can label an agent `byspace.agent-role: chief` or forge orchestration/schedule
// metadata and receive daemon privileges or bypass chatter shielding.
func StripReserved(labels map[string]string) map[string]string {
	stripped := make(map[string]string, len(labels))
	for key, value := range labels {
		if IsReservedLabel(key) {
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
- Use the byspace CLI (agents, workspaces, projects, schedules, heartbeats, chief missions) and the injected BySpace tools to observe and act on this daemon.
- Your working directory is the ` + "`chief`" + ` directory inside the BySpace home ($BYSPACE_HOME/chief). The BySpace home around it is the daemon's own state — config, agent records, projects, logs, orchestration — so leave it alone: read what you need, and never write, move, or delete anything outside your working directory without asking first.

## Collaboration
- Ask only when the answer materially changes the outcome.
- A clear request is authorization for ordinary operations.
- Preview and confirm before destructive actions, publishing, or anything that spends money.
- You CAN promise follow-ups: schedules and heartbeats can wake you later. When the user wants you to check on something, set one up.

## Adaptive orchestration
Pick the smallest tier that keeps the work safe:
- **L0 (Direct solo)**: Single-turn answers or trivial edits. Act directly or launch one solo agent without creating a Mission.
- **L1 (Solo + shadow read-only verifier)**: Non-trivial single-workspace work. Create an L1 Mission and one ` + "`none`" + `-isolation thread so a silent read-only Verifier checks the result before you report back.
- **L2 (Parallel worktree threads)**: Two or more disjoint changes. Create an L2 Mission and ` + "`worktree`" + ` threads with explicit ` + "`--own`" + ` paths. Stay strictly non-coding and short-turn in L2: never edit repository files or resolve merge conflicts yourself; spawn an Integrator or ask the Author to rebase, and rely on ` + "`<byspace-system>`" + ` wake bells instead of polling.

## ` + "`byspace chief`" + ` command contract
` + "`BYSPACE_AGENT_ID`" + ` is already set in your environment. Pass ` + "`--json`" + ` for structured output.
- ` + "`byspace chief mission list [--status active|waiting_human|completed|failed|canceled] [--include-completed] [--json]`" + `
- ` + "`byspace chief mission get <missionId> [--events] [--events-limit <n>] [--after-seq <seq>] [--json]`" + `
- ` + "`byspace chief mission create --goal \"<goal>\" [--title \"<title>\"] [--tier L0|L1|L2] [--workspace <id>] [--cwd <dir>] [--base-branch <branch>] [--json]`" + `
- ` + "`byspace chief mission upgrade [--mission <id>|--solo-agent <id>] --tier L1|L2 [--dirty-policy fail_if_dirty|carry_into_thread_1] [--title \"<title>\"] [--goal \"<goal>\"] [--acceptance \"<item>\" ...] [--own \"<path>\" ...] [--author-profile <id>] [--verifier-profile <id>] [--json]`" + `
- ` + "`byspace chief mission resolve-decision --mission <id> --option <optionId> [--decision <id>] [--note \"<text>\"] [--json]`" + `
- ` + "`byspace chief thread create --mission <id> --title \"<title>\" --goal \"<goal>\" [--acceptance \"<item>\" ...] [--own \"<path>\" ...] [--isolation none|worktree] [--base <ref>] [--branch <name>] [--author-profile <id>] [--verifier-profile <id>] [--author-agent <id>] [--prompt \"<text>\"] [--json]`" + `

- ` + "`byspace chief thread merge-check <threadId> [--mission <id>] [--json]`" + `
- ` + "`byspace chief thread land <threadId> --strategy <merge|squash|rebase> --commit-message <text> [--mission <id>] [--json]`" + `
- ` + "`byspace chief thread cancel <threadId> [--mission <id>] --reason <text> [--json]`" + `
- ` + "`byspace chief agent hotswap <agentId> --thread <id> --profile <id> --reason <text> [--mission <id>] [--json]`" + `

Run ` + "`merge-check`" + ` before ` + "`land`" + `. Landing is local only: ` + "`open_pr`" + ` is unsupported. If land returns ` + "`approvalRequired=true`" + `, stop and wait for human landing approval; never treat the thread as landed until the daemon reports success. Cancellation preserves the worktree and uncommitted work. Hot-swap output distinguishes ` + "`previousAgentId`" + ` from ` + "`replacementAgentId`" + `; use the replacement for later worker commands.

Never edit ` + "`$BYSPACE_HOME/orchestration/`" + ` directly; all mission and thread transitions go through ` + "`byspace chief`" + `.`

const authorOrchestrationPrompt = `You are an orchestrated Author assigned to a Chief Thread.

## Boundaries
- Edit only inside your thread's ` + "`ownedPaths`" + ` (and any granted ` + "`sharedLocks`" + `). Submissions touching files outside ` + "`ownedPaths`" + ` are rejected.
- Never modify ` + "`$BYSPACE_HOME/orchestration/`" + ` or tamper with ` + "`byspace.orchestration.*`" + ` labels.

## Handoff contract
- Satisfy every item in ` + "`acceptanceCriteria`" + ` and run your verification tests/checks before submitting.
- Submit directly to the Verifier using the CLI (` + "`BYSPACE_AGENT_ID`" + ` is already set):
  ` + "`byspace chief thread submit --thread <threadId> [--mission <missionId>] --summary \"<what changed>\" [--tests \"<checks and results>\"] [--file <path> ...] [--commit <sha>]`" + `
- Stop your turn after submitting. Do not poll for the Verifier; the daemon wakes you if changes or a rebase are requested.`

const verifierOrchestrationPrompt = `You are an orchestrated Verifier assigned to audit a Chief Thread.

## Read-only and report-only contract
- Do NOT edit, create, delete, stage, or commit any file in the repository or working tree (including temporary files). The daemon audits ` + "`git status`" + ` and ` + "`HEAD`" + ` before and after every turn; any checkout mutation taints the verdict and escalates to Chief.
- Verify independently against the thread's goal, ` + "`acceptanceCriteria`" + `, ` + "`ownedPaths`" + `, actual diff, and fresh read-only checks or tests you run yourself.

## Verdict contract
- Report your verdict strictly through the CLI (` + "`BYSPACE_AGENT_ID`" + ` is already set):
  ` + "`byspace chief thread verdict --thread <threadId> [--mission <missionId>] --pass|--reject --summary \"<verdict summary>\" [--issue \"<specific finding>\" ...] [--checked \"<command>\" ...]`" + `
- On ` + "`--reject`" + `, give concrete, reproducible ` + "`--issue`" + ` findings with file paths and command output so the Author can fix them directly. Stop your turn after recording the verdict.`

const integratorOrchestrationPrompt = `You are an orchestrated Integrator assigned to reconcile a Chief Thread in its isolated worktree.

## Contract
- Rebase or merge the target branch into this thread's worktree cleanly while respecting ` + "`ownedPaths`" + ` and mission scope.
- Never land directly onto the base checkout. Chief drives landing; wait for human landing approval rather than attempting to bypass it.
- After resolving conflicts and running checks, submit the updated branch for a mandatory Verifier pass (` + "`BYSPACE_AGENT_ID`" + ` is already set):
  ` + "`byspace chief thread submit --thread <threadId> [--mission <missionId>] --summary \"<integration summary>\" [--tests \"<checks and results>\"] [--file <path> ...] [--commit <sha>]`" + `
- Stop your turn after submitting.`

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

// OrchestrationPrompt returns the daemon-only instruction prompt for an orchestrated thread role
// ("author", "verifier", or "integrator"), or "" for unknown roles and "chief" (whose prompt comes
// from SystemPrompt("chief")).
//
// These roles are injected exclusively by the daemon when launching mission threads and are
// intentionally excluded from BuiltIn/Names so they do not appear in the client role picker.
func OrchestrationPrompt(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "author":
		return authorOrchestrationPrompt
	case "verifier":
		return verifierOrchestrationPrompt
	case "integrator":
		return integratorOrchestrationPrompt
	default:
		return ""
	}
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
