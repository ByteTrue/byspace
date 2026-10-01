/**
 * Standalone entry point for the self-hosted Node relay.
 *
 * Environment:
 * - BYSPACE_RELAY_PORT (or PORT): listen port, default 8080
 * - BYSPACE_RELAY_HOST: listen host, default 0.0.0.0
 */

import { createNodeRelayServer } from "./node-adapter.js";

const port = Number(process.env.BYSPACE_RELAY_PORT ?? process.env.PORT ?? 8080);
const host = process.env.BYSPACE_RELAY_HOST ?? "0.0.0.0";

if (!Number.isFinite(port) || port <= 0) {
  console.error("Invalid BYSPACE_RELAY_PORT");
  process.exit(1);
}

const relay = createNodeRelayServer({
  port,
  host,
  onLog: (line) => console.log(line),
});

relay.server.listen(port, host, () => {
  console.log(`[relay] listening on http://${host}:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[relay] ${signal} received, shutting down`);
  try {
    await relay.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
