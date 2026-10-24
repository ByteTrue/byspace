import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { killProcessTree } from "./spawn-node";

export interface LocalGoRelay {
  port: number;
  endpoint: string;
  close(): Promise<void>;
}

// Runs a real relay for the pairing spec. The relay used to be a Node entrypoint
// (packages/relay/dist/node-main.js) that the release artifacts shipped; it moved to
// internal/relay and now ships inside the Go binary (`byspace relay`), so this starts that
// instead. Mirrors local-wrangler-relay, which runs the Cloudflare worker variant.
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const GO_DAEMON_BINARY = path.join(REPO_ROOT, "bin", "byspace");

function resolveGoDaemonBinary(): string {
  if (process.env.BYSPACE_E2E_DAEMON_BINARY) return process.env.BYSPACE_E2E_DAEMON_BINARY;
  if (!existsSync(GO_DAEMON_BINARY)) {
    throw new Error(
      `Go daemon binary not found at ${GO_DAEMON_BINARY}. Run \`make build\` first ` +
        `(or point BYSPACE_E2E_DAEMON_BINARY at a built binary).`,
    );
  }
  return GO_DAEMON_BINARY;
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

export async function startLocalGoRelay(): Promise<LocalGoRelay> {
  const port = await getAvailablePort();
  const logs: string[] = [];
  const child = spawn(resolveGoDaemonBinary(), ["relay", "--addr", `127.0.0.1:${port}`], {
    cwd: REPO_ROOT,
    env: process.env,
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
      throw new Error("Local relay exited before readiness: " + logs.join(""));
    }
    if (await probeHealth(port)) {
      return { port, endpoint: "127.0.0.1:" + port, close };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await close();
  throw new Error("Local relay did not become ready on port " + port + ": " + logs.join(""));
}
