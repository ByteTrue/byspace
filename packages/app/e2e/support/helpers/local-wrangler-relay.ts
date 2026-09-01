import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { killProcessTree } from "./spawn-node";

export interface LocalWranglerRelay {
  port: number;
  endpoint: string;
  close(): Promise<void>;
}

async function getAvailablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  if (port === 0) throw new Error("Failed to allocate a local relay port");
  return port;
}

async function probeRelayWebSocket(port: number): Promise<boolean> {
  const serverId = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const url = `ws://127.0.0.1:${port}/ws?serverId=${serverId}&role=server&v=2`;
  const ws = new WebSocket(url);
  const opened = new Promise<boolean>((resolve) => {
    ws.once("open", () => resolve(true));
  });
  const failed = new Promise<boolean>((resolve) => {
    ws.once("error", () => resolve(false));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), 5_000);
  });
  const ready = await Promise.race([opened, failed, timedOut]);
  clearTimeout(timeout);
  if (ready) {
    ws.close(1000, "readiness probe");
  } else {
    ws.terminate();
  }
  return ready;
}

async function waitForWebSocket(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Local Wrangler relay exited before readiness (code ${child.exitCode})`);
    }
    if (await probeRelayWebSocket(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local Wrangler relay WebSocket did not become ready on port ${port}`);
}

export async function startLocalWranglerRelay(): Promise<LocalWranglerRelay> {
  const port = await getAvailablePort();
  const relayDir = path.resolve(__dirname, "../../../../relay");
  const persistenceDir = await mkdtemp(path.join(tmpdir(), "byspace-e2e-wrangler-relay-"));
  const requireFromRelay = createRequire(path.join(relayDir, "package.json"));
  const wrangler = requireFromRelay.resolve("wrangler/bin/wrangler.js");
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--live-reload=false",
      "--show-interactive-dev-session=false",
      "--persist-to",
      persistenceDir,
      "--var",
      "PASEO_RELAY_UPSTREAM:",
    ],
    {
      cwd: relayDir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await killProcessTree(child);
    } finally {
      await rm(persistenceDir, { recursive: true, force: true });
    }
  };
  try {
    await waitForWebSocket(port, child);
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return {
    port,
    endpoint: `127.0.0.1:${port}`,
    close,
  };
}
