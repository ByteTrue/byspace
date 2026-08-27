# @bytetrue/byspace-client

TypeScript SDK for building integrations on top of a BySpace daemon.

```bash
npm install @bytetrue/byspace-client
```

```ts
import { createBySpaceClient } from "@bytetrue/byspace-client";

const client = createBySpaceClient({ url: "ws://127.0.0.1:6777/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

The public API is the package root. Imports under `@bytetrue/byspace-client/internal/*` are unsupported implementation details used by BySpace's own packages.

Read the [SDK documentation](https://byspace.cc.cd/docs/sdk) for agents, workspaces, provider discovery, events, recipes, and the API reference. Runnable TypeScript patterns also live in [`examples/`](./examples/README.md).

## Runtime

The client needs a WebSocket implementation. Modern browsers and Node.js 22 provide one globally.

Use a WebSocket URL ending in `/ws`, such as `ws://127.0.0.1:6777/ws`. Pass `password` when the daemon requires authentication.

## Stability

The high-level API exported from `@bytetrue/byspace-client` is the supported SDK surface. The SDK and daemon remain protocol-compatible across versions, but newly added capabilities can require a newer daemon.
