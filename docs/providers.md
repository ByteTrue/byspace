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

- **The in-app provider catalog** (`web/src/data/acp-provider-catalog.ts`). Each entry is a
  one-click install that writes an `extends: "acp"` provider config with the right `command`.
- **Manual config**: `extends: "acp"` plus a `command` in `config.json`. See
  [custom-providers.md](custom-providers.md#adding-a-generic-acp-provider).

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

BySpace tools do not reach an ACP agent automatically. The daemon gives ACP sessions an empty
`mcpServers` array, and the bundled skill is only readable if the client reads `~/.agents/skills` or
`~/.claude/skills`. ACP agents execute filesystem operations in their own environment by default while
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

## Adding a provider

Most agents need no Go code: add an `extends: "acp"` config (or a catalog entry) and the generic ACP host
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
   `web/src/components/provider-icons.ts`. Without one, the UI falls back to a generic `Bot` icon.
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
