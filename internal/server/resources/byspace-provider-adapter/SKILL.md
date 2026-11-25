---
name: byspace-provider-adapter
description: Connect an AI coding agent to BySpace as a custom provider through the Agent Client Protocol (ACP). Use whenever the user asks to add, integrate, configure, or troubleshoot a non-built-in agent (anything other than Claude, Codex, OpenCode, or Pi) — Gemini CLI, Cursor, Hermes, Kimi, Kiro, Trae, a container agent, or any agent that speaks ACP over stdio. Write the canonical provider entry with the BySpace CLI, validate the launcher, and verify the connection. Prefer this over editing BySpace source.
user-invocable: true
argument-hint: "[agent name or ACP command]"
---

# BySpace Provider Adapter

Connect an agent to BySpace without touching BySpace source. BySpace ships four native adapters — Claude, Codex, OpenCode, Pi. Every other agent connects through the Agent Client Protocol (ACP): BySpace spawns the agent over stdio JSON-RPC and can host its filesystem and terminal operations. Your job is to write the canonical provider entry with the BySpace CLI and prove the negotiated protocol works.

If the user has not named an agent, ask which ACP-compatible agent they want to connect before changing configuration.

## Outcome

A working provider entry in `$BYSPACE_HOME/config.json` under `agents.providers.<id>` that:

1. launches the agent's ACP mode with the exact argv it needs,
2. preserves any environment or advanced fields the agent explicitly needs,
3. resolves on the daemon's PATH, and
4. passes the baseline ACP checks and every capability it advertises.

Most agents need zero Go code. Do not edit BySpace source, add a built-in provider, or build a plugin runtime. If an agent has no ACP mode and no bridge, say so and stop — that is the one case this skill cannot solve.

## Read before acting

Read [ACP provider config](references/acp-config.md) for the config shape, validation rules, and worked templates.

Then establish, in order:

- **The ACP command.** Find how the agent starts ACP over stdio. It is a flag (`gemini --acp`, `copilot --acp`), a subcommand (`hermes acp`, `cursor-agent acp`), or a package runner (`npx -y @google/gemini-cli --acp`). The agent's own docs or `--help` are the source of truth. Do not guess the flag.
- **The environment.** Which API key, base URL, or config directory the agent needs. Prefer the agent's own auth flow (`gemini` authenticates itself) over copying secrets into config.
- **The home.** `$BYSPACE_HOME` is the daemon home (`~/.byspace` for the packaged app, `.dev/byspace-home` for a repo dev daemon). The CLI targets it automatically; confirm with `byspace daemon status`.

Check the agent's ACP mode exists before writing config. If the agent only offers an HTTP API or a proprietary protocol with no ACP bridge, report that it cannot connect this way.

## Workflow

### 1. Write the canonical provider entry

Use the BySpace CLI, not a hand-written JSON patch:

```bash
byspace provider add acp --id <id> --label <label> -- <argv...>
```

For Antigravity's `agy` CLI, the canonical command is:

```bash
byspace provider add acp --id agy --label Antigravity -- agy acp
```

Choose an `id` matching `^[a-z][a-z0-9-]*$` that is not `claude`, `codex`, `opencode`, or `pi`. Keep the complete documented argv after `--`: `["hermes", "acp"]` launches `hermes acp`, while a package runner keeps its full tail. The writer validates the input, writes exactly `extends`, `label`, and `command`, preserves unrelated settings, and treats an identical rerun as a no-op. It rejects a conflicting existing entry rather than overwriting it.

The canonical entry is deliberately minimal. Add `env`, `params`, or explicit models afterward only when the agent's own documentation requires them; see [ACP provider config](references/acp-config.md). Preserve every sibling setting. If `config.json` is invalid, stop and report rather than overwriting it.

### 2. Reload and validate the launcher

```bash
byspace daemon reload
byspace provider diagnostic <id>
```

Reload applies the new entry without restarting the daemon. The diagnostic reports the configured command, resolved binary path, `--version` output, PATH matches, and the daemon's PATH. It proves the launcher resolves — it does **not** start an ACP session. `Resolved path: not found` means the daemon cannot see the binary; fix PATH or use an absolute path in `command[0]`. For a package runner, the version probe keeps the package spec (`npx -y pkg --version`), so it diagnoses the agent package, not just `npx`.

### 3. Verify ACP conformance

```bash
byspace provider check <id>
```

The check uses a temporary working directory and creates no BySpace agent or workspace. It verifies launch, `initialize`, `session/new`, a real text turn, assistant output, and terminal completion. It then checks images, native continuation, and model/mode/thinking selection only when the agent advertises them. Every operation prints `PASS`, `FAIL`, or `SKIP`; any failed required or advertised check makes the command exit non-zero. Preserve the native error in your report.

If the agent enters an auth or browser flow, complete it in the agent's own terms first. A failed launch usually means argv or PATH is wrong; an initialization or turn failure can also mean authentication or backend environment is missing. `SKIP` means the agent did not advertise that optional capability, not that it failed.

### 4. Report

```markdown
## Connected

- Provider `<id>` (`extends: acp`), command `[...]`
- config.json: agents.providers.<id> added/updated

## Validation

- `byspace daemon reload` — configuration applied
- `byspace provider diagnostic <id>` — resolved path, version
- `byspace provider check <id>` — baseline result and each capability's PASS/FAIL/SKIP

## Deferred

- ... and why
```

If the agent has no ACP mode, say that directly and name what would be needed (an ACP bridge), without building one.

## Guardrails

- The four built-ins are native adapters, not ACP. Do not reconfigure `claude`/`codex`/`opencode`/`pi` as ACP providers; to point one at a different binary or endpoint, use its own override fields (`command`, `env`), not `extends: "acp"`.
- This resource is read on demand. Do not install or copy it into `~/.agents/skills`, `~/.claude/skills`, or another agent skill directory. Its absolute path is on the daemon host; reading outside the workspace can require agent approval or an external-directory permission. Never bypass that approval.
- Forward only the MCP servers the user configured for this provider. Do not add BySpace source tools or a plugin bridge.
- An ACP agent runs filesystem operations itself by default; terminals run through BySpace on the host. To keep terminals inside a container or remote agent, set `params.clientCapabilities.terminal` to `false`. Delegating fs to BySpace requires `fs.readTextFile`/`fs.writeTextFile` set to `true` and shared absolute workspace paths.
- Do not copy machine-local secrets into config without explicit authorization. Prefer the agent's own auth flow.
- Never restart the production daemon on port 6777 to test a provider; use the dev daemon (`npm run dev:daemon`, port 6778) or the packaged app's own reload.
- Do not commit, push, or edit BySpace source. The deliverable is a config entry and a verified connection.
