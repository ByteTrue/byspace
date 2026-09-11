# BySpace Development

BySpace's public command is `byspace`. New runtime state uses `$BYSPACE_HOME` (`~/.byspace` by default), and public daemon configuration variables use the `BYSPACE_*` prefix. Matching `PASEO_*` names remain lower-priority compatibility fallbacks where supported; development-only script and benchmark variables retain their existing names.

## CI

CI and Docker runs cancel superseded runs on the same branch: a new push to `main` immediately cancels any in-flight run. When a run exists to verify a specific commit (a release bump, a fix under validation), do not push anything else to `main` — including docs-only commits — until it finishes; rerun via `gh workflow run CI --ref main` if a verification run gets cancelled by mistake.

Main pushes route through the same path filters as pull requests (`.github/ci-paths.yml`); only merge-group checks and manual dispatches run the full matrix unconditionally. A release bump commit touches `package.json`, so it always runs the full matrix as the release gate.

## Prerequisites

- Node.js (see `.tool-versions` for exact version)
- npm workspaces (comes with Node)

## Running the dev server

```bash
npm run dev:server
npm run dev:app
```

Root checkout dev is intentionally split across terminals:

- `npm run dev:server` runs the daemon on `127.0.0.1:6778`.
- `npm run dev:app` runs Expo on `http://localhost:8081` and connects to the dev daemon.

so development-only providers such as Mock Load Test are available. Packaged

The web dev launcher passes the current Git branch to Metro as the internal
`EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL` setting.
the titlebar row. Production builds leave the variable unset and show no label.

`npm run dev` is only a shorthand for `npm run dev:server`. Keep `127.0.0.1:6777` for the packaged app and production-style `~/.byspace` state.

## Worktree starting refs

A new worktree starts from the current branch's upstream, or the local branch when it has no
upstream. This keeps unpushed local commits out of new workspaces by default. The picker collapses
identical refs; divergent local or non-origin refs remain explicit, qualified choices.

The daemon sends the exact upstream ref because the remote and branch names cannot be inferred.
Worktrees retain that ref for comparisons and updates from base while exposing its branch name to
the UI. Merging into base requires a mutable local target: `origin/main` maps to local `main`, while
another remote fails closed until the worktree records an explicit local target. Older daemons omit
the optional field and retain the previous local-first behavior; older worktree metadata without the
exact ref also resolves through its stored branch name.

Worktrees inherit committed Git state only; uncommitted source-checkout changes are not copied.

## byspace.json service scripts

`worktree.setup` and `worktree.teardown` in `byspace.json` accept either a multiline shell script or an array
of commands. Both run sequentially.

Lifecycle commands run in the worktree through a stable script shell: `bash`
resolved from `PATH` on macOS/Linux, and PowerShell with `-NoProfile` on
Windows. They inherit the daemon environment plus BySpace's lifecycle variables;
login and interactive shell startup files are not loaded, and Bash's `BASH_ENV`
hook is unset. ACP single-string terminal commands use the same non-login Bash
behavior on macOS/Linux, but preserve their existing `cmd.exe /c` string semantics
on Windows. Service scripts are separate:
they launch in a terminal and receive the service environment described below.

Because the shell differs per platform, a lifecycle command that must run
everywhere cannot use POSIX-only syntax — `VAR=1 cmd` env prefixes, `$VAR`
expansion, `cp`/`rm`, or a `./scripts/*.sh` entrypoint all fail under PowerShell,
and `bash` is not guaranteed to exist on Windows. Put that logic in a Node script
that reads what it needs from `process.env` and invoke it as
`node ./scripts/<name>.mjs`. This repo's own setup does exactly that in
`scripts/seed-worktree-dev-state.mjs` and `scripts/seed-ios-native-cache.mjs`.

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$BYSPACE_SOURCE_CHECKOUT_PATH/.env\" .env\nnpm run db:migrate",
    "teardown": "npm run db:drop || true"
  }
}
```

Every `scripts` entry with `"type": "service"` receives these environment variables:

| Variable                      | Value                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BYSPACE_SERVICE_<NAME>_URL`  | Proxied URL for a declared peer service. Prefer this for peer discovery; it survives peer restarts.                       |
| `BYSPACE_SERVICE_<NAME>_PORT` | Raw ephemeral port for a declared peer service. Use only as a bypass escape hatch; it can go stale if that peer restarts. |
| `BYSPACE_URL`                 | Self alias for `BYSPACE_SERVICE_<SELF>_URL`.                                                                              |
| `BYSPACE_PORT`                | Self alias for `BYSPACE_SERVICE_<SELF>_PORT`.                                                                             |
| `HOST`                        | Bind host for the service process.                                                                                        |

Service proxy hostnames use the double-dash shape: `web--feature-auth--project.localhost` or, on the default branch, `web--project.localhost`. Optional public aliases use the same leftmost label under the configured public base host.

`<NAME>` is normalized from the script name by uppercasing it, replacing each run of non-`A-Z0-9` characters with `_`, and trimming leading or trailing `_`. For example, `app-server` and `app.server` both normalize to `APP_SERVER`; that collision fails at spawn time with an actionable error. The legacy `PASEO_SERVICE_*`, `PASEO_URL`, and `PASEO_PORT` names are injected as compatibility aliases.

`PORT` is not injected by default. If a framework requires `PORT`, set it in the command:

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "PORT=$BYSPACE_PORT npm run dev:web"
    }
  }
}
```

Service ports use OS ephemeral allocation by default. Set `worktrees.servicePorts` in
`$BYSPACE_HOME/config.json`, or replace it for one project with `worktree.servicePorts` in
`byspace.json`. Legacy `paseo.json` is read and updated in place; do not keep both project config filenames. The block accepts an inclusive `range` such as `"3000-4000"` or a `portScript`
executable. Since `portScript` is executed directly without a shell, it must point to a real executable (e.g., a binary or a script with a proper shebang like `#!/bin/sh`) rather than an inline shell command or shell pipeline. For inline shell commands or pipelines, wrap them in a small script. `portScript` runs in the workspace directory with four arguments: service name,
workspace ID, branch name, and worktree path. A missing branch is passed as an empty string. The same
values are available as `BYSPACE_SCRIPTNAME`, `BYSPACE_WORKSPACE_ID`, `BYSPACE_BRANCH_NAME`, and
`BYSPACE_WORKTREE_PATH`; the corresponding `PASEO_*` names remain compatibility aliases. The script must print one valid TCP port. BySpace trusts the external allocator,
so the port may already be bound. `portScript` takes precedence when both values are present.

## Bundled daemon web UI

> The user-facing guide for this feature (enabling it, reverse proxy, TLS, tunnels, security) lives at [public-docs/web-ui.md](../public-docs/web-ui.md). This section is the contributor/build reference: how the artifact is produced, bundled, and excluded from desktop packaging.

The daemon can optionally serve the browser web client from the same HTTP server. This is disabled by default.

Enable it for a running daemon with:

```bash
byspace daemon start --web-ui
```

Or set the environment variable:

```bash
# The bundled web UI is on by default; no flag needed. To disable it:
BYSPACE_WEB_UI_ENABLED=false byspace daemon start
```

Or persist it in `config.json`:

```json
{
  "features": {
    "webUi": {
      "enabled": true
    }
  }
}
```

When enabled, opening the daemon HTTP origin (for example `http://localhost:6777/`) serves the web app. The same HTTP server continues to serve `/api/*`, `/mcp/*`, `/public/*`, the WebSocket upgrade, and service-proxy routes. Static files load without daemon bearer auth; API and WebSocket calls still enforce auth.

The served app auto-bootstraps a connection to the same origin, so opening `http://localhost:6777/` directly usually skips the Add Host step.

Build the artifact for packaging or measurement with:

```bash
npm run build:daemon-web-ui
```

This exports the normal browser web app (not the Electron-flavored desktop renderer) and copies it into `packages/server/dist/server/web-ui`, precompressing `.html`, `.js`, `.css`, and JSON assets as `.br` and `.gz`.

Measured bundle size for a standard Expo web export:

- raw: 10.77 MiB
- gzip: 2.55 MiB
- brotli: 1.93 MiB

The desktop-managed daemon disables the bundled web UI by default (`BYSPACE_WEB_UI_ENABLED=false`) because the desktop app already ships the renderer as `app-dist`. Shipping the same assets again inside `@getpaseo/server` would duplicate the ~10.8 MiB install. Desktop packaging also excludes `node_modules/@getpaseo/server/dist/server/web-ui/**` from the packaged app.

## Built workspace packages

Package imports resolve through package exports to compiled `dist/` output, not sibling `src/` files. This is true in local dev and in published packages: the app, daemon, CLI, and SDK consumers should all exercise the same runtime paths.

`npm run dev:server` builds the server-side workspace packages once, then keeps `@getpaseo/protocol` and `@getpaseo/client` fresh with TypeScript watch builds while the daemon runs. If you change protocol schemas or client code outside that watch workflow, rebuild the producer before trusting runtime behavior.

Use the named root build targets instead of remembering workspace dependency chains:

```bash
npm run build:client       # protocol -> client
npm run build:server-deps  # highlight -> relay -> protocol -> client
npm run build:server       # server-deps -> server -> cli
npm run build:app-deps     # highlight -> protocol -> client -> expo-two-way-audio
```

Use `npm run build:server` whenever you have changed any daemon/server-facing package and need clean cross-package types or runtime behavior.

The app Metro config disables Watchman and uses Metro's node crawler for exports. Keep that invariant unless you have verified production app exports on machines with and without Watchman installed; distro Watchman builds can differ in capabilities and change Metro's crawl behavior.

For tighter loops, you can rebuild a single workspace:

- Changed `packages/protocol/src/*` or `packages/client/src/*`: `npm run build:client`.
- Changed `packages/server/src/*`, `packages/cli/src/*`, `packages/relay/src/*`, or `packages/highlight/src/*`: `npm run build:server`.
- Changed app build dependencies: `npm run build:app-deps`.

## Dependency patches

`patches/*.patch` are applied by `scripts/postinstall-patches.mjs` on every install. A patch only
runs when its package is actually present, so add the package to that script's `patchedPackages`
list when you introduce a new patch — otherwise the file sits in `patches/` and never applies.
Regenerate a patch with `npx patch-package <package>` after editing `node_modules/<package>`, and
patch every build the consumers use: Metro resolves the `react-native` field of a package
(`src/*.ts` for `react-native-svg`), while Node and Vitest resolve `main`/`module`
(`lib/commonjs`, `lib/module`). Patching only `lib/` leaves the app bundle unfixed.

## ACP provider catalog versions

The in-app ACP provider catalog pins package-runner entries (`npx`, `npm exec`,
and `uvx`) to exact package versions. Run the drift checker regularly — and
before releases — so catalog installs do not sit on stale agent versions:

```bash
npm run acp:version-drift        # report stale/non-exact package pins
npm run acp:version-drift:check  # same, exits non-zero on drift
npm run acp:version-drift:update # rewrite catalog pins to latest exact versions
```

The checker updates only package-runner catalog entries. Providers that use a
preinstalled binary such as `opencode acp`, `cursor-agent acp`, or `goose acp`
are reported as skipped because their versions are owned by the user's local
install.

## CLI reference

Use `npm run cli` to run the in-repo CLI from source (`npx tsx packages/cli/src/index.ts`). The script wraps the CLI with `scripts/dev-home.sh`, so it automatically uses this checkout's `.dev/byspace-home` and dev daemon endpoint unless you pass an explicit override. The globally installed `byspace` binary on macOS is a symlink into the installed BySpace desktop app, not this checkout — use it to drive the desktop's built-in daemon, but use `npm run cli` when you want to talk to the CLI you are editing.

Canonical automation uses `byspace project create/ls/rename/delete`, `byspace workspace create/ls/rename/archive`, `byspace heartbeat create/update/delete`, and the full `byspace schedule` group. MCP heartbeat automation is intentionally smaller: create and delete only. Detach remains an explicit user lifecycle action rather than an agent tool. `byspace run --new-workspace local|worktree` composes workspace creation with agent creation. The old `byspace worktree` and `byspace run --worktree` forms are hidden compatibility aliases.

```bash
npm run cli -- ls -a -g              # List all agents globally
npm run cli -- ls -a -g --json       # Same, as JSON
npm run cli -- inspect <id>          # Show detailed agent info
npm run cli -- logs <id>             # View agent timeline
npm run cli -- agent open <id>       # Focus an existing agent in BySpace Desktop
npm run cli -- daemon status         # Check daemon status
npm run cli -- clone owner/repo --dir ~/workspace # Clone GitHub repo and register project
```

Use the global `--host` option to point the CLI at a different daemon:

```bash
npm run cli -- --host localhost:6777 ls -a
npm run cli -- --host ssh://user@host ls -a
```

Set `BYSPACE_HOST` to use the same target across invocations. An explicit
`--host` overrides the environment variable.

In an SSH URI, the URL port is the SSH server port. The remote daemon defaults to `127.0.0.1:6777`; use `?daemonPort=6778` to override it. The transport runs non-interactively through the local OpenSSH client and never installs, starts, or configures the remote daemon. User-facing setup and troubleshooting live in [public-docs/connectivity.md](../public-docs/connectivity.md#ssh).

Desktop integrations can focus an existing agent without creating one or
sending a message. Use `byspace://h/<server-id>/agent/<agent-id>`, or run
`byspace agent open <agent-id>`. The CLI reads the local daemon's server ID by
default; pass `--server <server-id>` when targeting another server.

## Agent state

Agent data lives at:

```
$BYSPACE_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

Find an agent by ID:

```bash
find $BYSPACE_HOME/agents -name "{agent-id}.json"
```

Find by content:

```bash
rg -l "some title text" $BYSPACE_HOME/agents/
```

## Provider session files

Get the session ID from the agent JSON (`persistence.sessionId`), then:

**Claude:**

```
~/.claude/projects/{cwd-with-dashes}/{session-id}.jsonl
```

**Codex:**

```
~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{timestamp}-{session-id}.jsonl
```

## Testing with Playwright MCP

Point Playwright MCP at the running Expo web target. For root checkout dev, `npm run dev:app` reserves `http://localhost:8081`. For BySpace-managed worktree app services, use the service URL or port shown by BySpace for that worktree.

Do NOT use browser history (back/forward). Always navigate by clicking UI elements or using `browser_navigate` with the full URL — the app uses client-side routing and browser history breaks state.

## App web deploys

`packages/app` exports a single-page Expo web app and deploys the `dist/`
directory to Cloudflare Pages with `npm run deploy:web --workspace=@getpaseo/app`.

PWA install metadata lives in `packages/app/public/manifest.json` and is linked
from `packages/app/public/index.html`. Keep the install icons in `public/` so
Cloudflare serves them from stable root URLs after `expo export`.

Do not add service-worker caching casually. BySpace is a live control surface for
agents, and an aggressive service worker can strand installed users on stale web
code. If offline behavior becomes a product requirement, add it deliberately
with an update strategy and test the installed-app upgrade path.

## Expo troubleshooting

```bash
npx expo-doctor
```

Diagnoses version mismatches and native module issues.

## Typecheck

Always run typecheck after changes:

```bash
npm run typecheck
```
