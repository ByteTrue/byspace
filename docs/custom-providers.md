# Custom Provider Configuration

Everything beyond the four built-in providers (Claude Code, Codex, OpenCode, Pi) lives under
`agents.providers` in `$BYSPACE_HOME/config.json` (typically `~/.byspace/config.json`). You can point
a built-in provider at a different API backend, add ACP agents, override the launch binary, disable
a provider, or run several profiles against the same underlying provider.

```json
{
  "version": 1,
  "agents": {
    "providers": {
      "provider-id": {}
    }
  }
}
```

Provider IDs must match `/^[a-z][a-z0-9-]*$/`. Every custom entry needs `extends` (a built-in
provider ID or `"acp"`) and a `label`; an entry extending `"acp"` also needs `command`. Run
`byspace reload` after editing — provider changes apply to future launches without restarting the
daemon.

For the contract a provider adapter must keep, see [providers.md](providers.md).

## Table of Contents

- [Extending a built-in provider](#extending-a-built-in-provider)
- [Third-party Anthropic-compatible endpoints](#third-party-anthropic-compatible-endpoints)
- [Codex with a custom OpenAI-compatible endpoint](#codex-with-a-custom-openai-compatible-endpoint)
- [Multiple profiles](#multiple-profiles)
- [Custom binary](#custom-binary)
- [Disabling a provider](#disabling-a-provider)
- [ACP providers](#acp-providers)
- [Models and thinking options](#models-and-thinking-options)
- [Provider override reference](#provider-override-reference)

## Extending a built-in provider

`extends` creates a new entry that inherits a built-in provider's protocol and launch behavior,
with its own label, environment, and models. Point `env` at a different backend:

```json
{
  "agents": {
    "providers": {
      "my-claude": {
        "extends": "claude",
        "label": "My Claude",
        "description": "Claude with custom API endpoint",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-...",
          "ANTHROPIC_BASE_URL": "https://my-proxy.example.com/v1"
        }
      }
    }
  }
}
```

The provider `env` is the baseline for the agent process; a per-agent env rides on top of it.
Valid `extends` values: `claude`, `codex`, `opencode`, `pi`, and `acp`.

## Third-party Anthropic-compatible endpoints

Several vendors expose their own models through an Anthropic-compatible API, so Claude Code can
drive them by pointing `ANTHROPIC_BASE_URL` at the vendor and supplying the vendor's key. These are
**not** Anthropic Claude models. They share one shape: `extends: "claude"`, the vendor endpoint and
auth env, an explicit `models` list, and `disallowedTools: ["WebSearch"]`.

| Vendor                                                                                                | `ANTHROPIC_BASE_URL`                                        | Auth env                                                      | Models                                             |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| [Z.AI (Zhipu)](https://z.ai)                                                                          | `https://api.z.ai/api/anthropic`                            | `ANTHROPIC_AUTH_TOKEN` (the Z.AI key)                         | `glm-5.1`, `glm-5-turbo`, `glm-4.7`, `glm-4.5-air` |
| [Alibaba Qwen coding plan](https://www.alibabacloud.com/help/en/model-studio/claude-code-coding-plan) | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` | `ANTHROPIC_AUTH_TOKEN` (plan key `sk-sp-…`, Singapore region) | `qwen3.5-plus`, `qwen3-coder-next`, `kimi-k2.5`    |

Qwen pay-as-you-go (no subscription) uses `https://dashscope-intl.aliyuncs.com/apps/anthropic` with
`ANTHROPIC_API_KEY` (a standard `sk-…` Model Studio key) instead of `ANTHROPIC_AUTH_TOKEN`.

Worked example (Z.AI):

```json
{
  "agents": {
    "providers": {
      "zai": {
        "extends": "claude",
        "label": "ZAI",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "<your-zai-api-key>",
          "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
          "API_TIMEOUT_MS": "3000000"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "glm-5-turbo", "label": "GLM 5 Turbo", "isDefault": true },
          { "id": "glm-5.1", "label": "GLM 5.1" }
        ]
      }
    }
  }
}
```

`API_TIMEOUT_MS` extends the request timeout — these endpoints can be slower than direct Anthropic.
If you get auth errors after switching, run `/logout` inside Claude Code first.

**Why `disallowedTools: ["WebSearch"]`.** `WebSearch` is an Anthropic-only server-side tool; a
third-party endpoint rejects it. `disallowedTools` reaches Claude Code as `--disallowedTools` deny
rules, which drop the named tools from the model's context. List any tool the endpoint does not
support.

## Codex with a custom OpenAI-compatible endpoint

Codex talks to OpenAI's Responses API. A provider extending `"codex"` can point it at any
OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM, an internal gateway) through `env`. BySpace
passes those variables through to the Codex app-server process; it does not rewrite Codex's own
config files.

```json
{
  "agents": {
    "providers": {
      "my-codex": {
        "extends": "codex",
        "label": "My Codex",
        "env": {
          "OPENAI_API_KEY": "sk-...",
          "OPENAI_BASE_URL": "https://custom-relay.example.com"
        },
        "models": [{ "id": "custom-model", "label": "Custom Model", "isDefault": true }]
      }
    }
  }
}
```

- The endpoint must speak the OpenAI **Responses API**, not just chat completions.
- Set `models` explicitly. BySpace does not discover a custom Codex endpoint's model IDs.
- To run several endpoints side by side, define multiple entries extending `"codex"` with different
  IDs, labels, and env.
- To override only the binary (a nightly build) without changing the endpoint, omit
  `OPENAI_BASE_URL` and use `command` — see [Custom binary](#custom-binary).

## Multiple profiles

Create as many entries as you want against the same built-in provider. Each appears as a separate
option in the app with its own credentials and models:

```json
{
  "agents": {
    "providers": {
      "claude-work": {
        "extends": "claude",
        "label": "Claude (Work)",
        "env": { "ANTHROPIC_API_KEY": "sk-ant-work-..." }
      },
      "claude-personal": {
        "extends": "claude",
        "label": "Claude (Personal)",
        "env": { "ANTHROPIC_API_KEY": "sk-ant-personal-..." }
      }
    }
  }
}
```

A "profile" here is a provider alias — not an **Agent profile** (a named bundle of provider, model,
mode, thinking option, and features under `daemon.agentProfiles`). See [glossary.md](glossary.md)
for the four senses of the word. Combine aliases with `models` to pin a model per profile.

## Custom binary

`command` is an array — first element is the binary, the rest are arguments. It fully replaces the
default launch command for that provider, built-in or derived:

```json
{
  "agents": {
    "providers": {
      "claude": { "command": ["/opt/claude-nightly/claude"] },
      "my-codex": {
        "extends": "codex",
        "label": "Codex (Custom Build)",
        "command": ["/home/user/codex-dev/target/release/codex"]
      }
    }
  }
}
```

The binary must exist on the system; BySpace marks the provider unavailable if it cannot resolve it.
A `<PROVIDER>_COMMAND` environment variable overrides the configured binary at launch.

### Pi-compatible forks

A fork that keeps Pi's `--mode rpc` API extends `pi` and replaces the command:

```json
{
  "agents": {
    "providers": {
      "my-pi-fork": {
        "extends": "pi",
        "label": "My Pi Fork",
        "command": ["my-pi-fork"]
      }
    }
  }
}
```

Launching and resuming go through the configured command (`my-pi-fork --mode rpc --session <file>`).
BySpace reads the fork's session list from the fork's own `settings.json` `sessionDir` (project-local
`.pi/settings.json` first, then the global agent dir), falling back to the default sessions directory.

## Disabling a provider

`enabled: false` hides a provider from the app and CLI. It works for built-in and custom entries;
all built-in providers are enabled by default. Set `enabled: true` or remove the field to re-enable.

```json
{
  "agents": {
    "providers": {
      "codex": { "enabled": false }
    }
  }
}
```

## ACP providers

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) is an open standard for editors
talking to AI coding agents — think LSP for agents. Any agent that speaks ACP over JSON-RPC 2.0 on
stdio can be added with `extends: "acp"`.

BySpace ships an in-app ACP catalog (Settings → Agents → Add provider) for common agents — Copilot,
Cursor, Gemini CLI, Hermes, Kimi, Kiro, Qwen Code, and more. A catalog entry creates exactly the
config below; use the catalog first and only hand-write an entry for an agent it does not list. The
bundled `byspace-provider-adapter` skill walks an agent through connecting one.

### Adding a generic ACP provider

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

The whole `command` argv matters: the first element is the launcher, the rest are passed verbatim.
An ACP flag can be a flag (`gemini --acp`), a subcommand (`hermes acp`), or a package runner
(`npx -y @google/gemini-cli --acp`).

When you launch an ACP agent, BySpace spawns the process, sends an `initialize` JSON-RPC request,
and the agent reports its capabilities, modes, and models at runtime. Prompts, streamed responses,
tool calls, and permission requests flow over stdin/stdout. Permission requests surface in BySpace
as confirm prompts for you to answer.

**BySpace tools do not reach an ACP agent.** The daemon gives ACP sessions an empty `mcpServers`
array, and the bundled skill is only readable if the client reads `~/.agents/skills` or
`~/.claude/skills`. Copy the skill into that client's own skill directory to give it the CLI, and
accept that a client started this way has no `BYSPACE_AGENT_ID` of its own.

### Client capabilities

By default an ACP agent runs filesystem operations in its own environment while terminal operations
run through BySpace on the host. `params.clientCapabilities` changes which operations BySpace
handles:

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

Set `terminal: false` for an agent that manages its own terminal (a container or remote environment)
so command execution stays inside it. When delegating filesystem operations to BySpace
(`fs.readTextFile` / `fs.writeTextFile` true), the agent and BySpace must share equivalent absolute
workspace paths. Overrides are partial — only the flags you name change.

### Diagnostics

`byspace provider diagnostic <id>` reports the configured command, the resolved launcher binary, its
`--version` output, PATH matches, and the daemon's PATH. It resolves the command the way launch does
(a `<PROVIDER>_COMMAND` env var beats the configured binary), so a provider installed where the
daemon cannot see it shows `Resolved path: not found`. For a package-runner command the version
probe keeps the package spec (`npx -y @google/gemini-cli --version`), diagnosing the agent package
rather than just proving `npx` exists.

The diagnostic does **not** start an ACP session — it proves the launcher resolves and reports a
version, not that the agent answers `initialize`. To check the protocol end to end, create an agent
on the provider (`byspace run --provider <id> "Say hello"`) and send a message.

### Examples

Gemini CLI (`--acp` flag) and Hermes (`acp` subcommand):

```json
{
  "agents": {
    "providers": {
      "gemini": { "extends": "acp", "label": "Google Gemini", "command": ["gemini", "--acp"] },
      "hermes": { "extends": "acp", "label": "Hermes", "command": ["hermes", "acp"] }
    }
  }
}
```

Install Gemini CLI with `npm install -g @google/gemini-cli` (it handles its own Google auth). Install
Hermes per its [docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) and
configure credentials in `~/.hermes/`.

## Models and thinking options

`models` replaces the model list outright — a fixed list works even when the provider is not
installed. `additionalModels` merges on top of the runtime-discovered list (or on top of `models`
when both are set): a new `id` is appended, an existing `id` is updated in place, and an addition
marked `isDefault` demotes every other default. Use `additionalModels` to add or relabel a few
entries without redeclaring the whole list:

```json
{
  "agents": {
    "providers": {
      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"],
        "additionalModels": [
          { "id": "experimental-model", "label": "Experimental", "isDefault": true },
          { "id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro (preferred)" }
        ]
      }
    }
  }
}
```

### Claude settings.json model discovery

The built-in `claude` provider appends concrete model IDs from `~/.claude/settings.json` (or
`$CLAUDE_CONFIG_DIR/settings.json`) to its first-party list, in picker order: `modelPicker.options`
first, then the top-level `model`, then these `env` keys — `ANTHROPIC_MODEL`,
`ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`,
`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`.

This lets a user who already configured Claude Code for Bedrock, OpenRouter, ollama, Z.AI, or another
gateway select the exact model ID in BySpace. Explicit IDs pass through unchanged, even when the
string is a compatibility alias for a built-in model. Setting `agents.providers.claude.models`
**replaces** both the first-party list and any settings-discovered entries; use `additionalModels`
to keep them and append curated entries.

## Provider override reference

Every entry under `agents.providers` accepts these fields:

| Field              | Type                      | Required     | Description                                                        |
| ------------------ | ------------------------- | ------------ | ------------------------------------------------------------------ |
| `extends`          | `string`                  | Yes (custom) | Built-in provider ID to inherit, or `"acp"`                        |
| `label`            | `string`                  | Yes (custom) | Display name in the UI                                             |
| `description`      | `string`                  | No           | Short description shown in the UI                                  |
| `command`          | `string[]`                | Yes (ACP)    | Launcher argv; first element is the binary, rest passed verbatim   |
| `env`              | `Record<string, string>`  | No           | Environment for the agent process (baseline beneath per-agent env) |
| `params`           | `Record<string, unknown>` | No           | Provider-specific options; ACP reads `clientCapabilities`          |
| `models`           | `ProviderProfileModel[]`  | No           | Static model list (replaces runtime discovery)                     |
| `additionalModels` | `ProviderProfileModel[]`  | No           | Model additions merged with discovery or `models`                  |
| `disallowedTools`  | `string[]`                | No           | Tool deny rules for Claude Code (e.g. `["WebSearch"]`)             |
| `enabled`          | `boolean`                 | No           | `false` hides the provider (default `true`)                        |

### Model definition

Each entry in `models` / `additionalModels`:

| Field             | Type               | Required | Description                           |
| ----------------- | ------------------ | -------- | ------------------------------------- |
| `id`              | `string`           | Yes      | Model identifier sent to the provider |
| `label`           | `string`           | Yes      | Display name in the UI                |
| `description`     | `string`           | No       | Short description                     |
| `isDefault`       | `boolean`          | No       | Mark as the default model selection   |
| `thinkingOptions` | `ThinkingOption[]` | No       | Available thinking/reasoning levels   |

### Thinking option

| Field         | Type      | Required | Description                         |
| ------------- | --------- | -------- | ----------------------------------- |
| `id`          | `string`  | Yes      | Thinking option identifier          |
| `label`       | `string`  | Yes      | Display name                        |
| `description` | `string`  | No       | Short description                   |
| `isDefault`   | `boolean` | No       | Mark as the default thinking option |
