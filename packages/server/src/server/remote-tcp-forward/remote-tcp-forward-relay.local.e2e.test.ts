import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, Socket, type Server } from "node:net";
import path from "node:path";
import type pino from "pino";
import { exportPublicKey, generateKeyPair } from "@bytetrue/byspace-relay";
import { REMOTE_TCP_FORWARD_CONNECTION_PREFIX } from "@bytetrue/byspace-protocol/remote-tcp-forward";
import { startRelayTransport } from "../relay-transport.js";
import { RemoteTcpForwardManager } from "./remote-tcp-forward-manager.js";
import { connectRemoteTcpForwardRelay } from "./remote-tcp-forward-relay-client.js";
import { acceptRemoteTcpForwardChannel } from "./remote-tcp-forward-session.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const wranglerCli = path.join(repoRoot, "node_modules/wrangler/bin/wrangler.js");

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server has no TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function createEchoServer(): Server {
  return createServer({ allowHalfOpen: true }, (socket) => {
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => chunks.push(chunk);
    const reply = () => socket.end(Buffer.concat(chunks));
    socket.on("data", collect);
    socket.on("end", reply);
  });
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForRelay(
  port: number,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited with ${child.exitCode}: ${output()}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for Wrangler: ${output()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
  }, 3_000);
  child.kill("SIGTERM");
  await exited;
  clearTimeout(timer);
}

function roundTrip(port: number, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new Socket({ allowHalfOpen: true });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("end", () => {
      socket.destroy();
      resolve(Buffer.concat(chunks));
    });
    socket.connect(port, "127.0.0.1", () => socket.end(payload));
  });
}

describe("remote TCP forwarding through the local Relay", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(
      cleanup
        .splice(0)
        .toReversed()
        .map((close) => close()),
    );
  });

  it("preserves a large half-closed TCP flow over the production E2EE carrier", async () => {
    const relayPort = await getAvailablePort();
    let relayOutput = "";
    const relay = spawn(
      process.execPath,
      [
        wranglerCli,
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(relayPort),
        "--live-reload=false",
        "--show-interactive-dev-session=false",
      ],
      {
        cwd: path.join(repoRoot, "packages/relay"),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    relay.stdout?.on("data", (chunk) => {
      relayOutput += String(chunk);
    });
    relay.stderr?.on("data", (chunk) => {
      relayOutput += String(chunk);
    });
    cleanup.push(() => stopChild(relay));
    await waitForRelay(relayPort, relay, () => relayOutput.slice(-4_000));

    const target = createEchoServer();
    const targetPort = await listen(target);
    cleanup.push(() => closeServer(target));

    const serverId = "tcp-forward-e2e-target";
    const keyPair = generateKeyPair();
    const targetRelay = startRelayTransport({
      logger: createLogger(),
      attachSocket: (channel, metadata) => {
        if (!metadata?.relayConnectionId?.startsWith(REMOTE_TCP_FORWARD_CONNECTION_PREFIX)) {
          channel.close(1008, "Unexpected test connection");
          return;
        }
        void acceptRemoteTcpForwardChannel(channel);
        return Promise.resolve();
      },
      relayEndpoint: `127.0.0.1:${relayPort}`,
      relayUseTls: false,
      serverId,
      daemonKeyPair: keyPair,
    });
    cleanup.push(() => targetRelay.stop());

    const manager = new RemoteTcpForwardManager({
      connectRemote: connectRemoteTcpForwardRelay,
      logger: createLogger(),
    });
    cleanup.push(() => manager.stop());
    const forward = await manager.open("e2e-owner", {
      target: {
        v: 2,
        serverId,
        daemonPublicKeyB64: exportPublicKey(keyPair.publicKey),
        relay: { endpoint: `127.0.0.1:${relayPort}`, useTls: false },
      },
      targetPort,
      localPort: 0,
    });

    const payload = Buffer.alloc(1024 * 1024, 0x5a);
    const response = await roundTrip(forward.localPort, payload);
    expect(response.equals(payload)).toBe(true);
  }, 45_000);
});
