# Providers

BySpace launches coding agents through a small set of built-in providers and a generic ACP host for
everything else. This doc covers how providers are wired, what the daemon can send each one, and the
contracts an adapter must keep. To configure your own provider, see [custom-providers.md](custom-providers.md).

## Built-in providers and the ACP host

Four providers are built in, each with a native adapter under `internal/agent/providers/`:

| Provider   | Protocol        | Adapter              | Launch                                    |
| ---------- | --------------- | -------------------- | ----------------------------------------- |
| `claude`   | `claude-stream` | `claude.go`          | `claude -p --output-format stream-json …` |
| `codex`    | `codex-rpc`     | `codex.go`           | `codex app-server`                        |
| `opencode` | `opencode-http` | `opencode.go`        | `opencode serve`                          |
| `pi`       | `pi-rpc`        | `internal/agent/pi/` | `pi --mode rpc --approve`                 |

Every other agent — GitHub Copilot, Cursor, Kimi, Kiro, Trae, and any ACP-compatible binary — connects
through the generic ACP host (`acp.go`), not a built-in adapter. There are two ways in:

- **Copy setup prompt** (Settings → Agents → Add provider): copies a prompt whose absolute guide
  path points into `$BYSPACE_HOME/resources/byspace-provider-adapter`. An agent reads that guide
  on demand and uses the canonical CLI writer; BySpace does not install it as a skill.
- **Canonical CLI**: `byspace provider add acp --id <id> --label <label> -- <argv...>` writes the
  minimal entry, and `byspace provider check <id>` verifies the negotiated protocol. Advanced manual
  fields remain available. See [custom-providers.md](custom-providers.md#adding-a-generic-acp-provider).

`GetProviderSpec` (`internal/agent/providers/driver.go`) resolves a provider id: a built-in returns its
`ProviderSpec`; anything else falls through to a generic ACP spec (`Protocol: "acp"`,
`DefaultArgs: ["--acp"]`). A custom provider's `command` overrides the binary and args. The dev-only
`mock` provider registers only when `BYSPACE_NODE_ENV=development`, so the end-to-end specs have
something that streams deterministically without a model; a packaged install never lists it.

The built-in list is mirrored in `packages/protocol/src/provider-manifest.ts`
(`AGENT_PROVIDER_DEFINITIONS`) for UI scaffolding (labels, mode icons, color tiers). The runtime values
the agent process reports are the source of truth; the manifest is not a capability gate.

## What the daemon can send each provider

Each provider has its own channel for the settings the app exposes, and a channel that does not exist
fails silently: the record changes, the UI shows the new value, and the provider keeps its default.
This table is the inventory. When adding a provider, fill a row; when adding a setting, fill a column.

|          | Model                             | Mode                                          | Thinking                   | System prompt                                                                                | Output schema               | Fast                       |
| -------- | --------------------------------- | --------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------- | -------------------------- |
| Claude   | `--model`                         | `--permission-mode`                           | `--effort` (low..max only) | `--append-system-prompt`                                                                     | refused                     | `--settings` fastMode      |
| Codex    | `thread/start` + `turn/start`     | `turn/start` `approvalPolicy`/`sandboxPolicy` | `turn/start` `effort`      | `collaborationMode` settings; `turn/start` `developerInstructions` when no mode is available | `turn/start` `outputSchema` | `turn/start` `serviceTier` |
| Pi       | `--model`                         | — (no mode list)                              | `--thinking`               | generated extension                                                                          | refused                     | —                          |
| OpenCode | message `model`                   | message `agent`                               | message `variant`          | not sent                                                                                     | message `format`            | —                          |
| ACP      | `session/set_config_option` model | `session/set_config_option` mode              | `thought_level`            | not sent                                                                                     | refused                     | —                          |

Usage: every provider reports token accounting, which feeds the composer's context ring. Claude's
"used" is the whole prompt (fresh input plus both cache buckets), OpenCode's is the sum of every bucket
in the step, Codex reports the last request directly, and ACP returns it once per turn on the prompt
result.

A per-agent `env` is handed to the provider process (Claude, Pi, Codex, ACP). OpenCode cannot take one:
it drives a shared `opencode serve`, so the environment is the daemon's own — and that is also the one
provider where `BYSPACE_AGENT_ID` is missing. The BySpace identity variables are applied last, so an
agent cannot rename itself through `env`.

"refused" means the daemon fails the request instead of running the turn without it: a caller that
asked for a JSON object and got prose would parse garbage.

A mode is a launch flag on the Claude CLI, so Claude cannot change mode mid-session; Codex, OpenCode
and ACP apply it on the next turn. Claude and Pi read model and thinking once at launch: Pi has RPC
setters and applies them, Claude refuses the change and says to restart the agent rather than recording
a value the process does not use. Codex carries `plan_mode` and the system prompt the same way, in
`collaborationMode.settings.developer_instructions`.

## Provider-native session options

`AgentSessionConfig.providerOptions` carries JSON-safe configuration for the selected provider. The
names and nesting are the provider's native contract; options are not portable between providers.
BySpace passes the object through to the provider adapter without a per-provider schema check — an
unknown key is the provider's to accept or reject, not BySpace's. BySpace-owned controls such as cwd,
model, prompt, environment, session identity, MCP transport, callbacks, and hooks are separate fields,
not keys inside `providerOptions`.

How each adapter consumes the options:

- **Codex:** passed verbatim into the `config` object of `thread/start` / `thread/resume`, so Codex
  reads its own native keys: `approval_policy`, `sandbox_mode`,
  `sandbox_workspace_write.{writable_roots,network_access,exclude_slash_tmp,exclude_tmpdir_env_var}`,
  `web_search`, `features.multi_agent_v2`, and `features.network_proxy`. See the
  [Codex configuration reference](https://developers.openai.com/codex/config-reference).
- **Claude:** mapped to launch flags and a merged `--settings` JSON. `allowedTools` →
  `--allowedTools`, `additionalDirectories` → `--add-dir`, and `disallowedTools` → `--disallowedTools`
  (merged with the provider entry's `disallowedTools`, duplicates dropped). `settings` and `sandbox`
  are nested objects the Claude CLI consumes itself, so they merge into `--settings` rather than being
  mapped field by field. See the [Claude settings reference](https://code.claude.com/docs/en/settings).
- **OpenCode:** `providerOptions` is not forwarded. OpenCode permissions are application policy set in
  OpenCode's own config (`opencode.json`), not a per-session parameter the HTTP API accepts, so configure
  them there. See the [OpenCode permissions reference](https://opencode.ai/docs/permissions/).

## Provider-specific notes

### Claude

First-party model metadata lives in `internal/agent/providers/claudemodels.go`. When adding or updating
a Claude model, update that manifest only; the model picker thinking options and Claude-specific feature
gates are derived from it. Do not add model-specific Claude capability lists in feature code.

Claude's catalog also includes every model named in the user's Claude Code `settings.json`:
`modelPicker.options`, `model`, and `env.ANTHROPIC_*_MODEL`. That is how third-party gateways (Z.AI, a
local router) are selected, and why the daemon must not ship only the Anthropic manifest.

### Pi

Pi is process-backed: BySpace requires the `pi` binary and talks to it through `pi --mode rpc`; the
daemon does not embed Pi's SDK/runtime packages.

BySpace's per-agent and daemon-wide system prompts are appended by its generated Pi integration
extension (`pi.WriteIntegrationExtension`). BySpace deliberately does not pass
`--append-system-prompt`, because that flag replaces Pi's automatic `APPEND_SYSTEM.md` discovery
instead of composing with it. The extension is also what makes rewind possible: pi exposes entry
capture and tree navigation only through extensions.

Pi model records expose input capabilities through `model.input`. Only send raw RPC `images` when the
current model explicitly includes `"image"` in that list. Text-only Pi models reject image content and
persist the rejected image in JSONL history, so image prompts for those models must be materialized to
a local file and passed as a text path hint instead.

Pi thinking options come from each RPC model's `thinkingLevelMap`, not from a provider-wide list. Match
Pi's capability rules: `off` through `high` are available unless mapped to `null`, while `xhigh` and
`max` are opt-in and appear only when explicitly mapped.

Pi's MCP support is built in, so BySpace registers the user's own servers from its generated integration
extension with `pi.registerMcpServer(name, config)` instead of writing an MCP file or passing
`--mcp-config`. BySpace no longer registers a server of its own. Each registration gets its own
`try`/`catch`: Pi throws on server names it does not allow, on names another extension already owns, and
on two names that collide in the same tool namespace (`a-b` and `a_b`), and a rejected server must not
take down the extension's entry-capture and tree bridges. Rejected registrations are reported as warning
notifications on the agent, and so is a session where nothing connected the registered servers.

Nothing forces Pi to connect them: an extension that claims the `mcp` command replaces the built-in MCP
support, and the built-in extension can be disabled in `pi config`. In either case `registerMcpServer`
still succeeds and Pi reports the registration as an extension error, so the BySpace extension also
checks `getCommands()` for a command whose `sourceInfo.path` is `builtin:mcp` on `session_start` and
warns when it is absent.

Send only `{ command, args?, env? }` or `{ url, headers? }`; Pi's validator rejects `auth` and `oauth`
unless they are objects. BySpace sets no `exposure` or `toolExposure`, so a server keeps Pi's default and
`alwaysLoad` does nothing on Pi. An `<Pi agent dir>/mcp.json` entry of the same name still takes
precedence over the registration. There is no `pi-mcp-adapter` probe: `supportsMcpServers` is a static
Pi capability.

BySpace waits up to 60 seconds for Pi to finish its startup sequence (`readyTimeout`,
`internal/agent/pi/pi.go`); a cold start with several extensions loading takes a moment. This bound
is fixed, not a per-RPC deadline, and does not govern long-running Pi compaction or extension UI
results.

Pi import discovery reads Pi's persisted JSONL session files because Pi RPC does not expose a
recent-session listing command. Resume and full history hydration still go through `pi --mode rpc` using
the session file as `nativeHandle`.

Pi subagents surface through the shared provider-subagents channel (`agent.provider_subagents.*`). The
session collects them from its own event stream: a finished tool call whose name starts with `subagent`
carries the descriptor (`ParseSubagentDetails`, `internal/agent/pi/pi.go`), and the child's read-only
timeline is a tail of the session JSONL it names. There is no side channel: nothing POSTs snapshots to the
daemon, so a subagent whose events never reached the stream is simply absent until replay rebuilds it from
the transcript.

Pi RPC extension UI dialog requests (`select`, `input`, `editor`, `confirm`) are bridged into BySpace
question permissions and answered with `extension_ui_response`. Pi extensions such as `ask_user` may chain
dialogs: a `select` can be followed by an optional-comment `input`. When an `ask_user` tool call declares
`allowComment: true`, BySpace presents the selection and optional comment as one question permission,
answers Pi's initial `select` immediately, then auto-answers the follow-up optional `input` with the
comment the user already supplied (or an empty string). Preserve placeholders and optional/skip semantics
for standalone optional inputs so the app can still distinguish "skip this optional input" from "cancel
the whole dialog." Fire-and-forget extension UI requests such as notifications become timeline
notifications; the extension's `notifyType` maps to the timeline level and an unknown value falls back to
`info`.

### OpenCode

OpenCode has no reliable static catalog. The daemon asks `opencode models` in the workspace and offers
what OpenCode reports, because its provider list depends on the user's own config and credentials; the
spec list is only a fallback when the command is unavailable. The command prints ids only, so labels come
from the id and thinking variants are not offered; use OpenCode's server model listing when those become
required.

OpenCode keeps the process environment outside the session boundary. The Go daemon starts or reuses one
`opencode serve` and drives it over HTTP (`internal/agent/providers/opencodepool.go`); session
configuration, including `mcpServers`, arrives per session, but the environment does not. An OpenCode agent
therefore inherits the daemon's environment: `byspace` works only if the daemon's own `PATH` and
`BYSPACE_HOME` reach it, and `BYSPACE_AGENT_ID` names no agent. Configure custom MCP with `mcp.add`; do not
follow it with `mcp.connect`, which only toggles config-backed servers.

OpenCode owns user message IDs. Do not pass BySpace-generated IDs to OpenCode prompt APIs; let OpenCode
create `msg*` IDs and record the user timeline item from the `message.updated` event.

### ACP

ACP agents communicate over JSON-RPC 2.0 on stdio. BySpace spawns the agent process and talks to it
through stdin/stdout (`acp.go`). ACP permission options are rendered as ordered actions and BySpace
returns the selected option's exact `optionId`. Agents can therefore encode a single-choice question as
multiple options of the same allow kind. Auto-accept does not resolve those chooser requests; they always
wait for the user.

Some ACP agents expose custom agents through session config rather than the slash-command list: a select
config option with `id: "agent"` and `category: "_agent"`. BySpace maps that to the `agent` provider
feature, using the display name as the option value; the blank value means the agent's default.

BySpace tools do not reach an ACP agent automatically. The daemon forwards configured MCP servers
but does not inject its own MCP server or install the ACP onboarding template as a skill. ACP agents
execute filesystem operations in their own environment by default while
terminal operations run through BySpace on the host; `params.clientCapabilities` tunes which operations
BySpace handles (see [custom-providers.md](custom-providers.md#acp-providers)).

## BySpace tools and the launch environment

BySpace delivers its own tools through the bundled `byspace` skill and the CLI, not through a per-provider
tool catalog. A provider needs exactly one thing to participate: an agent process whose shell can run
`byspace`. The daemon supplies that in the launch environment (`internal/server/agentenv.go`):
`BYSPACE_HOME`, `BYSPACE_HOST`, `BYSPACE_AGENT_ID`, and the daemon's own directory prepended to `PATH`.
`BYSPACE_AGENT_ID` is what makes a created agent a subagent of its caller; the CLI sends it as
`callerAgentId`.

A provider whose process environment is not per-agent (a shared server, for example) still gets the CLI,
but the agent id is whatever the shared process carries — it cannot name its caller. That is a placement
limitation, not a security one: the CLI's authority is the host's own `cli-credential`, the same principal
the user's shell uses.

The skill comes from `internal/server/skills/byspace/SKILL.md` and installs into `~/.agents/skills` and
`~/.claude/skills` when the user selects it; nothing is installed by default. A client that reads neither
has no BySpace tools.

Provider binaries are resolved from the daemon's `PATH` plus standard install locations, including Pi's
managed `~/.pi/agent/bin` and `~/.pi/agents/bin`. A desktop app does not inherit the shell `PATH`, so a
provider that works in a terminal can still be missing without the standard-location search.

## Turn contracts

The daemon owns the canonical timeline and the turn lifecycle; adapters own the provider's native events.
These contracts hold for every adapter.

The daemon owns the one canonical timeline row for a foreground prompt carrying a BySpace
`clientMessageId`. It records that row when the turn is accepted, with the wire `messageId` set to the same
value. Provider adapters still emit their native user-message echo with the same `clientMessageId` when
available; the daemon records its provider identity on the internal row without changing or redispatching
the wire item. Provider adapters continue to own externally initiated user rows that have no BySpace client
identity. Do not perform global transcript text dedupe. Submitted user-message wire items carry the same
BySpace ID in `messageId` and `clientMessageId`; provider history and externally initiated user rows do not
have a BySpace client ID.

Active-turn steering is optional. The daemon owns admission against its exact foreground turn, canonical
user-message creation, and echo reconciliation, and falls back to the normal interrupt-and-replace path
only when the adapter reports `unavailable`. An adapter error leaves the steer's fate ambiguous and must
surface without an interrupt or retry. Codex calls `turn/steer` with the native expected turn and BySpace
client user-message ID. Claude pushes an admitted steer into the exact active SDK query input; isolated
control commands remain unavailable. OpenCode calls `session/prompt_async` with an OpenCode-generated
message ID; the server queues the prompt while busy and the next LLM call in the same BySpace turn includes
it. Pi sends its native `steer` RPC, which queues the message for delivery after the in-flight assistant
turn's tool calls. Slash-command inputs report `unavailable` because pi rejects extension commands on the
steer path, and echo identity is correlated by message text because pi's steer RPC takes no message ID. A
missing session reports `unavailable` and uses the normal interrupt fallback.

A steering adapter also owes its interrupt: stopping a turn must discard the steers the provider has not
read yet, or one of them resumes the turn the user just stopped. Codex clears pending input when it aborts a
turn; Claude does not, so its adapter cancels the SDK messages it queued before calling `query.interrupt()`.
Pi requires `clear_queue` before `abort`.

`clearPendingPermissions` makes permission release part of the provider contract. A provider that accepts
such a steer queues it first, denies permissions blocking its delivery, and stops once the steer is read.
Steers without the flag leave permissions open. A denied plan remains in the timeline because the pending
card was the only other copy of its text.

Rewind accepts the canonical wire `messageId` and resolves it to the provider identity before calling the
adapter. A submitted prompt cannot be rewound until its provider echo supplies that identity.

Provider adapters must terminalize every transient timeline row before emitting the turn's terminal event.
Codex may omit the completed `contextCompaction` item when a turn ends during compaction, so its adapter
closes any pending root compaction before forwarding `turn_completed`, `turn_failed`, or `turn_canceled`. A
terminal turn must never leave the client showing an operation as still loading.

Draft metadata lookups should avoid creating provider sessions when the upstream provider has top-level
APIs for that metadata. Prefer catalog, command, and feature listing over creating a scratch session;
scratch sessions can show up as empty native sessions in provider import/history UIs. Do not resolve a
default model through catalog discovery.

Provider session import has its own contract. The picker lists importable sessions and receives rows only:
provider handle, cwd, title, prompt previews, and last activity. Import takes the selected row and must not
list again. The provider returns the resumed session, storage config, persistence handle, and hydrated
timeline for that one native session; the daemon seeds the timeline and publishes the BySpace agent only
after it is ready.

| Provider | Native history                                                                                | Native archive                          | Provider-owned child timelines |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------ |
| Claude   | Supported                                                                                     | BySpace-owned archive                   | Native task sessions           |
| Codex    | `thread/list` plus `thread/read` or `thread/items/list`                                       | `thread/archive` and `thread/unarchive` | Collaboration sessions         |
| OpenCode | v1/v2 session history                                                                         | v1/v2 native archive                    | `/children` sessions           |
| Pi       | Session JSONL                                                                                 | BySpace-owned archive                   | Session JSONL children         |
| ACP      | `session/list` when the negotiated capability exists; otherwise an explicit unsupported error | BySpace-owned archive                   | Not exposed                    |

Native archive runs before the BySpace record changes. A native failure leaves the agent unarchived; a
provider without native archive keeps the BySpace lifecycle only. Sending a prompt to an archived native
session follows the same rule in reverse.

## Background activity

The composer's background track reads the same normalized task shape from Pi background terminals,
Claude native background tasks, and OpenCode v2 shells. Stop operates on the selected native ID and
returns the provider's refreshed roster; the daemon does not mark a task stopped before the provider
confirms it. OpenCode v1 has no native shell inventory, so it does not show this track.

## Protocol parity ledger

The reference root below is `paseo/packages/server/src/server/agent/providers` at commit
`9c4106561ad816fda917f43adce827c01faf47b1`. Keep a row and its fixture when porting or removing a
protocol behavior; a missing row is an unaudited gap. Shared server behavior uses
`paseo/packages/server/src/server` as its reference root.

| Contract                              | Reference                                                          | Go owner                                                          | Regression fixture                                         |
| ------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Startup and control outcomes          | `session.ts`                                                       | `internal/server/server.go`, provider adapters                    | `provider_lifecycle_test.go`                               |
| Runtime capabilities                  | provider `capabilities.ts`/`agent.ts`                              | `internal/agent/providers/driver.go`, negotiated sessions         | `capabilities_test.go`                                     |
| User MCP launch input                 | `agent-manager.ts`                                                 | `internal/agent/providers/driver.go`, `internal/server/server.go` | `driver_test.go`                                           |
| Native history and archive            | provider history/session modules                                   | `internal/server/ws_workspace.go`, provider adapters              | `codex_history_test.go`, `opencode_history_test.go`        |
| Cancellation cleanup                  | provider `agent.ts`                                                | provider adapters                                                 | `provider_lifecycle_test.go`                               |
| Native scoped rewind                  | `opencode/rewind.ts`, `claude/rewind.ts`, `pi/rewind.ts`           | `internal/server/ws_git_system.go`, provider adapters             | `internal/server/rewind_safety_test.go`                    |
| Background snapshots and live updates | `claude/background-work.ts`, `opencode/v2/background-inventory.ts` | provider sessions and SDK activity                                | `claude_background_test.go`, `opencode_background_test.go` |
| Managed/native subagent targets       | `claude/subagents`, `opencode/v2/children.ts`                      | provider sessions and timeline RPCs                               | `claude_sidecars_test.go`, `opencode_events_test.go`       |

| OpenCode contract                | Reference                                                        | Go owner                         | Regression fixture                                               |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| v1/v2 transport and launch       | `opencode/v2/api.ts`, `service-selection.ts`, `configuration.ts` | `opencode.go`, `opencodepool.go` | `opencode_events_test.go`, `opencode_review_regressions_test.go` |
| SSE activity and native identity | `opencode/event-consumer.ts`, `opencode/v2/timeline.ts`          | `opencode.go`                    | `opencode_events_test.go`                                        |
| Reconnect and gap recovery       | `opencode/event-consumer.ts`, `opencode/v2/streaming.test.ts`    | `opencode.go`                    | `opencode_events_test.go`                                        |
| Permissions and children         | `opencode/v2/permissions.ts`, `children.ts`                      | `opencode.go`                    | `opencode_events_test.go`                                        |
| Steering and abort               | `opencode/v2/turns.ts`                                           | `opencode.go`                    | `opencode_review_regressions_test.go`                            |
| Session-scoped revert            | `opencode/rewind.ts`                                             | `opencode.go`                    | `opencode_events_test.go`                                        |

| ACP contract                    | Reference      | Go owner | Regression fixture               |
| ------------------------------- | -------------- | -------- | -------------------------------- |
| Native permission option IDs    | `acp-agent.ts` | `acp.go` | `acp_permissions_test.go`        |
| Session update families         | `acp-agent.ts` | `acp.go` | `acp_updates_test.go`            |
| Tool details and terminal state | `acp-agent.ts` | `acp.go` | `acp_updates_test.go`            |
| Dynamic catalogs and controls   | `acp-agent.ts` | `acp.go` | `acp_capabilities_test.go`       |
| Cancel, resume, and close       | `acp-agent.ts` | `acp.go` | `acp_review_regressions_test.go` |
| Opt-in host filesystem          | `acp-agent.ts` | `acp.go` | `acp_files_test.go`              |
| Native MCP configuration        | `acp-agent.ts` | `acp.go` | `acp_mcp_test.go`                |

| Codex contract                    | Reference                   | Go owner                   | Regression fixture                 |
| --------------------------------- | --------------------------- | -------------------------- | ---------------------------------- |
| Notifications and item families   | `codex-app-server-agent.ts` | `codex.go`, `codexturn.go` | `codex_parity_test.go`             |
| Approvals and MCP elicitation     | `codex-app-server-agent.ts` | `codex.go`                 | `codex_questions_test.go`          |
| Turn outcomes and steering        | `codex-app-server-agent.ts` | `codex.go`, `codexturn.go` | `codex_review_regressions_test.go` |
| Collaboration subagents           | `codex-app-server-agent.ts` | `codex.go`                 | `codex_parity_test.go`             |
| Custom prompt discovery/expansion | `codex-app-server-agent.ts` | `codex.go`                 | `codex_prompts_test.go`            |
| Native/on-disk skills             | `codex-app-server-agent.ts` | `codex.go`                 | `codex_parity_test.go`             |
| Compact, goals, and model catalog | `codex-app-server-agent.ts` | `codex.go`, `driver.go`    | `codex_parity_test.go`             |

| Claude contract                    | Reference                                        | Go owner    | Regression fixture                |
| ---------------------------------- | ------------------------------------------------ | ----------- | --------------------------------- |
| Partial text/reasoning/tool deltas | `claude/agent.ts`, `query.ts`, `partial-json.ts` | `claude.go` | `claude_stream_review_test.go`    |
| Native task lifecycle              | `claude/task-state.ts`, `subagents`              | `claude.go` | `claude_parity_test.go`           |
| Status, compaction, and recovery   | `claude/agent.ts`, `background-work.ts`          | `claude.go` | `claude_parity_test.go`           |
| Admitted steering and cancellation | `claude/query.ts`, `agent.ts`                    | `claude.go` | `claude_parity_test.go`           |
| Live model and thinking            | `claude/agent.live-settings.test.ts`             | `claude.go` | `claude_parity_test.go`           |
| Native rewind and MCP              | `claude/rewind.ts`, `options.ts`                 | `claude.go` | `claude_message_identity_test.go` |

| Pi contract                            | Reference                            | Go owner                                         | Regression fixture                             |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| No-turn terminal outcomes              | `pi/agent.ts`, `rpc-types.ts`        | `internal/agent/pi/pi.go`                        | `pi_test.go`                                   |
| Negotiated model input                 | `pi/agent.ts`, `rpc-types.ts`        | `internal/agent/pi/pi.go`, SDK model types       | `pi_test.go`                                   |
| Abort queue clearing                   | `pi/agent.ts`                        | `internal/agent/pi/pi.go`                        | `pi_test.go`                                   |
| Compaction and retry                   | `pi/agent.ts`                        | `internal/agent/pi/pi.go`                        | `protocol_parity_test.go`                      |
| Rich results, custom messages, and MCP | `pi/tool-call-mapper.ts`, `agent.ts` | `internal/agent/pi/pi.go`, integration extension | `protocol_parity_test.go`, `extension_test.go` |

## Provider helper processes

Provider-owned helper processes that can outlive an individual agent session must be recorded in the
daemon's managed-process registry. Store provider/kind metadata, the PID, launch command/args, and process
identity captured from the platform process table. Remove the record on normal exit or shutdown.

If a helper process has a readiness phase, the provider's lifecycle model must own the process immediately
after `spawn`, before readiness succeeds. Startup timeout, startup exit, and daemon shutdown must all clean
up through that owned generation. Do not keep a spawned helper only inside a readiness promise; that creates
a live process outside the manager/reaper contract.

Daemon bootstrap reconciles that ledger in the background, without blocking startup: dead PIDs are deleted,
PID identity mismatches are deleted without killing anything, only positively matched BySpace-owned
leftovers are terminated, and a record whose process cannot be inspected is left in place for the next
reconcile rather than deleted. Do not add broad process-name sweepers for provider cleanup; cleanup starts
from records BySpace previously wrote.

## Provider snapshot refresh

Provider snapshots are views of the catalogs needed for a target. The daemon caches them by provider key
and refreshes on demand (`internal/server/provider_catalog.go`). A refresh has one deadline per provider
(30 seconds) covering availability plus the complete catalog probe; a stalled provider does not block
discovery for others.

The wire envelope carries `snapshotHash` (a fingerprint of the entries), `compactSnapshot` (the same catalog
with thinking-option lists deduped), `fetchedAt` (per-provider discovery time), and `generatedAt`. A client
sends `ifNoneMatch` with the last hash it holds; when it matches, the daemon replies `notModified` with the
hash and freshness but no body, and the client reuses its cached catalog. The app's provider cache owns
compact expansion and stores one body per hash.

Saved provider/model choices are user intent. Catalogue failure must not erase them or substitute another
model. Creation reads the caller's host and directory directly; an earlier global snapshot must not settle a
project form's initial selection. Settings refresh invalidates requested providers across known targets and
refreshes them in their actual execution context, so every connected client receives the refreshed view.
Configuration replacement invalidates only changed providers; unchanged entries and discovery in flight
survive.

## The slash-command palette

The composer's `/` list is whatever the provider answers `list_commands` with; the daemon keeps no table of
its own. A draft has no session yet, so the daemon starts the provider named by the draft's provider, model and
cwd, asks it once, and closes it (`internal/server/ws_agent.go`, `handleListCommands`). The client caches the
answer per draft key forever and per agent for a minute, so no provider process is spawned per keystroke.

Every provider publishes its inventory at a different moment, and reading too early returns a short list
rather than an error:

- Claude announces commands on its `init` message a moment after the process starts, so `GetCommands` waits
  for it (5s cap) instead of answering with the static fallback.
- ACP agents publish in batches. `settleCommands` waits for a 600ms quiet window, capped at 1.5s, and gives
  cursor, kiro and trae 10s because their inventory arrives seconds after `session/new`.
- Pi answers `get_commands` in its own shape (`source`, `input.hint`), which the adapter maps to
  `kind`/`argumentHint`; pi never lists the commands it handles itself, so those are seeded.
- OpenCode lists commands over its HTTP API. Codex merges native and on-disk skills with custom
  prompts from `~/.codex/prompts/*.md`; it executes `/compact` and version-gated `/goal` operations
  out of band instead of sending their slash text as a prompt.

The client owns `/exit`, `/quit`, `/q`, `/clear` and `/new`, and resolves them before any provider command,
so a provider command with one of those names is dropped from the palette rather than shown dead
(`web/src/client-slash-commands`). Drafts hide client commands, so a provider's own `/clear` stays visible
there.

## Adding a provider

Most agents need no Go code: add an `extends: "acp"` config and the generic ACP host
launches them. See [custom-providers.md](custom-providers.md).

A new **built-in** provider needs a native adapter:

1. Add a `ProviderSpec` to `BuiltinProviders` in `internal/agent/providers/driver.go` (id, label, binary,
   default args, protocol, modes, features, models) and mirror it in
   `packages/protocol/src/provider-manifest.ts` (`AGENT_PROVIDER_DEFINITIONS`).
2. Implement the session. A session satisfies the `ManagedSession` interface
   (`internal/agent/providers/driver.go`): status, timeline, prompt/steer/abort, permissions, model and
   thinking setters, commands, subagents, and the event subscription. Wire it into the `switch spec.Protocol`
   in `StartProviderSession`, or reuse an existing protocol (`acp`, `pi-rpc`, …).
3. Add a provider icon under `web/src/components/icons/` and register it in
   `web/src/widgets/provider-icons.ts`. Without one, the UI falls back to a generic `Bot` icon.
4. Run `npm run typecheck` and `npm run audit` (the Go parity checks catch a field the daemon does not parse
   or does not send).

## Gotchas

**Mode IDs can be URIs.** ACP providers use full URIs as mode IDs (e.g.,
`"https://agentclientprotocol.com/protocol/session-modes#agent"`). Never assume mode IDs are simple strings.
The manifest `defaultModeId` must match exactly.

**Models and modes are discovered dynamically.** ACP providers report available models and modes at runtime
via the protocol. The static definitions in `provider-manifest.ts` are UI scaffolding (icons, color tiers);
the runtime values from the agent process are the source of truth.

**Provider IDs are strings.** IDs are validated against the manifest at runtime, not at the type level.

**Auth patterns vary.** Some providers need API keys in env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`),
some use OAuth tokens (`CLAUDE_CODE_OAUTH_TOKEN`), some use auth files (`~/.codex/auth.json`), and some handle
auth entirely in their CLI binary (Copilot). Availability checks should test whatever is needed.

**The command is overridable.** Users can configure custom binary paths or environment variables per provider
(`command`, `env` in config). The daemon launches the configured command, not the spec default.

**Session-scoped cancellation needs a stop boundary inside the provider.** Some agents cancel the whole
session rather than one turn — OpenCode's `session.abort` is the example. A cancel that is still in flight
when the next run starts will kill that replacement run, which is what makes "stop, then immediately prompt
again" (`replaceRunning`, `notifyOnFinish` wakes, schedules) flaky. Own this in the provider session, not in
the daemon:

- Model the stop as an explicit `stopping` turn-state variant carrying the canceled run's terminal and the
  cancellation the caller is still owed. Pressing Stop again retries the stop already in progress rather than
  opening a second one; never fire a detached retry, it will outlive its boundary.
- Scope the cancel settlement the way the provider scopes the cancel. If cancellation is session-scoped, so is
  its settlement: track it on the session, accumulating every request issued, and let it outlive the stop that
  issued it. A request still in flight lands on the runner whenever the server gets to it — however many stops
  have come and gone since. Only the newest may hold the gate closed, since recovering from a failed cancel is
  what pressing Stop again is for.
- Gate the operations the daemon issues (prompt, slash command, summarize) on both the terminal and cancel
  settlement. Permission and question responses are not runner operations and must stay outside the gate, or an
  auto-approve deadlocks the stop. Runs the provider starts on its own — autonomous wakes — are observed, not
  gated: the daemon does not choose when they begin.
- Fail closed: if the cancel never succeeded you never proved the run stopped, so refuse new runs until the next
  Stop issues a fresh cancel.
- Suppress the canceled run's residue only until its authoritative terminal. Anything the provider publishes
  after that terminal is a new run by construction and must take the normal live path.
