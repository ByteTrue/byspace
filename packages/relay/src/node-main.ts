/**
 * Standalone entry point for the self-hosted Node relay.
 *
 * Environment:
 * - BYSPACE_RELAY_PORT (or PORT): listen port, default 8080
 * - BYSPACE_RELAY_HOST: listen host, default 0.0.0.0
 * - BYSPACE_WEB_DIR: directory of the web static export; when it contains an
 *   index.html, the same origin also serves the app over plain HTTP
 */

import { createNodeRelayServer } from "./node-adapter.js";

const port = Number(process.env.BYSPACE_RELAY_PORT ?? process.env.PORT ?? 8080);
const host = process.env.BYSPACE_RELAY_HOST ?? "0.0.0.0";
const webDir = process.env.BYSPACE_WEB_DIR?.trim() || null;

if (!Number.isFinite(port) || port <= 0) {
  console.error("Invalid BYSPACE_RELAY_PORT");
  process.exit(1);
}

const relay = createNodeRelayServer({
  port,
  host,
  webDir,
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
