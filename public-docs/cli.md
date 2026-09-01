---
title: CLI
description: "BySpace CLI reference: manage projects, workspaces, agents, plugins, scripts, schedules, daemons, and permissions from your terminal."
nav: CLI
order: 3
category: Getting started
---

# CLI

The BySpace CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the BySpace CLI to spawn and manage other agents. BySpace recognizes the calling agent, so CLI-created workers get the same workspace and parent defaults as MCP-created workers.

## Quick reference

```bash
byspace run "fix the tests"            # Start an agent
byspace ls                             # List running agents
byspace attach <id>                    # Stream agent output
byspace send <id> "also fix linting"   # Send follow-up task
byspace logs <id>                      # View agent timeline
byspace stop <id>                      # Stop an agent
```

## Provider diagnostics

Ask the daemon to inspect the provider environment it actually uses:

```bash
byspace provider diagnostic claude
byspace provider diagnostic codex --json
byspace provider diagnostic opencode --host devbox:6777
```

The diagnostic includes the configured command, daemon `PATH` and shell, matching binaries, resolved path, version, model count, and provider status. Use `--host` for a remote daemon. This is the same diagnostic shown under **Settings → your host → Providers → provider → Diagnostic**.

## Running agents

Use `byspace run` to start a new agent with a task:

```bash
byspace run "implement user authentication"
byspace run --provider codex "refactor the API layer"
byspace run --background "run the focused test suite"
byspace run --new-workspace worktree --worktree-mode branch-off --new-branch feature/x --base origin/main "implement feature X"
byspace run --workspace <workspace-id> "review the current diff"
byspace run --output-schema schema.json "extract release notes"
byspace run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

From a human shell, a bare `byspace run` creates a new local workspace for the current directory. Use `--workspace <id>` to add the agent to an existing workspace, or `--new-workspace local|worktree` to explicitly create a separate workspace for the run.

Worktree creation accepts `--worktree-mode branch-off|checkout-branch|checkout-pr` plus the matching `--new-branch`/`--base`, `--branch`, or `--pr-number`/`--forge` options. Use `--worktree-slug` to choose the managed directory slug.

When an existing BySpace agent runs the same command, BySpace recognizes it through `BYSPACE_AGENT_ID`. Without explicit placement, the new agent becomes its subagent in the same workspace. `--workspace` can place that subagent elsewhere without changing its parent.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--background`.

By default, `byspace run` waits for completion. Use `--background` to return immediately while the agent keeps running.

## Projects

Register the current directory as a project, then list the projects known to the daemon:

```bash
cd ~/dev/my-app
byspace project create
byspace project ls
```

Use the project ID from `byspace project ls` to rename, reset, or delete a project:

```bash
byspace project rename <project-id> "My app"
byspace project rename <project-id> --reset
byspace project delete <project-id>
```

`--reset` restores the name derived from the project directory. Deleting a project archives its active workspaces and removes the project from BySpace. It does not delete the project directory.

For a local daemon, `byspace project create [path]` defaults to the current directory and resolves relative paths on the CLI machine. When you use `--host` or `BYSPACE_HOST`, provide a path that the target daemon can access:

```bash
byspace project create /srv/repos/api --host devbox:6777
```

The remote daemon interprets that path on its own machine. See [Workspaces](/docs/workspaces) for how projects group working directories and sessions.

## Workspaces

Create a workspace independently when you want to prepare its files before starting an agent:

```bash
byspace workspace create --isolation local --path ~/dev/my-app --title main

byspace workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode branch-off \
  --new-branch feature/auth \
  --worktree-slug feature-auth \
  --base origin/main

byspace workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode checkout-branch \
  --branch feature/existing \
  --worktree-slug existing-copy

byspace workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode checkout-pr \
  --pr-number 2186
```

Then list, use, rename, or archive it:

```bash
byspace workspace ls
byspace run --workspace <workspace-id> "implement authentication"
byspace workspace rename <workspace-id> "Auth rework"
byspace workspace rename <workspace-id> --reset   # back to the branch or directory name
byspace workspace archive <workspace-id>
```

Add `--forge <name>` to PR checkout when BySpace cannot infer the forge from the source checkout. See [Git worktrees](/docs/worktrees) for setup hooks and services.

## Workspace scripts

List, start, and stop the scripts configured in a workspace's `byspace.json` (legacy `paseo.json` files remain supported):

```bash
byspace script ls
byspace script start web
byspace script stop web
```

By default, BySpace selects the workspace whose directory is the current directory. Pass `--cwd <path>` to select a different directory, or `--workspace <workspace-id>` when a directory has multiple workspaces. These commands also accept `--host` and the standard output options such as `--json`.

The output includes each script's lifecycle and supervised terminal ID. Services also include their assigned port, proxy URL, and health. See [Git worktrees](/docs/worktrees#scripts-and-services) for `byspace.json` configuration.

## Plugins

Create and manage trusted plugins on a daemon:

```bash
byspace plugin init /absolute/path/to/plugin
byspace plugin install /absolute/path/to/plugin
byspace plugin add owner/repository
byspace plugin add https://git.example.com/owner/repository.git --ref main
byspace plugin status
byspace plugin update my-plugin
byspace plugin update --all
byspace plugin ls
byspace plugin reload my-plugin
byspace plugin logs my-plugin
byspace plugin disable my-plugin
byspace plugin enable my-plugin
byspace plugin remove my-plugin
```

GitHub shorthand checks an existing host directory first. Use `--path <directory>` for a plugin in
a monorepo. `byspace plugin logs <id>` returns the plugin's recent daemon-side stdout and stderr. Add `--json` for
structured entries or `--host <target>` for another daemon. See the
[Plugin reference](/docs/plugins/reference) for installation, trust, lifecycle, and log-retention
behavior.

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

Run an agent on a cron schedule. The CLI also accepts simple cadence presets and compiles them to cron. See [Schedules from the CLI](/docs/schedules-cli) for the full reference.

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
byspace agent detach <id>        # Make a subagent top-level
```

Detaching is an explicit lifecycle action, not a creation flag. The agent keeps running; only its relationship to its parent changes.

## Daemon management

```bash
byspace daemon start             # Start the daemon
byspace daemon start --web-ui    # Start and serve the bundled web UI
byspace daemon status            # Check status
byspace reload                    # Reload config.json (top-level alias)
byspace daemon reload             # Reload config.json
byspace daemon stop              # Stop the daemon
```

Reload validates the whole file, applies runtime-safe changes, and reports `appliedPaths`, `restartRequiredPaths`, and `overrideControlledPaths`. Human output prints `byspace daemon restart` only when a changed setting needs it. Use `--json` or `--format yaml` for the structured result, and `--host` to reload a remote daemon's own configuration file. An older host that does not support reload returns an update-host error.

Use `BYSPACE_HOME` to run multiple isolated daemon instances.

## Hub

```bash
byspace hub login [url]          # Approve and store organization-scoped CLI access
byspace hub init                 # Guided setup: scaffold and deploy a starter bundle here
byspace hub connect [url]        # Enroll this daemon using CLI access
byspace hub projects             # List projects in the authenticated organization
byspace hub status               # Show the current Hub relationship
byspace hub disconnect           # End it
byspace hub deploy -p <project>  # Discover, validate, and activate a Hub bundle
byspace hub deploy -p <project> --dry-run # Validate without activating
byspace hub logout               # Remove the active stored CLI login
```

Run deploy from the project root. It reads `.paseo/hub.yml`, every direct `.paseo/workflows/*.yml` file, and referenced `.paseo/workflows/partials/*` files in deterministic path order. It does not search parents, accept an alternate resource path, or flatten the bundle into monolithic YAML.

Pass `-p, --project <slug>` to select the target project. `--dry-run` performs the same discovery and server validation without recording or activating a revision. Both outputs include the resolved Hub, project, and discovered workflow count.

`login` opens the Hub approval page and stores a durable organization-scoped CLI credential under `BYSPACE_HOME`. In an interactive terminal it then asks whether to connect this daemon and whether to initialize and deploy a starter workflow, both defaulting to yes. Declining the connection prints `byspace hub connect <origin>; then byspace hub init`, because the connection alone does not produce a bundle; declining only the starter prints `byspace hub init`. `--json` and non-TTY login remain login-only and never prompt. The stored login is separate from the daemon relationship created by `connect`.

`init` runs the same guided setup on its own and requires a TTY. It connects the daemon, uses the organization's only project or asks which one, and lists the Hub app connections that can back a starter workflow. One usable connection is selected automatically; with several, you choose a **Trigger connection**. If none is ready, setup sends you to **Hub → Apps** and stops before selecting an agent or writing files.

Setup then asks which agent provider, model, and mode the starter should run, choosing from what the connected daemon reports. A provider is offered only when the daemon has it enabled with a selectable model. Suggested model and mode entries are the daemon's defaults; no provider is suggested merely because it appears first. The mode question is skipped for providers that expose no modes and asked explicitly when the daemon has modes but no default. Finally, setup asks for the identity that gates the chosen connection: a GitHub username, a Slack member ID, or a Discord user ID. It writes `.paseo/hub.yml` and `.paseo/workflows/<provider>-help.yml`, validates them against Hub, and deploys. An existing `.paseo/` directory is replaced only after you confirm. See the [generated starter bundle](/docs/hub/configuration#generated-starter-bundle).

Interactive logout checks the same-origin daemon relationship and asks whether to disconnect before deleting the login. Declining removes only the login. JSON and noninteractive logout never prompt or disconnect implicitly; `--disconnect-daemon` is the explicit automation path, and `--force` applies to that daemon disconnection. If a requested disconnection fails, the login is preserved.

Every command resolves and normalizes its destination before Hub or daemon work. Origin precedence is an explicit command origin or `--hub`, then `BYSPACE_HUB_URL`, then the active stored login origin, then the upstream hosted default `https://hub.paseo.sh`. The hosted default never overrides an active login. Credential precedence is `--api-key <secret>`, then `BYSPACE_HUB_API_KEY`, then a stored login for the exact resolved origin. A stored credential is never sent to a different origin. API keys passed through flags or the environment are not stored.

Human output reports the resolved destination before each action. JSON output keeps stdout machine-readable and includes the normalized Hub origin. Bundle diagnostics identify paths without printing configuration contents or credentials.

See [Daemons in Hub](/docs/hub/daemons), [Hub configuration](/docs/hub/configuration), and the [Hub public API](/docs/hub/api).

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.byspace.cc.cd/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the BySpace relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
byspace daemon pair          # asks before enabling relay, then prints the QR and link
byspace daemon pair --relay  # enables relay without prompting
byspace daemon pair --json   # structured output; never prompts
```

Relay is off for new installations. In non-interactive or JSON mode, a disabled relay returns a `RELAY_DISABLED` error; pass `--relay` to provide explicit consent. Relay pairing is end-to-end encrypted. See [Security](/docs/security).

Use it from anywhere:

```bash
byspace ls --host 'https://app.byspace.cc.cd/#offer=eyJ2IjoyLC...'
byspace run --host "$OFFER_URL" "fix the failing tests"
```

You can also set it once via `BYSPACE_HOST` instead of passing `--host` on every command.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
agent_id=$(byspace run --background --quiet --title api-agent "implement the API")
byspace wait "$agent_id"
byspace logs "$agent_id" --tail 5
```

Because Agent A's ID is present in the environment, Agent B is created as its subagent in the same workspace unless `--workspace` is specified.

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

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.byspace.cc.cd/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
