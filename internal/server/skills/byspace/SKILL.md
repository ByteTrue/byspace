---
name: byspace
description: BySpace reference for managing projects, workspaces, workspace scripts, agents, terminals, schedules and heartbeats from inside a BySpace agent. Use when the user asks to start, delegate to, wait on, or organize other agents; to create or clean up workspaces and worktrees; to run a project's dev server; or to schedule recurring work.
---

# BySpace

BySpace is the daemon that launched you. You drive it with the `byspace` CLI, already on your
`PATH` and already pointing at the right host (`BYSPACE_HOME`, `BYSPACE_HOST`). The commands you
run are attributed to you through `BYSPACE_AGENT_ID`, so an agent you start knows who asked.

`byspace --help` and `byspace <command> --help` are the contract for flags and output. Read them
before a command you have not used; this file covers what help cannot: who owns what, which shape
of work to pick, and what not to do.

## Delegating

```bash
byspace run --provider codex/gpt-5.4 --mode full-access "<prompt>"   # blocks until the turn ends
byspace run -d --provider claude/opus "<prompt>"                    # returns its agent id at once
byspace send <agent-id> "<follow-up>"
byspace wait <agent-id>
byspace logs <agent-id>
```

`--provider` is `provider` or `provider/model`. Pick a model the provider actually lists
(`byspace provider ls`, `byspace provider models <provider>`); a made-up id fails at launch.

- Placement and parentage are separate. `--workspace <id>` puts the child in that workspace; it
  stays your subagent either way. Only the user detaches, in the app.
- Leave `-d` off when you need the answer in this turn, and the same for `byspace send --wait`.
  With `-d`, the daemon prompts you when the child finishes, errors, or needs permission — do not
  poll `byspace ls` to check on it. Agents take 10–30 minutes routinely; go do other work.
- `--output-schema` (JSON Schema object, or `@file`) makes the child answer with an object
  instead of prose.

## Workspaces

A workspace is where work happens: a local directory or a BySpace-owned worktree.

```bash
byspace workspace ls
byspace workspace create --isolation worktree --mode branch-off --new-branch fix-x --base main
byspace workspace create --isolation worktree --mode checkout-branch --branch existing-work
byspace workspace create --isolation worktree --mode checkout-pr --pr-number 42
byspace workspace rename <workspace-id> "title"
byspace workspace archive <workspace-id>
```

`byspace run --new-workspace worktree --worktree-mode branch-off --new-branch fix-x …` does create
and launch in one step. Two agents on two branches in one checkout fight over the working tree;
that is the reason worktrees exist.

Archiving a workspace archives the agents and terminals it owns. The local directory stays; a
BySpace worktree is removed once its last active workspace reference is gone.

## Workspace scripts

Scripts are the `byspace.json` entries the project configures; BySpace runs them in a supervised
terminal, so a dev server survives and its port and health are reported.

```bash
byspace script ls [--cwd <path> | --workspace <id>]
byspace script start <name> [--cwd <path> | --workspace <id>]
byspace script stop <name> [--cwd <path> | --workspace <id>]
```

Prefer a configured script over starting the same server by hand: the user then sees it, and it
stops with the workspace.

## Terminals

```bash
byspace terminal ls [--cwd <path>]
byspace terminal create [--cwd <path>] [--workspace <id>] [--name <label>]
byspace terminal capture <terminal-id> [-S]
byspace terminal send <terminal-id> "text" [-l]
byspace terminal kill <terminal-id>
```

Use a terminal for something long-running the user should be able to watch, not for one-shot
commands you can run directly. `capture` reads the screen; `-S` adds scrollback.

## Schedules and heartbeats

Same cron engine, deliberately different shapes.

```bash
byspace schedule create --provider pi --cron "*/15 * * * *" "check the build"
byspace schedule ls | inspect <id> | logs <id> | pause <id> | resume <id> | run-once <id>
byspace schedule update <id> --cron "0 * * * *"
byspace schedule delete <id>

byspace heartbeat create --cron "*/15 * * * *" "check the build"
byspace heartbeat ls
byspace heartbeat delete <id>
```

A schedule starts a **new agent** on each run — use it when the recurring work should not carry
this conversation. A heartbeat prompts **you** — use it for reminders, babysitting a PR, or a
status check that should come back here. A heartbeat belongs to the agent that created it (the command defaults
to you); you cannot read or delete another agent's. Pause, resume, update, inspect, logs and run-once apply to
schedules only; to change a heartbeat, delete it and create a new one.

Recurring work that the user will want to see start from a clean context belongs in a schedule.

## Permissions

Agents stop and ask their user for approval on sensitive actions. `byspace permit ls` shows the
pending requests and `byspace permit allow|deny <agent-id> <request-id>` answers one.

Never answer a permission request for yourself or for an agent acting on your behalf. That
decision is the user's; an agent that approves its own prompts has removed the control the user
configured.

## Projects

```bash
byspace project ls
byspace project create [path]
byspace project rename <project-id> "<name>"
byspace project delete <project-id>
```

Deleting a project archives its workspaces and removes it from BySpace; it does not delete the
directory. For a local daemon `project create` defaults to the current directory; with a remote
host, always pass the path.

## Rules

- Never stop, restart, or reconfigure the daemon you are running inside: `byspace daemon stop`,
  `byspace restart`, and `byspace update` will kill every agent here, including you. Ask the user.
- Archive before delete. Archiving is reversible in the record; deleting an agent or workspace
  from the active list is not.
- Say the id. Every command that mutates something takes an id from a listing command; do not
  guess one.

For questions about BySpace itself — setup, configuration, connectivity, updates, logs — use the
**byspace-help** skill.
