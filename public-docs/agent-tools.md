---
title: Agent tools
description: Give agents running inside BySpace the ability to create agents, manage workspaces and scripts, and schedule work from the `byspace` CLI.
nav: Agent tools
order: 34
category: Orchestration
---

# Agent tools

An agent running inside BySpace can manage its host: start other agents, create and archive
workspaces, run the project's scripts, open terminals, and schedule work. It does that with the
`byspace` CLI, taught by the bundled **byspace** skill.

The skill is not installed by default. Choose it under **Settings → your host → Agents →
Orchestration skills**; BySpace then puts its own binary on the agent's `PATH`, so the agent knows
the command exists and which daemon to call. The agent also receives its own id, so anything it
starts is recorded as its subagent.

## What the agent gets

| Piece        | How it arrives                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| The commands | `byspace` on `PATH`, pointing at the daemon that launched the agent.                                           |
| The skill    | `~/.agents/skills/byspace` (and `~/.claude/skills/byspace` when that home is used), once selected in Settings. |
| Identity     | `BYSPACE_AGENT_ID`, stamped on agents and schedules the agent creates.                                         |
| Credentials  | The host's own CLI credential file. The agent never handles your password.                                     |

Agents read the skill from those directories. A client that does not read them — most ACP
clients, for example — gets no BySpace tools; the skill can be copied into that client's own skill
directory by hand.

## Delegating from an agent

Ask in natural language, or name a command:

```bash
byspace run --provider claude/opus "review this branch and report bugs without editing files"
```

The worker appears in the **Subagents track** near the composer. Open it to follow the
conversation. Your main agent is notified when the worker finishes, errors, or needs permission,
and can keep working while it runs.

- Placement and parentage are separate. A worker created in another workspace is still a subagent.
- Detaching is a user action in the subagents track. No command detaches an agent.
- Agents never answer their own permission requests; that stays with you.

## Reference

`byspace --help`, `byspace <group> --help` and the [CLI reference](/docs/cli) are the complete
command surface. The areas an agent can drive:

| Area        | Commands                                                                               |
| ----------- | -------------------------------------------------------------------------------------- |
| Agents      | `run`, `send`, `wait`, `logs`, `inspect`, `stop`, `archive`, `delete`, `update`        |
| Workspaces  | `create`, `ls`, `rename`, `archive`, `setup`                                           |
| Projects    | `create`, `ls`, `rename`, `delete`                                                     |
| Scripts     | `script ls`, `script start`, `script stop`                                             |
| Terminals   | `terminal ls`, `terminal create`, `terminal capture`, `terminal send`, `terminal kill` |
| Schedules   | `schedule create/ls/inspect/logs/update/pause/resume/run-once/delete`                  |
| Heartbeats  | `heartbeat create/ls/delete`                                                           |
| Permissions | `permit ls`, `permit allow`, `permit deny`                                             |
| Providers   | `provider ls`, `provider models`                                                       |

The skill is what tells the agent when to choose each shape — a schedule versus a heartbeat, a new
worktree versus an existing workspace. See [Orchestration](/docs/orchestration) for the user-facing
view.

## Mental model

Workspaces decide where work happens; agent parentage decides who owns the work.

- An agent that starts another without a workspace gets a subagent in its own workspace.
- Naming a workspace places the subagent there without detaching it from its parent.
- Create a workspace first when you need worktree isolation, a specific branch, or a pull request
  checkout.

## MCP servers belong to the client

BySpace does not carry MCP server configuration for its agents. Each CLI reads its own config —
Claude Code reads `~/.claude.json` and `.mcp.json`, Codex reads `config.toml`, Pi reads
`mcp.json` — and those stay in effect because BySpace launches the same binaries you would run
yourself.
