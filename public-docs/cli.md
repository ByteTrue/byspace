---
title: CLI
description: "BySpace CLI reference: manage agents, daemons, permissions, and worktrees from your terminal."
nav: CLI
order: 3
category: Getting started
---

# CLI

The BySpace CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the BySpace CLI to spawn and manage other agents. This enables multi-agent workflows where one agent delegates subtasks to others and waits for results.

## Quick reference

```bash
byspace run "fix the tests"            # Start an agent
byspace ls                             # List running agents
byspace attach <id>                    # Stream agent output
byspace send <id> "also fix linting"   # Send follow-up task
byspace logs <id>                      # View agent timeline
byspace stop <id>                      # Stop an agent
```

## Running agents

Use `byspace run` to start a new agent with a task:

```bash
byspace run "implement user authentication"
byspace run --provider codex "refactor the API layer"
byspace run --detach "run the full test suite"  # background
byspace run --worktree feature-x "implement feature X"
byspace run --output-schema schema.json "extract release notes"
byspace run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

The `--worktree` flag creates the agent in an isolated git worktree, useful for parallel feature development.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--detach`.

By default, `byspace run` waits for completion. Use `--detach` to run in the background.

## Listing agents

```bash
byspace ls                    # Running agents in current directory
byspace ls -a                 # Include completed/stopped agents
byspace ls -g                 # All directories
byspace ls -a -g --json       # Full list as JSON
```

## Streaming output

Use `byspace attach` to stream an agent's output in real-time:

```bash
byspace attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

```bash
byspace send <id> "now run the tests"
byspace send <id> --image screenshot.png "what's wrong here?"
byspace send <id> --no-wait "queue this task"
```

## Viewing logs

```bash
byspace logs <id>                  # Full timeline
byspace logs <id> -f               # Follow (streaming)
byspace logs <id> --tail 10        # Last 10 entries
byspace logs <id> --filter tools   # Only tool calls
```

## Waiting for agents

Block until an agent finishes its current task:

```bash
byspace wait <id>
byspace wait <id> --timeout 60   # 60 second timeout
```

Useful in scripts or when one agent needs to wait for another.

## Schedules

Run an agent on an interval or a cron. See [Schedules from the CLI](/docs/schedules-cli) for the full reference.

```bash
byspace schedule create --every 30m --cwd ~/dev/my-app "Continue the refactor and leave a note."
byspace schedule ls
byspace schedule pause <id>
```

## Permissions

Agents may request permission for certain actions. Manage these from the CLI:

```bash
byspace permit ls                # List pending requests
byspace permit allow <id>        # Allow all pending for agent
byspace permit deny <id> --all   # Deny all pending
```

## Agent modes

Change an agent's operational mode (provider-specific):

```bash
byspace agent mode <id> --list   # Show available modes
byspace agent mode <id> bypass   # Set bypass mode
byspace agent mode <id> plan     # Set plan mode
```

## Daemon management

```bash
byspace daemon start             # Start the daemon
byspace daemon start --web-ui    # Start and serve the bundled web UI
byspace daemon status            # Check status
byspace daemon stop              # Stop the daemon
```

Use `BYSPACE_HOME` to run multiple isolated daemon instances.

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://byspace.pages.dev/#offer=...` link used by browser pairing. With an offer URL the CLI connects through the BySpace relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
byspace daemon pair --json   # prints { url, qr, ... }
```

Use it from anywhere:

```bash
byspace ls --host 'https://byspace.pages.dev/#offer=eyJ2IjoyLC...'
byspace run --host "$OFFER_URL" "fix the failing tests"
```

You can also set it once via `BYSPACE_HOST` instead of passing `--host` on every command.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
byspace run --detach "implement the API" --name api-agent
byspace wait api-agent
byspace logs api-agent --tail 5
```

Simple implement + verify loop:

```bash
# Requires jq
while true; do
  byspace run --provider codex "make the tests pass" >/dev/null

  verdict=$(byspace run --provider claude --output-schema '{"type":"object","properties":{"criteria_met":{"type":"boolean"}},"required":["criteria_met"],"additionalProperties":false}' "ensure tests all pass")
  if echo "$verdict" | jq -e '.criteria_met == true' >/dev/null; then
    echo "criteria met"
    break
  fi
done
```

This pattern enables hierarchical task decomposition, a lead agent can break down work, delegate to specialists, and synthesize results.

## Output formats

Most commands support multiple output formats for scripting:

```bash
byspace ls --json                # JSON output
byspace ls --format yaml         # YAML output
byspace ls -q                    # IDs only (quiet)
```

## Global options

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://byspace.pages.dev/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
