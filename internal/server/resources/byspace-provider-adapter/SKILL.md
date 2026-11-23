---
name: byspace-provider-adapter
description: Connect an AI coding agent to BySpace as a custom provider through the Agent Client Protocol (ACP). Use whenever the user asks to add, integrate, configure, or troubleshoot a non-built-in agent (anything other than Claude, Codex, OpenCode, or Pi) — Gemini CLI, Cursor, Hermes, Kimi, Kiro, Trae, a container agent, or any agent that speaks ACP over stdio. Produce the config.json provider entry, validate the launcher, and verify the connection. Prefer this over editing BySpace source.
user-invocable: true
argument-hint: "[agent name or ACP command]"
---

# BySpace Provider Adapter

Connect an agent to BySpace without touching BySpace source. BySpace ships four native adapters — Claude, Codex, OpenCode, Pi. Every other agent connects through the Agent Client Protocol (ACP): BySpace spawns the agent over stdio JSON-RPC and hosts its filesystem and terminal operations. Your job is to produce a correct `config.json` provider entry and prove it launches.

If the user has not named an agent, ask which ACP-compatible agent they want to connect before changing configuration.

## Outcome

A working provider entry in `$BYSPACE_HOME/config.json` under `agents.providers.<id>` that:

1. launches the agent's ACP mode with the exact argv it needs,
2. carries the environment the agent needs to reach its backend,
3. resolves on the daemon's PATH, and
4. answers a real message end to end.

Most agents need zero Go code. Do not edit BySpace source, add a built-in provider, or build a plugin runtime. If an agent has no ACP mode and no bridge, say so and stop — that is the one case this skill cannot solve.

## Read before acting

Read [ACP provider config](references/acp-config.md) for the config shape, validation rules, and worked templates.

Then establish, in order:

- **The ACP command.** Find how the agent starts ACP over stdio. It is a flag (`gemini --acp`, `copilot --acp`), a subcommand (`hermes acp`, `cursor-agent acp`), or a package runner (`npx -y @google/gemini-cli --acp`). The agent's own docs or `--help` are the source of truth. Do not guess the flag.
- **The environment.** Which API key, base URL, or config directory the agent needs. Prefer the agent's own auth flow (`gemini` authenticates itself) over copying secrets into config.
- **The home.** `$BYSPACE_HOME` is the daemon home (`~/.byspace` for the packaged app, `.dev/byspace-home` for a repo dev daemon). The CLI targets it automatically; confirm with `byspace daemon status`.

Check the agent's ACP mode exists before writing config. If the agent only offers an HTTP API or a proprietary protocol with no ACP bridge, report that it cannot connect this way.

## Workflow

### 1. Build the provider entry

The entry lives at `agents.providers.<id>` in `config.json`:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent-binary", "--acp"],
        "env": { "MY_API_KEY": "..." }
      }
    }
  }
}
```

Rules that the config schema enforces (a violation is rejected on load):

- `id` matches `^[a-z][a-z0-9-]*$` and is not a built-in (`claude`, `codex`, `opencode`, `pi`).
- `extends: "acp"` and a non-empty `label` are required.
- `command` is a non-empty array of strings. **The whole argv matters**: `command[0]` is the binary, the rest are passed verbatim to the agent. `["hermes", "acp"]` launches `hermes acp`, not `hermes --acp`. A package runner keeps its full tail: `["npx", "-y", "pkg", "--acp"]`.
- `env` values are strings; they reach the agent process beneath any per-agent env.

Merge into the existing `agents.providers` map. Never replace unrelated provider entries. If `config.json` is invalid, stop and report rather than overwriting it.

### 2. Validate the launcher

```bash
byspace provider diagnostic <id>
```

This reports the configured command, the resolved binary path, its `--version` output, PATH matches, and the daemon's PATH. It proves the launcher resolves — it does **not** start an ACP session. `Resolved path: not found` means the daemon cannot see the binary; fix PATH or use an absolute path in `command[0]`. For a package runner, the version probe keeps the package spec (`npx -y pkg --version`), so it diagnoses the agent package, not just `npx`.

Reload config without restarting:

```bash
byspace daemon reload
```

### 3. Verify end to end

Create an agent on the provider and send a message — that is the only check that proves the ACP handshake (`initialize` + `session/new`) and a real turn:

```bash
byspace provider models <id>              # the agent's model list, if it exposes one
byspace run --provider <id> "Say hello"   # starts an agent and waits for the turn
```

If the agent enters an auth or browser flow, complete it in the agent's own terms first. A turn that never finishes usually means the command argv is wrong (step 2) or the backend env is missing (step 2 `env`).

### 4. Report

```markdown
## Connected

- Provider `<id>` (`extends: acp`), command `[...]`
- config.json: agents.providers.<id> added/updated

## Validation

- `byspace provider diagnostic <id>` — resolved path, version
- `byspace run --provider <id> "..."` — turn result

## Deferred

- ... and why
```

If the agent has no ACP mode, say that directly and name what would be needed (an ACP bridge), without building one.

## Guardrails

- The four built-ins are native adapters, not ACP. Do not reconfigure `claude`/`codex`/`opencode`/`pi` as ACP providers; to point one at a different binary or endpoint, use its own override fields (`command`, `env`), not `extends: "acp"`.
- This resource is read on demand. Do not install or copy it into `~/.agents/skills`, `~/.claude/skills`, or another agent skill directory. Its absolute path is on the daemon host; reading outside the workspace can require agent approval or an external-directory permission. Never bypass that approval.
- Forward only the MCP servers the user configured for this provider. Do not add BySpace source tools or a plugin bridge.
- An ACP agent runs filesystem operations itself by default; terminals run through BySpace on the host. To keep operations inside a container or remote agent, set `params.clientCapabilities` (`fs.readTextFile`/`fs.writeTextFile`/`terminal` to `false`). Delegating fs to BySpace requires shared absolute workspace paths.
- Do not copy machine-local secrets into config without explicit authorization. Prefer the agent's own auth flow.
- Never restart the production daemon on port 6777 to test a provider; use the dev daemon (`npm run dev:daemon`, port 6778) or the packaged app's own reload.
- Do not commit, push, or edit BySpace source. The deliverable is a config entry and a verified connection.
