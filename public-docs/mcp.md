---
title: MCP reference
description: Reference for the BySpace tools agents use to manage agents, workspaces, terminals, and schedules.
nav: MCP reference
order: 33
category: Orchestration
---

# MCP reference

This is the complete catalog behind the workflows in [Orchestration](/docs/orchestration) and [Common workflows](/docs/orchestration-workflows). You normally ask for an outcome in natural language and let the agent choose the tools.

BySpace does not inject the catalog into launched agents. Bundled orchestration skills call the same catalog through the `byspace tool` CLI. Install them under **Settings → your host → Agents → Orchestration skills**.

External MCP clients can explicitly connect to `/mcp/agents` when `daemon.mcp.enabled` is enabled. The endpoint uses the daemon's bearer authentication.

## Tools

### Agents

| Tool                 | Function                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `create_agent`       | Create an agent tied to a working directory, optionally with initial settings or a new git worktree. |
| `send_agent_prompt`  | Send a task to a running agent.                                                                      |
| `get_agent_status`   | Return the latest snapshot for an agent.                                                             |
| `list_agents`        | List recent agents as compact metadata.                                                              |
| `cancel_agent`       | Abort an agent's current run but keep the agent alive.                                               |
| `archive_agent`      | Soft-delete an agent and remove it from the active list.                                             |
| `kill_agent`         | Terminate an agent session permanently.                                                              |
| `update_agent`       | Update an agent name, labels, or runtime settings such as mode/model/thinking/features.              |
| `get_agent_activity` | Return recent agent timeline entries as a curated summary.                                           |
| `set_agent_mode`     | Switch an agent's session mode.                                                                      |

### Workspaces

| Tool                | Function                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `create_workspace`  | Create a local or worktree-isolated workspace from a branch, base branch, or change request. |
| `list_workspaces`   | List active workspaces with their directories and isolation.                                 |
| `rename_workspace`  | Change the user-visible name of the current or specified workspace.                          |
| `archive_workspace` | Archive a workspace and its agents and terminals; remove its final BySpace-owned worktree.   |

### Terminals

| Tool                 | Function                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `list_terminals`     | List terminal sessions for one working directory or all working directories. |
| `create_terminal`    | Create a terminal session for a working directory.                           |
| `kill_terminal`      | Kill a terminal session.                                                     |
| `capture_terminal`   | Capture plain-text output from a terminal session.                           |
| `send_terminal_keys` | Send text or special key tokens to a terminal session.                       |

### Schedules

| Tool                | Function                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `create_schedule`   | Create a recurring cron schedule that starts a new agent on every run. |
| `create_heartbeat`  | Send a recurring prompt back into the current agent.                   |
| `delete_heartbeat`  | Delete a heartbeat owned by the current agent.                         |
| `list_schedules`    | List new-agent schedules managed by the daemon.                        |
| `inspect_schedule`  | Inspect a new-agent schedule and its run history.                      |
| `pause_schedule`    | Pause an active new-agent schedule.                                    |
| `resume_schedule`   | Resume a paused new-agent schedule.                                    |
| `update_schedule`   | Change a new-agent schedule's cadence, prompt, limits, or target.      |
| `schedule_logs`     | Return recent runs and output for a new-agent schedule.                |
| `run_schedule_once` | Run a new-agent schedule immediately without changing its cadence.     |
| `delete_schedule`   | Delete a new-agent schedule permanently.                               |

### Providers

| Tool               | Function                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `list_providers`   | List configured agent providers, availability, and modes.         |
| `list_models`      | List models for an agent provider.                                |
| `inspect_provider` | Inspect compact provider capabilities and draft feature settings. |

### Permissions

| Tool                       | Function                                          |
| -------------------------- | ------------------------------------------------- |
| `list_pending_permissions` | Return pending permission requests across agents. |
| `respond_to_permission`    | Approve or deny a pending permission request.     |

### Voice

| Tool    | Function                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `speak` | Speak text through daemon-managed voice output. Available only in voice-enabled sessions. |
