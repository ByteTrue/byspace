---
name: byspace-handoff
description: Hand off the current task to another agent with full context. Use when the user says "handoff", "hand off", "hand this to", or wants to pass work to another agent.
user-invocable: true
---

# Handoff Skill

Transfer the current task — context, decisions, failed attempts, constraints — to a fresh agent. The receiving agent starts with **zero context**, so the handoff prompt must be a self-contained briefing.

**User's arguments:** $ARGUMENTS

## Prerequisites

Read the **byspace** skill. The host's agent profiles and their notes live in `$BYSPACE_HOME/config.json` under `agentProfiles`; read them before choosing the receiving agent. Do not launch anything until you have read them.

## Parsing arguments

1. **Agent profile** — explicit profile name first; otherwise choose the profile whose `notes` best match the work. Materialize it into `byspace run` (`--provider`, `--mode`, `--thinking`, `--features`). If no profile fits, pick from `byspace provider models` and say that you fell back.
2. **Isolation** — "in a worktree" / "worktree" → create a workspace with `isolation: "worktree"`, using a short branch name derived from the task.
3. **Task description** — anything else the user said.

## The handoff prompt

The receiving agent has zero context. Include:

```
## Task
[Imperative description.]

## Context
[Why this task exists, required context.]

## Relevant files
- `path/to/file.ts` — [what it is and why it matters]

## Current state
[What's done, what works, what doesn't.]

## What was tried
- [Approach] — [why it failed or was abandoned]

## Decisions
- [Decision — rationale]

## Acceptance criteria
- [ ] [Criterion]

## Constraints
- [Must-not / must-preserve]
```

**Preserve task semantics.** Investigate-only → "DO NOT edit files." Fix → "implement the fix." Refactor → "refactor, not rewrite." Carry the user's exact intent.

## Launch

Prepare the handoff in a dedicated workspace:

1. Select the current workspace or call `create_workspace` with the requested isolation.
2. Run `byspace run --title "[Handoff] <task>"` with the briefing as the prompt, adding `--workspace <id>` when explicit placement is needed.
3. Return the agent and workspace to the user, explaining that it remains in your subagent track until they detach it manually.

Do not encode independence as a create mode and do not invoke CLI or wire-level detach operations. Detach is a user gesture in the subagents track.

Do not wait or poll for the agent to finish.
