# Ad-hoc daemon testing

Spin up an isolated in-process daemon test harness without touching the main daemon on port 6777.

**Do not spawn a real daemon to reproduce something.** `byspace daemon start --home <tmp> --port <n>` is not actually isolated: it ends up binding the default listen address, so the developer's supervisor on 6777 crash-loops on `EADDRINUSE`, the temporary daemon takes over the port, the app shows empty data under a new server id, and the two `byspace.pid` files describe each other. Recovering means killing the interloper first so the real supervisor can reclaim the port; nothing is deleted, but it looks like data loss. Use this in-process harness, or a Vitest run, instead.

The ban is on that ad-hoc spawn, not on running a daemon. When the thing under test only exists in a real daemon — a provider binary answering, a model call failing, the browser conformance audit — run the dev daemon: `npm run dev:daemon` binds `127.0.0.1:6778` with `BYSPACE_HOME` at `.dev/byspace-home`, so it cannot collide with 6777. Drive it with `npm run cli -- run/logs/ls/inspect` and stop it when done. See [docs/development.md](development.md#running-the-dev-server).

This is for test code only. Executable daemon processes must start through
`scripts/supervisor-entrypoint.ts` or `dist/scripts/supervisor-entrypoint.js`;
do not use `createBySpaceDaemon` as a product launch path.

## Multiple daemons and the browser (end-to-end)

Some behaviour only exists once two real daemons and a browser are in the loop: host-list sync, tunnel authorization, the pairing flow, a password gate that only a relay connection hits. Unit tests and the in-process harness below fake the client and run one daemon, so they cannot see it. Two real bugs in the host-sync epic — a dropped direct-connection password, and a CLI command that booted the production home — showed up only on this path.

Run it locally without touching 6777. Build the binary first (`go build -o bin/byspace.exe .`), then:

```bash
# a relay the two daemons meet on
./bin/byspace.exe relay --addr 127.0.0.1:8791 &

# two daemons, each with its own home and port, both pointed at that relay
./bin/byspace.exe serve --addr 127.0.0.1:8792 --home "$TEMP/v2a" --relay ws://127.0.0.1:8791/ws &
./bin/byspace.exe serve --addr 127.0.0.1:8793 --home "$TEMP/v2b" --relay ws://127.0.0.1:8791/ws &

# the web app, pointed at daemon A
BYSPACE_LISTEN=127.0.0.1:8792 npm run dev:app &
```

Drive the browser with the Playwright MCP server. The form fields carry `data-testid`s (`welcome-direct-connection`, `direct-password-input`, `tunnels-add-listen-host`, ...) — click and fill through those, and read state back with `page.evaluate(() => JSON.parse(localStorage.getItem('@byspace:daemon-registry')))`.

Two rules that keep this off the production home:

- **Every daemon gets its own `--home` under a temp dir and a port that is not 6777 or 6778.** `serve --addr` takes the address explicitly; `daemon start` does not, which is the spawn this doc bans.
- **Do not run `byspace pair`, `onboard`, or any CLI command that resolves a home without pointing it at the temp home.** A command that cannot reach its `--addr` falls back to reading a home, and `--home` unset resolves to `~/.byspace`. That is how `pair` once booted the production home; see [the note](../byissue/notes/2026-11-12-cli-pair-offline-offer-boots-the-home.md). To get a second daemon's pairing link, read `server-id` and `daemon-keypair.json` from its temp home directly, or pass `--home "$TEMP/v2b"`.

Stop the daemons and the web app when done and remove the temp homes. Confirm 6777 is still the production PID before and after.

## Quick start

```typescript
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import pino from "pino";
import { createBySpaceDaemon } from "./bootstrap.js";
import { DaemonClient } from "./test-utils/daemon-client.js";

const logger = pino({ level: "warn" });
const byspaceHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-test-"));
const byspaceHome = path.join(byspaceHomeRoot, ".byspace");
await mkdir(byspaceHome, { recursive: true });
const staticDir = await mkdtemp(path.join(os.tmpdir(), "byspace-static-"));

const daemon = await createBySpaceDaemon(
  {
    listen: "127.0.0.1:0", // OS picks a free port
    byspaceHome: byspaceHome,
    corsAllowedOrigins: [],
    hostnames: true,
    mcpEnabled: false,
    staticDir,
    mcpDebug: false,
    agentClients: {},
    agentStoragePath: path.join(byspaceHome, "agents"),
    relayEnabled: false,
    relayEndpoint: "app.byspace.cc.cd:443",
    appBaseUrl: "https://app.byspace.cc.cd",
    // Add custom config here, e.g.:
    // providerOverrides: { ... },
  },
  logger,
);

await daemon.start();
const target = daemon.getListenTarget();
const port = target!.type === "tcp" ? target!.port : null;

const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  appVersion: "0.1.70", // see gotcha #1
});
await client.connect();
await client.fetchAgents({ subscribe: { subscriptionId: "test" } });

// ... do your testing ...

await client.close();
await daemon.stop();
await rm(byspaceHomeRoot, { recursive: true, force: true });
await rm(staticDir, { recursive: true, force: true });
```

Run with:

```bash
npx tsx packages/server/src/server/your-script.ts
```

## Using the test helper

For simpler cases, `createTestBySpaceDaemon` + `DaemonClient` handles temp dirs and port selection:

```typescript
import { createTestBySpaceDaemon } from "./test-utils/byspace-daemon.js";
import { DaemonClient } from "./test-utils/daemon-client.js";

const daemon = await createTestBySpaceDaemon();
const client = new DaemonClient({
  url: `ws://127.0.0.1:${daemon.port}/ws`,
  appVersion: "0.1.70",
});
await client.connect();
await client.fetchAgents({ subscribe: { subscriptionId: "test" } });

// ... test ...

await client.close();
await daemon.close(); // stops daemon + cleans up temp dirs
```

The test helper does **not** expose `providerOverrides`. In test harnesses, use `createBySpaceDaemon` directly when you need it (see quick start above).

## Common client methods

```typescript
// Provider discovery
const snapshot = await client.getProvidersSnapshot({ cwd: "/tmp" });
const models = await client.listProviderModels("claude");
const modes = await client.listProviderModes("claude");

// Agent lifecycle
const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });
await client.sendMessage(agent.id, "Hello");
const updated = await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle");
```

## Gotchas

### 1. appVersion gates provider visibility

The daemon hides non-legacy providers (anything other than claude, codex, opencode) from clients that don't send an `appVersion >= 0.1.45`. The `DaemonClient` sends no version by default, so custom providers like ACP-based ones will be invisible in snapshot responses.

Always pass `appVersion`:

```typescript
const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  appVersion: "0.1.70",
});
```

### 2. Provider snapshots are async

After the daemon starts, providers are probed in the background. The first `getProvidersSnapshot()` call will likely return `status: "loading"` for most providers. Poll until the provider you care about is no longer loading:

```typescript
let snapshot = await client.getProvidersSnapshot({ cwd: "/tmp" });
for (let i = 0; i < 20; i++) {
  const entry = snapshot.entries.find((e) => e.provider === "gemini");
  if (entry && entry.status !== "loading") break;
  await new Promise((r) => setTimeout(r, 2_000));
  snapshot = await client.getProvidersSnapshot({ cwd: "/tmp" });
}
```

### 3. fetchAgents is required before most operations

Call `client.fetchAgents()` after connecting. The daemon session expects this handshake before it processes other requests — without it, messages like `get_providers_snapshot_request` will silently hang.

### 4. listen: "127.0.0.1:0" for port allocation

Always use port `0` so the OS picks a free port. Never hardcode a port — it will collide with the main daemon or other test runs.

### 5. Script must live inside packages/server

The test utilities use relative imports through the TypeScript project. Place your script somewhere under `packages/server/src/` and import from there. Scripts outside the repo will fail with module resolution errors.

### 6. Cleanup on failure

Wrap your test logic in try/finally to ensure the daemon stops and temp dirs are cleaned up, even if an assertion fails:

```typescript
try {
  // ... test logic ...
} finally {
  await client.close();
  await daemon.stop().catch(() => undefined);
  await rm(byspaceHomeRoot, { recursive: true, force: true });
}
```

### 7. ACP providers spawn real processes

When testing ACP providers (e.g., Gemini with `extends: "acp"`), the daemon will spawn real processes to probe for models and modes. The binary must be installed and on PATH. Probing can take 5-15 seconds depending on the provider.
