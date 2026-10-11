import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";

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
 * A tunnel forwards raw TCP, so an LLM-style streaming response (SSE, chunked
 * transfer) survives only if neither side coalesces or buffers. This drives a
 * server that emits N chunks spaced by a delay and measures when each arrives
 * at the client end of the tunnel.
 *
 * The failure this guards against is silent: a buffering implementation still
 * delivers every byte, just all at once at the end, so an assertion on the
 * final body would pass. The assertion here is on arrival timing.
 */

const logger = pino({ level: "warn" });

const D2_PASSWORD = "tunnel-streaming-password";
const CHUNK_COUNT = 6;
const CHUNK_INTERVAL_MS = 120;

let relay: ReturnType<typeof createNodeRelayServer>;
let relayPort = 0;
let d2: BySpaceDaemon;
let service: http.Server;
let servicePort = 0;
let manager: TunnelManager;

beforeAll(async () => {
  relay = createNodeRelayServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    relay.server.listen(0, "127.0.0.1", () => {
      relayPort = (relay.server.address() as net.AddressInfo).port;
      resolve();
    });
  });

  // A streaming service: one chunk every CHUNK_INTERVAL_MS, no content-length
  // (chunked transfer encoding), flushed per chunk — the shape of an SSE or
  // streaming-completions response.
  service = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      res.write(`data: chunk-${sent}\n\n`);
      if (sent >= CHUNK_COUNT) {
        clearInterval(timer);
        res.end();
      }
    }, CHUNK_INTERVAL_MS);
    req.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => {
    service.listen(0, "127.0.0.1", () => {
      servicePort = (service.address() as net.AddressInfo).port;
      resolve();
    });
  });

  const d2Root = await mkdtemp(path.join(os.tmpdir(), "tunnel-stream-d2-"));
  const d2Home = path.join(d2Root, ".byspace");
  await mkdir(d2Home, { recursive: true });
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
  const d2ServerId = getOrCreateServerId(d2Home, { logger });
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

  const d2KeyPair = await loadOrCreateDaemonKeyPair(d2Home, logger);
  manager = new TunnelManager({
    config: {
      peerId: d2ServerId,
      url: buildRelayWebSocketUrl({
        endpoint: `127.0.0.1:${relayPort}`,
        serverId: d2ServerId,
        role: "client",
        useTls: false,
      }),
      password: D2_PASSWORD,
      daemonPublicKeyB64: d2KeyPair.publicKeyB64,
      forwards: [{ remotePort: servicePort, label: "stream-service" }],
    },
    logger,
  });
  await manager.start();
  await new Promise((resolve) => setTimeout(resolve, 500));
}, 60_000);

afterAll(async () => {
  await manager?.stop().catch(() => undefined);
  await d2?.stop().catch(() => undefined);
  service?.close();
  await relay?.close().catch(() => undefined);
});

describe("tunnel streaming", () => {
  it("delivers chunks as they are produced, not coalesced at the end", async () => {
    const forward = manager.getStatus()[0];
    expect(forward.localPort).not.toBeNull();

    const startedAt = Date.now();
    const arrivals: number[] = [];
    let body = "";

    // Raw TCP so chunk boundaries are observable; fetch would reassemble.
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: forward.localPort as number }, () => {
        socket.write(`GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      socket.on("data", (chunk: Buffer) => {
        arrivals.push(Date.now() - startedAt);
        body += chunk.toString("utf8");
      });
      socket.on("end", () => resolve());
      socket.on("error", reject);
      socket.setTimeout(30_000, () => {
        socket.destroy();
        reject(new Error("stream timed out"));
      });
    });

    // Every chunk arrived.
    for (let i = 1; i <= CHUNK_COUNT; i += 1) {
      expect(body).toContain(`data: chunk-${i}`);
    }

    // The last chunk landed roughly CHUNK_COUNT intervals after the first —
    // if either side buffered the whole response, all of it would arrive at
    // once and this span would collapse to near zero.
    const firstArrival = arrivals[0] ?? 0;
    const lastArrival = arrivals[arrivals.length - 1] ?? 0;
    const span = lastArrival - firstArrival;
    const expectedSpan = CHUNK_INTERVAL_MS * (CHUNK_COUNT - 1);
    expect(span).toBeGreaterThan(expectedSpan * 0.5);
  }, 60_000);
});
