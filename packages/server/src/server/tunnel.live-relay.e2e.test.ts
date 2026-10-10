import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { hashSync } from "bcryptjs";

import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { createBySpaceDaemon, type BySpaceDaemon } from "./bootstrap.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { getOrCreateServerId } from "./server-id.js";
import { loadConfig } from "./config.js";
import { TunnelManager } from "./tunnel-manager.js";

/**
 * Issue 062 live verification: the same daemon-tunnel flow as tunnel.e2e.test.ts
 * but through the real hosted relay (relay.byspace.cc.cd, Cloudflare Worker) —
 * public TLS, the production v2 handshake, and real WAN round trips. Skipped
 * unless RUN_LIVE_RELAY_E2E=1, mirroring live-relay.e2e.test.ts.
 */

const logger = pino({ level: "warn" });
const LIVE_RELAY_ENDPOINT = "relay.byspace.cc.cd:443";
const D2_PASSWORD = "tunnel-live-password";

let d2: BySpaceDaemon;
let d2Home: string;
let service: http.Server;
let servicePort = 0;
let manager: TunnelManager;
let d2ServerId = "";

beforeAll(async () => {
  const d2Root = await mkdtemp(path.join(os.tmpdir(), "tunnel-live-d2-"));
  d2Home = path.join(d2Root, ".byspace");
  await mkdir(d2Home, { recursive: true });

  service = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`hello from live d2 path=${req.url}`);
  });
  await new Promise<void>((resolve) => {
    service.listen(0, "127.0.0.1", () => {
      servicePort = (service.address() as net.AddressInfo).port;
      resolve();
    });
  });

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
      relayEndpoint: LIVE_RELAY_ENDPOINT,
      relayUseTls: true,
      relayPublicUseTls: true,
    },
    logger,
  );
  await d2.start();

  const d2KeyPair = await loadOrCreateDaemonKeyPair(d2Home, logger);
  manager = new TunnelManager({
    config: {
      peerId: d2ServerId,
      url: buildRelayWebSocketUrl({
        endpoint: LIVE_RELAY_ENDPOINT,
        serverId: d2ServerId,
        role: "client",
        useTls: true,
      }),
      password: D2_PASSWORD,
      daemonPublicKeyB64: d2KeyPair.publicKeyB64,
      forwards: [{ remotePort: servicePort, label: "live-service" }],
    },
    logger,
  });
  await manager.start();
}, 120_000);

afterAll(async () => {
  await manager?.stop().catch(() => undefined);
  await d2?.stop().catch(() => undefined);
  service?.close();
});

describe("daemon tunnel via the live hosted relay", () => {
  it(
    "forwards an HTTP request to D2's whitelisted service over the public relay",
    { timeout: 90_000 },
    async () => {
      const forward = manager.getStatus()[0];
      expect(forward).toBeDefined();
      expect(forward.localPort).not.toBeNull();

      // The embedded client must reach connected through the public relay;
      // allow generous time for WAN + CF round trips.
      const deadline = Date.now() + 60_000;
      let response: Response | null = null;
      let body = "";
      while (Date.now() < deadline) {
        try {
          response = await fetch(`http://127.0.0.1:${forward.localPort}/live`);
          body = await response.text();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
      expect(response?.status).toBe(200);
      expect(body).toBe(`hello from live d2 path=/live`);
    },
  );
});
