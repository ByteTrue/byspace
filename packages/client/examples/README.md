# BySpace Client SDK Examples

These examples use only the public SDK root:

```ts
import { createBySpaceClient, type BySpaceClient } from "@bytetrue/byspace-client";
```

Each example takes the daemon WebSocket URL as an argument. Checkout-local development uses the endpoint printed by `npm run dev:server`; a production-style local daemon normally uses `ws://127.0.0.1:6777/ws`.

- `quickstart.ts` runs one agent and prints its reply.
- `workspaces.ts` covers creating a fresh workspace, opening by directory, refreshing, and archiving.
- `agents-and-providers.ts` covers provider discovery, creating agents, and waiting for turns.
- `events-and-timeline.ts` covers subscribing to workspace, agent, and timeline events, plus refetching a timeline page.
- `issue-to-agent.ts` turns an issue record into a visible BySpace workspace and agent.
- `parallel-review.ts` launches several reviewers concurrently and cleans them up.
- `provider-settings.ts` covers provider settings that are currently daemon config-backed.

Provider profiles, provider environment variables, custom binaries, and additional models remain daemon configuration. The SDK exposes them through `client.config.get()` and `client.config.patch()` until first-class provider settings RPCs exist.
