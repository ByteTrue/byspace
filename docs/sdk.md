# TypeScript SDK

`@bytetrue/byspace-client` drives a BySpace daemon from TypeScript. SDK-created workspaces and agents are durable daemon resources, appear in the browser Web app, and remain available after the SDK process disconnects.

The package root is the supported SDK surface. Imports below `@bytetrue/byspace-client/internal/*` are internal to BySpace workspace packages.

## Install and connect

```bash
npm install @bytetrue/byspace-client
```

```ts
import { createBySpaceClient } from "@bytetrue/byspace-client";

const client = createBySpaceClient({
  url: "ws://127.0.0.1:6777/ws",
  clientId: "issue-tracker",
});

await client.connect();
try {
  // Use client.workspaces, client.agents, client.providers, and client.config.
} finally {
  await client.close();
}
```

The URL must end in `/ws`. A production-style local daemon normally uses `ws://127.0.0.1:6777/ws`; checkout-local development uses the endpoint printed by `npm run dev:server`.

`BySpaceClientConfig` retains BySpace transport options including daemon password or authorization header, custom WebSocket headers, reconnect policy, and relay E2EE configuration. Closing a client removes its connection and listeners; it does not stop agents or archive workspaces.

## Agents

Agent selections use `provider/model`; model IDs may contain additional slashes.

```ts
const agent = await client.agents.create({
  config: {
    provider: "codex/gpt-5.5",
    modeId: "full-access",
  },
  cwd: "/Users/me/dev/storefront",
  title: "Checkout reviewer",
  prompt: "Review the current diff and name the riskiest change.",
});

const firstTurn = await agent.waitForFinish();
const followUp = await agent.run("Now focus on failure recovery.");
```

`create()` resolves when the session exists; an initial prompt may still be running. `waitForFinish()` waits for the active turn, while `run()` sends a prompt and waits for that turn. A timeout does not cancel the agent.

Use `client.agents.ref(id)` to recover a durable agent, `refresh()` for a fresh snapshot, `send()` for a prompt without waiting, and `archive()` when the integration owns the agent lifecycle. `agents.list()` supports daemon filters and pagination.

## Workspaces

Open or reuse the active workspace for a directory:

```ts
const workspace = await client.workspaces.open("/Users/me/dev/storefront");
```

Always create a fresh directory-backed workspace:

```ts
const workspace = await client.workspaces.create({
  source: { kind: "directory", path: "/Users/me/dev/storefront" },
  title: "Checkout issue 42",
});
```

Create an isolated BySpace-owned worktree:

```ts
const workspace = await client.workspaces.create({
  source: {
    kind: "worktree",
    cwd: "/Users/me/dev/storefront",
    action: "branch-off",
    refName: "main",
    branchName: "fix/checkout-42",
  },
  title: "Checkout issue 42",
});
```

Fresh worktree creation suffixes occupied branches and paths instead of reusing an existing worktree. `workspace.agents.create()` places a new agent in that workspace without repeating its directory. Workspace and agent archive are separate lifecycle operations; recursive agent archive semantics remain daemon-owned.

## Providers

Wait for provider discovery before choosing a model:

```ts
const snapshot = await client.providers.waitForReady({
  cwd: process.cwd(),
  timeoutMs: 60_000,
});
const entry = snapshot.entries.find((candidate) => candidate.status === "ready");
const model = entry?.models?.find((candidate) => candidate.isDefault) ?? entry?.models?.[0];
if (!entry || !model) throw new Error("No provider model is ready");

const agent = await client.agents.create({
  config: { provider: `${entry.provider}/${model.id}` },
  cwd: process.cwd(),
});
```

Provider actions expose snapshots, refresh, availability, models, modes, features, diagnostics, and update subscriptions. Use IDs returned by the daemon because provider installations and configured models differ between hosts.

Provider profiles, environment variables, custom binaries, and additional models remain daemon configuration. Access that typed configuration through `client.config.get()` and `client.config.patch()`.

## Events and ownership

Workspace and agent handles expose local subscriptions over daemon updates. Timeline handles expose stream-event subscriptions and page refetch. Unsubscribe functions remove only the SDK listener; they do not archive resources or stop daemon subscriptions owned elsewhere.

SDK resources are visible to users and other clients. Archive only resources your integration owns, and keep stable IDs when reconnecting to long-running work.

See [`packages/client/examples`](../packages/client/examples/README.md) for quickstart, workspace, provider, event, issue-tracker, and parallel-review patterns.
