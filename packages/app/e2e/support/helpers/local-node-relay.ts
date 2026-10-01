import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { killProcessTree } from "./spawn-node";

export interface LocalNodeRelay {
  port: number;
  endpoint: string;
  close(): Promise<void>;
}

// Mirrors local-wrangler-relay, but runs the Node relay that ships in the release artifacts
// (packages/relay/dist/node-main.js) instead of the Cloudflare worker under `wrangler dev`.
// CI builds it with `npm run build:server` before the Playwright shards, so the dist entry is
// always present; src/ is not spawned because packages/relay has no tsx dependency.
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

async function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}

export async function startLocalNodeRelay(): Promise<LocalNodeRelay> {
  const port = await getAvailablePort();
  const relayDir = path.resolve(__dirname, "../../../../relay");
  const entrypoint = path.join(relayDir, "dist", "node-main.js");
  const logs: string[] = [];
  const child = spawn(process.execPath, [entrypoint], {
    cwd: relayDir,
    env: {
      ...process.env,
      BYSPACE_RELAY_HOST: "127.0.0.1",
      BYSPACE_RELAY_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = (chunk: Buffer) => {
    logs.push(chunk.toString());
    if (logs.length > 40) logs.shift();
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  const close = async () => {
    child.stdout?.off("data", record);
    child.stderr?.off("data", record);
    await killProcessTree(child);
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await close();
      throw new Error("Local Node relay exited before readiness: " + logs.join(""));
    }
    if (await probeHealth(port)) {
      return { port, endpoint: "127.0.0.1:" + port, close };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await close();
  throw new Error("Local Node relay did not become ready on port " + port + ": " + logs.join(""));
}
