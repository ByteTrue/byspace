import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";

import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { createNodeRelayServer } from "@bytetrue/relay/node";
import { createBySpaceDaemon, type BySpaceDaemon } from "./bootstrap.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { getOrCreateServerId } from "./server-id.js";
import { loadConfig } from "./config.js";
import { TunnelManager } from "./tunnel-manager.js";

/**
 * Issue 062 hardening scenarios beyond the happy path: denial when this
 * daemon (D1) has no password, and recovery after the relay restarts.
 */

const logger = pino({ level: "warn" });

let relay: ReturnType<typeof createNodeRelayServer>;
let relayPort = 0;
let d2: BySpaceDaemon;
let d2Home: string;
let service: http.Server;
let servicePort = 0;
let d2ServerId = "";
let d2KeyPairB64 = "";

const D2_PASSWORD = "tunnel-test-password";

beforeAll(async () => {
  relay = createNodeRelayServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    relay.server.listen(0, "127.0.0.1", () => {
      relayPort = (relay.server.address() as net.AddressInfo).port;
      resolve();
    });
  });

  service = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`hello path=${req.url}`);
  });
  await new Promise<void>((resolve) => {
    service.listen(0, "127.0.0.1", () => {
      servicePort = (service.address() as net.AddressInfo).port;
      resolve();
    });
  });

  const d2Root = await mkdtemp(path.join(os.tmpdir(), "tunnel-h-d2-"));
  d2Home = path.join(d2Root, ".byspace");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(d2Home, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  const { hashSync } = await import("bcryptjs");
  writeFileSync(
    path.join(d2Home, "config.json"),
    JSON.stringify(
      {
        version: 1,
        daemon: {
          auth: { password: hashSync(D2_PASSWORD, 12) },
          tunnel: { enabled: true, allowedPorts: [servicePort] },
        },
      },
      null,
      2,
    ),
  );
  d2ServerId = getOrCreateServerId(d2Home, { logger });
  const d2Config = loadConfig(d2Home);
  d2 = await createBySpaceDaemon(
    {
      ...d2Config,
      listen: "127.0.0.1:0",
      relayEnabled: true,
      relayEndpoint: `127.0.0.1:${relayPort}`,
      relayUseTls: false,
      relayPublicUseTls: false,
    },
    logger,
  );
  await d2.start();
  const keyPair = await loadOrCreateDaemonKeyPair(d2Home, logger);
  d2KeyPairB64 = keyPair.publicKeyB64;
}, 60_000);

afterAll(async () => {
  await d2?.stop().catch(() => undefined);
  service?.close();
  await relay?.close().catch(() => undefined);
});

async function waitForForwardConnected(manager: TunnelManager): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (manager.getStatus().some((f) => f.state === "connected")) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Tunnel forward did not reach connected state in time");
}

function relayClientUrl(): string {
  return buildRelayWebSocketUrl({
    endpoint: `127.0.0.1:${relayPort}`,
    serverId: d2ServerId,
    role: "client",
    useTls: false,
  });
}

describe("tunnel hardening (deny paths and reconnect)", () => {
  it("denies open when D2's allowlist does not cover the port", async () => {
    const manager = new TunnelManager({
      config: {
        peerId: d2ServerId,
        url: relayClientUrl(),
        password: D2_PASSWORD,
        daemonPublicKeyB64: d2KeyPairB64,
        // D2's own port is NOT the service port; nothing is allowed there.
        forwards: [{ remotePort: servicePort + 1 }],
      },
      logger,
    });
    await manager.start();
    try {
      const forward = manager.getStatus()[0];
      await expect(fetch(`http://127.0.0.1:${forward.localPort}/x`)).rejects.toThrow();
      // getStatus() returns fresh snapshots; re-read after the denial.
      const after = manager.getStatus()[0];
      expect(after.state === "error" || after.lastError !== null).toBe(true);
    } finally {
      await manager.stop();
    }
  }, 30_000);

  it("denies open when the peer password is wrong", async () => {
    const manager = new TunnelManager({
      config: {
        peerId: d2ServerId,
        url: relayClientUrl(),
        password: "wrong-password",
        daemonPublicKeyB64: d2KeyPairB64,
        forwards: [{ remotePort: servicePort }],
      },
      logger,
    });
    await manager.start();
    try {
      const forward = manager.getStatus()[0];
      await expect(fetch(`http://127.0.0.1:${forward.localPort}/x`)).rejects.toThrow();
    } finally {
      await manager.stop();
    }
  }, 30_000);

  it("recovers after the relay restarts (daemon reconnects, forwarding resumes)", async () => {
    const manager = new TunnelManager({
      config: {
        peerId: d2ServerId,
        url: relayClientUrl(),
        password: D2_PASSWORD,
        daemonPublicKeyB64: d2KeyPairB64,
        forwards: [{ remotePort: servicePort, label: "svc" }],
      },
      logger,
    });
    await manager.start();
    try {
      const forward = manager.getStatus()[0];
      // The embedded client connects asynchronously; wait for readiness.
      await waitForForwardConnected(manager);
      const first = await fetch(`http://127.0.0.1:${forward.localPort}/before`);
      expect(await first.text()).toBe("hello path=/before");

      // Kill and restart the relay in place (same port).
      await relay.close();
      const reopened = createNodeRelayServer({ port: relayPort, host: "127.0.0.1" });
      await new Promise<void>((resolve) => {
        reopened.server.listen(relayPort, "127.0.0.1", () => resolve());
      });
      relay = reopened;

      // The embedded client reconnects on its own; wait for the path to heal.
      const deadline = Date.now() + 30_000;
      let healed = false;
      while (Date.now() < deadline) {
        try {
          const again = await fetch(`http://127.0.0.1:${forward.localPort}/after`);
          if ((await again.text()) === "hello path=/after") {
            healed = true;
            break;
          }
        } catch {
          // not yet
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(healed).toBe(true);
    } finally {
      await manager.stop();
    }
  }, 60_000);
});
