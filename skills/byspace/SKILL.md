---
name: byspace
description: BySpace reference for managing workspaces, agents, schedules, and heartbeats.
---

BySpace is a daemon that supervises AI coding agents on your machine. The CLI is the only orchestration execution path; this skill teaches you how to use it.

## Execution contract

- Use `byspace tool list --json` to discover the catalog and `byspace tool describe <name> --json` before calling an unfamiliar tool. Do not guess inputs.
- Execute every orchestration operation with `byspace tool call <name> --input-file - --json`, passing one JSON object on stdin. The CLI invokes the same shared catalog and validation used by the MCP endpoint.
- Use machine-readable JSON for discovery and calls. Read the returned payload and errors; an agent ID alone does not mean the requested work finished.
- Preserve every setting the user requested: relationship, workspace, provider/model, mode, thinking, features, labels, background behavior, and notification behavior.
- Respect the schema returned for the current caller. In particular, top-level `create_agent` accepts `background` and blocks by default; agent-scoped `create_agent` is always asynchronous, rejects `background`, and defaults to a finish notification.
- When the requested workflow needs an agent's answer, use top-level blocking behavior or wait for the agent-scoped completion notification and then read the result. Never report success merely because creation succeeded.
- Use `create_agent` to create a daemon-managed agent visible in the BySpace UI. Do not launch a terminal process as a substitute.
- The CLI automatically supplies caller agent, cwd, and workspace context when available. A terminal process needs no registration or special identity; it can create ordinary UI agents through the same commands.
- Before `create_agent`, distinguish caller scope: with `BYSPACE_AGENT_ID`, use the requested relationship and `workspace: { "kind": "current" }` when appropriate; without it, `subagent` and `current` are invalid. A terminal caller must use `relationship: { "kind": "detached" }` and either `workspace: { "kind": "existing", "workspaceId": "$BYSPACE_WORKSPACE_ID" }` when that variable exists, or `workspace: { "kind": "create", "source": { "kind": "directory", "path": "<absolute current cwd>" } }` otherwise.

Example:

```bash
printf '%s' '{"statuses":["running"],"limit":20}' \
  | byspace tool call list_agents --input-file - --json
```

## Workspaces

**`create_workspace`** — create a workspace independently of any agent. Required: `isolation` (`local` or `worktree`). Worktree isolation supports `mode: "branch-off" | "checkout-branch" | "checkout-pr"`: use `branchName`/`baseBranch` for a new branch, `branch` for an existing branch, or `prNumber` plus optional `forge`/`projectPath` for a change request. `worktreeSlug` controls the managed path. Returns the workspace descriptor centered on `workspaceId`.

**`list_workspaces`** — list active workspaces.

**`archive_workspace`** — `{ workspaceId }`. Archives the workspace, its agents, and its terminals. Local directories remain; BySpace removes an owned worktree only after its final active workspace reference is archived.

Worktree creation and reference accounting are implementation details of `isolation: "worktree"`.

## Agents

**`create_agent`** — required: `relationship`, `workspace`, `title`, `provider` (`claude/opus`, `codex/gpt-5.4`, …), `initialPrompt`. Common: `notifyOnFinish`, `settings`, `labels`. Returns `{ agentId, … }`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

To create a new worktree and launch an agent in it, use `create_agent.workspace.source.kind = "worktree"`. To split workspace creation from agent creation, call `create_workspace` first and pass its `workspaceId` to `create_agent` with `workspace: { kind: "existing", workspaceId }`.

### Agent relationships

`relationship` controls parentage only:

- `{ kind: "subagent" }` — child under your subagents track. Use for advisors, committee members, planners, implementers, auditors, loop workers, and any agent whose lifetime belongs to your task.
- `{ kind: "detached" }` — root/sibling agent. Use for handoffs and fire-and-forget delegations the user may continue after you are archived.

`workspace` controls placement only:

- `{ kind: "current" }` — same workspace as the caller, with optional `cwd`.
- `{ kind: "existing", workspaceId: string, cwd?: string }` — attach to an existing workspace, usually from `create_workspace`.
- `{ kind: "create", source: { kind: "directory", path?: string } }` — new workspace rooted at a directory.
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "branch-off", worktreeSlug?: string, branchName?: string, baseBranch?: string } } }`
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "checkout-branch", branch: string } } }`
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "checkout-pr", githubPrNumber: number } } }`

Agent-scoped `create_agent` defaults `notifyOnFinish` to true. Set it to `false` only for truly fire-and-forget agents.

**`send_agent_prompt`** — `{ agentId, prompt }`. Use for follow-ups to an existing agent. Agent-scoped prompt calls default to `background: true` and `notifyOnFinish: true`; top-level calls default to blocking with no callback. For a synchronous follow-up, pass `background: false` and use the returned result.

**`update_agent`** — `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_agents`** — filter by `cwd`, `statuses`, `sinceHours`, `includeArchived`.

**`archive_agent`** — `{ agentId }`. Interrupts if running, removes from active list.

## Provider discovery

**`list_providers`** — compact provider availability and modes.

**`list_models`** — full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** — compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_agent` or `update_agent`.

## Schedules and heartbeats

**`create_schedule`** — starts a new agent on a cron cadence. Required: `prompt`, `cron`; top-level callers also require `provider`. Optional: `timezone`, `name`, `cwd`, `isolation`, `maxRuns`, `expiresIn`. In an agent-scoped session, provider/model/features default from the caller. Use when recurring work should live in fresh agents.

**`update_schedule`** — updates a new-agent schedule only. Prefer `cron`; the legacy `every` input is accepted only when its rolling interval has an exact five-field cron equivalent.

**`create_heartbeat`** — sends you a prompt on a cron cadence. Required: `prompt`, `cron`. Optional: `timezone`, `name`, `maxRuns`, `expiresIn`. Use for reminders, PR/build babysitting, and status checks that should return to this conversation.

**`delete_heartbeat`** stops it. The shared catalog intentionally exposes no heartbeat update operation; delete and recreate when its task or cadence changes.

Schedules have the full list/inspect/update/pause/resume/run-once/log/delete surface. Heartbeats deliberately do not.

## Models

`claude/sonnet` (default), `claude/opus` (harder reasoning), `codex/gpt-5.4` (frontier coding), `claude/haiku` (tests only).

## Orchestration preferences

User-specific configuration at `~/.byspace/orchestration-preferences.json`. **Before any BySpace skill chooses a provider or creates an agent, it must read this file.** Reading means an actual file read, not relying on these examples or defaults. Never hardcode a provider string in another skill — resolve through this file.

Two parts:

- `providers` — map of role categories to provider strings. Pass straight to `create_agent`'s `provider` field.
- `preferences` — freeform string array. Read on startup; weave into agent prompts contextually.

Categories: `impl`, `ui`, `research`, `planning`, `audit`. Skills pick the category that matches the role they're launching.

```json
{
  "providers": {
    "impl": "codex/gpt-5.4",
    "ui": "claude/opus",
    "research": "codex/gpt-5.4",
    "planning": "codex/gpt-5.4",
    "audit": "codex/gpt-5.4"
  },
  "preferences": [
    "Claude Opus is the right choice for anything artistic or human-skill-oriented: copywriting, naming, UX copy, visual design, styling. Codex is the workhorse for mechanical work."
  ]
}
```

If the file is missing, use sensible defaults and tell the user once.

## Waiting

Agents take time — 10–30+ minutes is routine. Favor asynchronous workflows.

For agent-scoped `create_agent` and background `send_agent_prompt`, leave `notifyOnFinish` omitted or set it to `true` unless the work is truly fire-and-forget. You will get notified when the target agent finishes, errors, or needs permission. Move on to other work. The notification arrives on its own.

Don't poll `list_agents` or `get_agent_status` to "check on" a running agent. The notification will tell you.

## CLI discovery

The canonical surface is:

```bash
byspace tool list --json
byspace tool describe create_agent --json
printf '%s' '{"includeArchived":false}' | byspace tool call list_agents --input-file - --json
```

Domain-specific CLI commands such as `byspace run`, `send`, and `schedule` remain useful for humans, but orchestration skills use `byspace tool` so parameters, defaults, validation, side effects, results, and errors stay identical to the shared catalog.

## Ops and debugging

Daemon-client architecture: the daemon owns agent lifecycle, state, and the WebSocket API. The hosted Web app and CLI are clients.

|                | Default                                                           |
| -------------- | ----------------------------------------------------------------- |
| Listen address | `127.0.0.1:6777` (override `BYSPACE_LISTEN`)                      |
| Home           | `~/.byspace` (override `BYSPACE_HOME`)                            |
| Daemon log     | `$BYSPACE_HOME/daemon.log`                                        |
| Agent state    | `$BYSPACE_HOME/agents/<id>.json`                                  |
| Worktrees      | `$BYSPACE_HOME/worktrees/` (or `worktrees.root` in `config.json`) |
| PID file       | `$BYSPACE_HOME/byspace.pid`                                       |
| Health         | `GET http://127.0.0.1:6777/api/health`                            |

Debug order:

1. `tail -n 200 ~/.byspace/daemon.log`.
2. `byspace daemon status` for liveness.
3. `curl -s localhost:6777/api/health` if the CLI itself is suspect.

**Never restart the daemon without explicit user approval** — it kills every running agent, including, often, the one asking.
