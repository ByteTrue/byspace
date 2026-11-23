# ACP provider config

The contract for connecting an agent to BySpace through the Agent Client Protocol. BySpace spawns the agent over stdio JSON-RPC 2.0 and hosts its filesystem and terminal operations.

## Where the entry lives

`$BYSPACE_HOME/config.json`, under `agents.providers.<id>`. The daemon reads this nested shape; a flat top-level `providers` map is lifted into the same place on load. Merge into the existing map — never replace unrelated entries.

## Fields

| Field                         | Required  | Meaning                                                                                                                                                                        |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extends`                     | yes       | `"acp"` for a generic ACP agent. A built-in id (`claude`/`codex`/`opencode`/`pi`) inherits that native runtime instead — only use it for a fork that speaks the same protocol. |
| `label`                       | yes       | Display name in the provider picker.                                                                                                                                           |
| `command`                     | yes (ACP) | Array of strings. `command[0]` is the binary; the rest are passed verbatim. The whole argv is the launch command.                                                              |
| `description`                 | no        | One line shown under the label.                                                                                                                                                |
| `env`                         | no        | String map. Reaches the agent process beneath any per-agent env. API keys, base URLs.                                                                                          |
| `params.clientCapabilities`   | no        | Which operations BySpace hosts. See below.                                                                                                                                     |
| `models` / `additionalModels` | no        | Override or extend the agent's model list.                                                                                                                                     |
| `enabled`                     | no        | `false` hides the provider without deleting it.                                                                                                                                |
| `order`                       | no        | Sort position in the picker.                                                                                                                                                   |

Validation rules (rejected on load if violated):

- `id` matches `^[a-z][a-z0-9-]*$`; it cannot be a built-in id.
- A non-built-in provider needs `extends` and `label`.
- `extends: "acp"` needs a non-empty `command` array of non-empty strings.

## The command argv is the whole launch

The generic ACP spec defaults to `--acp`, but a configured `command` replaces that default with its own tail. Get the tail right or the agent starts with the wrong arguments and never answers `initialize`:

| Agent style    | `command`                                      | Launches                          |
| -------------- | ---------------------------------------------- | --------------------------------- |
| Flag           | `["gemini", "--acp"]`                          | `gemini --acp`                    |
| Flag           | `["copilot", "--acp"]`                         | `copilot --acp`                   |
| Subcommand     | `["hermes", "acp"]`                            | `hermes acp`                      |
| Subcommand     | `["cursor-agent", "acp"]`                      | `cursor-agent acp`                |
| Package runner | `["npx", "-y", "@google/gemini-cli", "--acp"]` | `npx -y @google/gemini-cli --acp` |

A bare binary (`["my-agent"]`) launches with no arguments — correct only if the agent enters ACP mode by default.

## Environment

`env` is the baseline the agent needs to reach its backend. It is applied beneath the per-agent env (the per-agent value wins on a collision), and the BySpace identity variables (`BYSPACE_HOME`, `BYSPACE_HOST`, `BYSPACE_AGENT_ID`) are applied last so neither layer can rename the agent.

Prefer the agent's own auth flow over copying secrets. Gemini CLI authenticates itself; Hermes reads `~/.hermes/`. Only put a key in `env` when the agent has no other way to receive it, and only with the user's authorization.

## Client capabilities

By default BySpace advertises that it hosts filesystem reads/writes and terminals: the agent delegates those operations to the daemon. An agent that manages its own environment (a container, a remote box) overrides this so it keeps the operations to itself:

```json
"params": {
  "clientCapabilities": {
    "fs": { "readTextFile": false, "writeTextFile": false },
    "terminal": false
  }
}
```

Each flag defaults to `true`; a partial override changes only the named flags. Delegating fs to BySpace (`readTextFile`/`writeTextFile: true`) requires the agent and the daemon to share equivalent absolute workspace paths.

## Worked templates

### Flag-style agent (Gemini CLI)

```json
{
  "agents": {
    "providers": {
      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"]
      }
    }
  }
}
```

Install `npm install -g @google/gemini-cli`, authenticate with Google, then add the entry. No `env` needed — the CLI handles its own auth.

### Subcommand agent (Hermes)

```json
{
  "agents": {
    "providers": {
      "hermes": {
        "extends": "acp",
        "label": "Hermes",
        "command": ["hermes", "acp"]
      }
    }
  }
}
```

Install Hermes and its ACP extra (`pip install -e '.[acp]'`), configure credentials in `~/.hermes/`, then add the entry.

### Package-runner agent

```json
{
  "agents": {
    "providers": {
      "gemini-npx": {
        "extends": "acp",
        "label": "Gemini (npx)",
        "command": ["npx", "-y", "@google/gemini-cli", "--acp"]
      }
    }
  }
}
```

The version probe keeps the package spec (`npx -y @google/gemini-cli --version`), so the diagnostic checks the agent package, not just `npx`.

### Container agent (keeps its own fs and terminal)

```json
{
  "agents": {
    "providers": {
      "container-agent": {
        "extends": "acp",
        "label": "Container Agent",
        "command": ["container-agent", "acp"],
        "params": {
          "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false
          }
        }
      }
    }
  }
}
```

## Validate

```bash
byspace provider diagnostic <id>   # command, resolved path, version, PATH — not an ACP session
byspace daemon reload              # apply config without restarting
byspace provider models <id>       # model list, if the agent exposes one
byspace run --provider <id> "Say hello"   # the only end-to-end proof: initialize + session/new + a turn
```

`Resolved path: not found` means the daemon cannot see the binary — fix PATH or use an absolute path in `command[0]`. A `<PROVIDER>_COMMAND` environment variable beats the configured binary (e.g. `GEMINI_COMMAND`).

## What BySpace does not give an ACP agent

- BySpace tools: the daemon hands ACP sessions an empty `mcpServers` array. The bundled BySpace skill is only usable if the agent reads `~/.agents/skills` or `~/.claude/skills`.
- A native protocol: ACP is the transport. An agent with only an HTTP API or a proprietary protocol and no ACP bridge cannot connect this way.
