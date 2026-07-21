# Terminal Activity Indicators

BySpace surfaces terminal activity as a tab indicator (the same "running" dot used by agents).

## Current state

Terminal activity is source-agnostic plumbing. `TerminalActivityTracker` holds the current per-terminal state and emits transitions to the manager, worker protocol, websocket subscription, app buckets, dots, and notifications.

The tracker defaults to unknown (`null`). Activity production lives outside terminal stream parsing: agent hook commands report coarse activity to the daemon's local `/api/terminal-activity` endpoint.

## Architecture

```
TerminalSession
  ├── TerminalActivityTracker               one per session
  │     ├── set(state)                      records the latest state
  │     └── onChange(snapshot, previous)    fires only on resolved-state transitions
  │
  └── onActivityChange({ activity, previous })   subscribed in TerminalManager
        ├── emits terminalsChanged          terminal list/tab indicators only
        └── subscribeTerminalActivity       per-transition stream for notification policy
        └── subscribeTerminalWorkspaceContributionChanged  workspace status rollup only
```

`TerminalActivityTracker` is the single stateful object per session. It holds `{ state, changedAt }`, starts at unknown (`null`), and fires `onChange` only when the state actually changes.

Terminal directory snapshots (`terminalsChanged`) and workspace contribution changes are separate concerns. A title-only change produces a terminal list snapshot but never touches workspace descriptors. A transition that changes the derived workspace bucket (e.g. idle -> working, working -> idle, attention cleared) emits both a terminal list snapshot and a server-internal `TerminalWorkspaceContributionChanged` event, which Session consumes to invalidate every active workspace sharing the owning workspace's `cwd`.

### Transitions carry their own history

Each `onChange` delivers both the new snapshot and the `previous` one (`{ state, changedAt }`). The transition flows unchanged up through `TerminalSession.onActivityChange` (as `{ activity, previous }`), the worker protocol's `terminalActivityChange` event, and the manager-level `subscribeTerminalActivity(listener)` stream (`{ terminalId, name, cwd, activity, previous }`).

The daemon consumes these transitions, not snapshots. When a transition moves from `working` to `idle`, the tracker records finished attention, so the terminal shows the same green finished dot as an idle agent that needs review. The websocket layer also fires a "Terminal finished" attention notification. A terminal that exits while still working emits no turn-end notification.

Terminal list visibility is `workspaceId`-scoped: a terminal belongs to the workspace that created it, and same-`cwd` sibling workspaces do not see it in their terminal lists. Terminal status routing starts from that owning workspace, uses the owning workspace's `cwd`, then fans the status bucket out to every active workspace with the same `cwd`.

Path-prefix routing is only a legacy fallback for unowned terminal activity contribution. If a live terminal has no `workspaceId`, the daemon resolves the deepest active parent workspace from the terminal `cwd`, then fans status out to active same-`cwd` siblings of that owner. That fallback contributes status, but it does not make the terminal visible in workspace-scoped terminal lists.

## Hook reporting

Terminals receive four environment variables when the daemon creates the shell:

- `BYSPACE_TERMINAL_ID`
- `BYSPACE_ACTIVITY_TOKEN`
- `BYSPACE_TERMINAL_ACTIVITY_URL`
- `BYSPACE_HOOK_CLI` — absolute path to the current `byspace` CLI executable.

Claude and Codex use generated shell commands that run the current `BYSPACE_HOOK_CLI`; OpenCode and Pi use installed extensions that post to the same loopback endpoint directly. `byspace hooks <agent> <event>` reads the terminal id, token, and activity URL, asks the provider registry to resolve the event to a coarse activity state, and silently posts `{ terminalId, token, state }`. Missing env, unsupported agents/events, malformed hook input, and daemon/network failures are no-ops so hooks never break the user's terminal session.

Claude hook mapping:

- `UserPromptSubmit` → `running`
- `Stop`, `StopFailure`, `SessionEnd` → `idle`
- `Notification` with `reason` or `matcher` equal to `idle_prompt` → `needs-input`

Codex hook mapping:

- `UserPromptSubmit` → `running`
- `PreToolUse`, `PostToolUse` → `running`
- `PermissionRequest` → `needs-input`
- `Stop` → `idle`

OpenCode uses a server plugin instead of command hooks. The plugin listens to OpenCode bus events and emits these BySpace hook events:

- `session.status` with `busy` or `retry` → `running`
- `session.status` with `idle` → `idle`
- `permission.asked` → `needs-input`
- `permission.replied` → `running`

Pi uses a global extension and Pi's documented lifecycle events:

- `agent_start` → `running`
- ask/question tool start → `needs-input`
- ask/question tool end → `running`
- `agent_settled`, `session_shutdown` → `idle`

The daemon maps hook states onto terminal activity like an agent lifecycle plus unread attention: `running` → `state: working`, `idle` → `state: idle`, and `needs-input` → `state: idle` with `attentionReason: needs_input`. A `working` → `idle` transition records `state: idle` with `attentionReason: finished` until the user focuses that terminal; plain idle terminals still contribute no workspace status.

## Focus clearing

Client heartbeats include the focused terminal id. When a visible client focuses a terminal with an `attentionReason`, the daemon clears the attention and leaves the terminal idle. Plain idle terminal activity does not contribute to workspace status, so a workspace whose only attention source was that terminal rolls up from `needs_input` or `attention` back to `done`.

### Agent hook installation

Installing hooks edits the user's real agent config files, so every provider is opt-in. The provider-scoped `daemon.terminalAgentHooks` map is surfaced under a host's **Terminals → Terminal agent hooks** settings, with independent switches for Claude Code, Codex, OpenCode, and Pi. At startup `applyTerminalAgentHookSetting` installs only enabled providers; live setting changes install or remove only the provider that changed. A disabled secondary/test daemon never removes hooks owned by another daemon startup.

The legacy `daemon.enableTerminalAgentHooks` field remains accepted for protocol compatibility. A legacy-only value applies to every provider; the daemon keeps it as an aggregate (`true` when any provider is enabled) so old clients can still read and control the setting. New clients capability-gate provider switches on `server_info.features.terminalAgentHookProviders`.

When enabled for a provider, BySpace installs its hook globally:

- Claude hooks are written to `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR/settings.json` when that override is set).
- Codex hooks are written to `~/.codex/hooks.json` (or `CODEX_HOME/hooks.json` when that override is set). Codex supports a native `commandWindows`, so each BySpace hook includes both POSIX and Windows commands. Non-managed Codex hooks are trust-gated by Codex; users may see Codex's hook review prompt before the hook runs.
- OpenCode gets a self-contained plugin at `$XDG_CONFIG_HOME/opencode/plugins/byspace-terminal-activity.js` (or `~/.config/opencode/plugins/byspace-terminal-activity.js` when XDG is unset; `OPENCODE_CONFIG_DIR` still wins when set).
- Pi gets a self-contained extension at `~/.pi/agent/extensions/byspace-terminal-activity.ts` (or `PI_CODING_AGENT_DIR/extensions/byspace-terminal-activity.ts`). Pi auto-discovers this documented global extension location; `/reload` activates a newly installed or updated extension in an already running Pi session.

Installation is marker-based/idempotent for config hooks and exact-file/idempotent for the OpenCode and Pi extensions. BySpace preserves user hooks, removes only its own marker-matched command hooks or exact managed extension files, and leaves enabled hooks installed across daemon shutdown. Outside a BySpace terminal they are inert because the command or extension requires BySpace's injected terminal identity and activity token.

Provider variation lives in `AGENT_HOOK_PROVIDERS`: provider id, installed events, install strategy, and runtime event-to-activity resolution. Pi's extension source is provider-local because it uses Pi's native extension lifecycle; the generic installer and daemon setting reconciliation remain provider-agnostic.

The installed hook command keeps the config portable and resolves the CLI at runtime:

```sh
[ -n "$BYSPACE_TERMINAL_ID" ] && "${BYSPACE_HOOK_CLI:-byspace}" hooks claude <event>
```

Codex also receives the Windows equivalent:

```bat
if defined BYSPACE_TERMINAL_ID (if defined BYSPACE_HOOK_CLI ("%BYSPACE_HOOK_CLI%" hooks codex <event>) else (byspace hooks codex <event>))
```

BySpace injects `BYSPACE_HOOK_CLI` so Codex's hook shell cannot pick up a stale global `byspace` before the current one. The command still falls back to bare `byspace` if the env is missing, and it still no-ops outside BySpace terminals because the `BYSPACE_TERMINAL_ID` gate remains first. BySpace also prepends the CLI binary directory to each terminal `PATH` as a secondary fallback. All other behavior lives in `byspace hooks`: read the env, map the event, POST activity, and no-op/fail-open when anything is missing or unavailable.

If config installation fails, daemon startup and terminal spawn continue without terminal activity hooks.
