import http from "node:http";
import net from "node:net";
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
 * Issue 062 vertical slice: two real in-process daemons + a real Node relay.
 * D2 (target) runs a plain HTTP server on a port in its allowlist and has a
 * password. D1 (initiator) embeds a TunnelManager whose DaemonClient connects
 * to D2 through the relay with E2EE + password. A plain TCP client hitting
 * D1's local forwarded port must get the HTTP response bytes from D2's
 * service — end to end through: local socket → tunnel frames → E2EE WS →
 * relay → D2 session → target socket → HTTP response → back the same path.
 */

const logger = pino({ level: "warn" });

let relay: ReturnType<typeof createNodeRelayServer>;
let relayPort = 0;
let d2: BySpaceDaemon;
let d2Home: string;
let service: http.Server;
let servicePort = 0;
let manager: TunnelManager;
let d2ServerId = "";

const D2_PASSWORD = "tunnel-test-password";

beforeAll(async () => {
  // 1. Node relay on an OS-assigned port.
  relay = createNodeRelayServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    relay.server.listen(0, "127.0.0.1", () => {
      relayPort = (relay.server.address() as net.AddressInfo).port;
      resolve();
    });
  });

  // 2. Real HTTP service on D2's host loopback (its port is the allowlist entry).
  service = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`hello from d2 service path=${req.url}`);
  });
  await new Promise<void>((resolve) => {
    service.listen(0, "127.0.0.1", () => {
      servicePort = (service.address() as net.AddressInfo).port;
      resolve();
    });
  });

  // 3. D2: target daemon — password on, relay on, tunnel allowlist persisted
  // via config.json before boot (DaemonConfigStore reads it at startup).
  const d2Root = await mkdtemp(path.join(os.tmpdir(), "tunnel-d2-"));
  d2Home = path.join(d2Root, ".byspace");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(d2Home, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  // bcrypt hash of D2_PASSWORD (cost 12, matching DAEMON_PASSWORD_BCRYPT_COST)
  const { hashSync } = await import("bcryptjs");
  const passwordHash = hashSync(D2_PASSWORD, 12);
  writeFileSync(
    path.join(d2Home, "config.json"),
    JSON.stringify(
      {
        version: 1,
        daemon: {
          auth: { password: passwordHash },
          tunnel: { allowedPorts: [servicePort] },
        },
      },
      null,
      2,
    ),
  );
  d2ServerId = getOrCreateServerId(d2Home, { logger });

  // Real config resolution: config.json on disk carries the bcrypt password
  // hash and the tunnel allowlist — exactly the production load path.
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

  // 4. D2's daemon public key for the E2EE client channel.
  const d2KeyPair = await loadOrCreateDaemonKeyPair(d2Home, logger);
  const relayClientUrl = buildRelayWebSocketUrl({
    endpoint: `127.0.0.1:${relayPort}`,
    serverId: d2ServerId,
    role: "client",
    useTls: false,
  });

  // 5. TunnelManager on the D1 side (D1 daemon process is not needed for the
  // slice — the manager only needs the client stack; daemon-level wiring
  // lands with the bootstrap batch).
  manager = new TunnelManager({
    config: {
      peerId: d2ServerId,
      url: relayClientUrl,
      password: D2_PASSWORD,
      daemonPublicKeyB64: d2KeyPair.publicKeyB64,
      forwards: [{ remotePort: servicePort, label: "d2-service" }],
    },
    logger,
  });
  await manager.start();

  // Give the embedded client a moment to connect through the relay.
  await new Promise((resolve) => setTimeout(resolve, 500));
}, 60_000);

afterAll(async () => {
  await manager?.stop().catch(() => undefined);
  await d2?.stop().catch(() => undefined);
  service?.close();
  await relay?.close().catch(() => undefined);
});

describe("daemon tunnel end-to-end (D1 → relay → D2)", () => {
  it("forwards an HTTP request to D2's whitelisted service", async () => {
    const status = manager.getStatus();
    expect(status.length).toBe(1);
    const forward = status[0];
    expect(forward.localPort).not.toBeNull();

    const response = await fetch(`http://127.0.0.1:${forward.localPort}/ping`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("hello from d2 service path=/ping");
  }, 30_000);

  it("supports concurrent streams on the same forwarded port", async () => {
    const forward = manager.getStatus()[0];
    const [a, b] = await Promise.all([
      fetch(`http://127.0.0.1:${forward.localPort}/a`),
      fetch(`http://127.0.0.1:${forward.localPort}/b`),
    ]);
    expect(await a.text()).toBe("hello from d2 service path=/a");
    expect(await b.text()).toBe("hello from d2 service path=/b");
  }, 30_000);
});
