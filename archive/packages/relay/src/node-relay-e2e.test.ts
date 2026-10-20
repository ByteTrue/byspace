/**
 * Node relay e2e: same scenarios as the wrangler-based e2e.test.ts, against
 * the self-hosted Node adapter. Asserts wire-compatibility of the two
 * implementations (see dist-handshake-parity.test.ts for the handshake side).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from "./crypto.js";
import { createNodeRelayServer } from "./node-adapter.js";

function rawToText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof (raw as { toString?: unknown }).toString === "function") {
    return (raw as { toString(): string }).toString();
  }
  return "";
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function onceMessage(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data as Buffer));
  });
}

describe("Node relay e2e with E2EE", () => {
  let port: number;
  let relay: ReturnType<typeof createNodeRelayServer>;

  beforeAll(async () => {
    relay = createNodeRelayServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      relay.server.once("error", reject);
      relay.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = relay.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to acquire port");
    }
    port = address.port;
  });

  afterAll(async () => {
    await relay.close();
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it(
    "full flow: daemon and client exchange encrypted messages through relay",
    { timeout: 30_000 },
    async () => {
      const serverId = "node-e2e-" + Date.now();
      const connectionId = "clt_node_" + Date.now() + "_" + Math.random().toString(36).slice(2);

      const daemonKeyPair = generateKeyPair();
      const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
      const clientKeyPair = generateKeyPair();
      const clientPubKeyB64 = exportPublicKey(clientKeyPair.publicKey);

      const clientSharedKey = deriveSharedKey(
        clientKeyPair.secretKey,
        importPublicKey(daemonPubKeyB64),
      );
      const daemonSharedKey = deriveSharedKey(
        daemonKeyPair.secretKey,
        importPublicKey(clientPubKeyB64),
      );

      const base = `ws://127.0.0.1:${port}/ws`;
      const daemonControlWs = await open(`${base}?serverId=${serverId}&role=server&v=2`);

      // Client connects; daemon control gets "connected" or a sync list.
      const waitForClientSeen = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("timed out waiting for connected")),
          5000,
        );
        const onMessage = (raw: unknown) => {
          try {
            const msg = JSON.parse(rawToText(raw));
            if (msg?.type === "connected" && msg.connectionId === connectionId) {
              clearTimeout(timeout);
              daemonControlWs.off("message", onMessage);
              resolve();
            }
            if (
              msg?.type === "sync" &&
              Array.isArray(msg.connectionIds) &&
              msg.connectionIds.includes(connectionId)
            ) {
              clearTimeout(timeout);
              daemonControlWs.off("message", onMessage);
              resolve();
            }
          } catch {
            // ignore
          }
        };
        daemonControlWs.on("message", onMessage);
      });

      const clientWs = await open(
        `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
      );
      await waitForClientSeen;

      const daemonWs = await open(
        `${base}?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
      );

      // Handshake: client hello with public key (not encrypted).
      clientWs.send(JSON.stringify({ type: "hello", key: clientPubKeyB64 }));
      const helloRaw = await onceMessage(daemonWs);
      const hello = JSON.parse(helloRaw.toString());
      expect(hello.type).toBe("hello");
      expect(hello.key).toBe(clientPubKeyB64);

      // Daemon -> client encrypted ready.
      daemonWs.send(Buffer.from(encrypt(daemonSharedKey, JSON.stringify({ type: "ready" }))));
      const readyRaw = await onceMessage(clientWs);
      expect(
        JSON.parse(new TextDecoder().decode(decrypt(clientSharedKey, toArrayBuffer(readyRaw)))),
      ).toEqual({ type: "ready" });

      // Client -> daemon encrypted.
      const clientMessage = "Hello from client!";
      clientWs.send(Buffer.from(encrypt(clientSharedKey, clientMessage)));
      const clientRaw = await onceMessage(daemonWs);
      expect(new TextDecoder().decode(decrypt(daemonSharedKey, toArrayBuffer(clientRaw)))).toBe(
        clientMessage,
      );

      // Daemon -> client encrypted.
      const daemonMessage = "Hello from daemon!";
      daemonWs.send(Buffer.from(encrypt(daemonSharedKey, daemonMessage)));
      const daemonRaw = await onceMessage(clientWs);
      expect(new TextDecoder().decode(decrypt(clientSharedKey, toArrayBuffer(daemonRaw)))).toBe(
        daemonMessage,
      );

      daemonWs.close();
      clientWs.close();
      daemonControlWs.close();
    },
  );

  it(
    "buffered frames: client frames before server data socket connect are flushed",
    { timeout: 15_000 },
    async () => {
      const serverId = "buffer-e2e-" + Date.now();
      const connectionId = "clt_buf_" + Date.now();

      const base = `ws://127.0.0.1:${port}/ws`;
      // Only client connects first; no daemon control needed for buffering.
      const clientWs = await open(
        `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
      );

      const payload = JSON.stringify({ type: "hello", key: "early-frame" });
      clientWs.send(payload);
      clientWs.send(payload);
      await sleep(100);

      // Now the daemon data socket connects and frames flush.
      // Register listeners before open: flushed frames can arrive in the same
      // tick as the open event.
      const daemonWs = new WebSocket(
        `${base}?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
      );
      const first = onceMessage(daemonWs);
      const second = onceMessage(daemonWs);
      await new Promise<void>((resolve, reject) => {
        daemonWs.once("open", () => resolve());
        daemonWs.once("error", reject);
      });
      const firstData = await first;
      const secondData = await second;
      expect(JSON.parse(firstData.toString())).toEqual({ type: "hello", key: "early-frame" });
      expect(JSON.parse(secondData.toString())).toEqual({ type: "hello", key: "early-frame" });

      clientWs.close();
      daemonWs.close();
    },
  );

  it(
    "frame types survive the relay: text stays text, binary stays binary",
    { timeout: 15_000 },
    async () => {
      const serverId = "frame-type-e2e-" + Date.now();
      const connectionId = "clt_frame_" + Date.now();

      const base = `ws://127.0.0.1:${port}/ws`;
      const clientWs = await open(
        `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
      );
      const daemonWs = await open(
        `${base}?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
      );

      const nextFrame = (ws: WebSocket) =>
        new Promise<{ data: Buffer; isBinary: boolean }>((resolve) => {
          ws.once("message", (data, isBinary) => resolve({ data: data as Buffer, isBinary }));
        });

      // client -> daemon, text frame. A plaintext hello must not become binary:
      // the daemon rejects a hello that arrives as a binary frame.
      const toDaemon = nextFrame(daemonWs);
      clientWs.send(JSON.stringify({ type: "hello", key: "text" }));
      const helloFrame = await toDaemon;
      expect(helloFrame.isBinary).toBe(false);
      expect(JSON.parse(helloFrame.data.toString())).toEqual({ type: "hello", key: "text" });

      // client -> daemon, binary frame.
      const binaryToDaemon = nextFrame(daemonWs);
      clientWs.send(Uint8Array.from([1, 2, 3]));
      const binaryFrame = await binaryToDaemon;
      expect(binaryFrame.isBinary).toBe(true);
      expect([...binaryFrame.data]).toEqual([1, 2, 3]);

      // daemon -> client, text and binary.
      const toClient = nextFrame(clientWs);
      daemonWs.send(JSON.stringify({ type: "ready" }));
      const readyFrame = await toClient;
      expect(readyFrame.isBinary).toBe(false);
      expect(JSON.parse(readyFrame.data.toString())).toEqual({ type: "ready" });

      const binaryToClient = nextFrame(clientWs);
      daemonWs.send(Uint8Array.from([4, 5]));
      const binaryFrameBack = await binaryToClient;
      expect(binaryFrameBack.isBinary).toBe(true);
      expect([...binaryFrameBack.data]).toEqual([4, 5]);

      clientWs.close();
      daemonWs.close();
    },
  );

  it("server data close forces client close (1012)", { timeout: 15_000 }, async () => {
    const serverId = "close-e2e-" + Date.now();
    const connectionId = "clt_close_" + Date.now();

    const base = `ws://127.0.0.1:${port}/ws`;
    const clientWs = await open(
      `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
    );
    const daemonWs = await open(
      `${base}?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
    );

    const clientClosed = new Promise<{ code: number; reason: string }>((resolve) => {
      clientWs.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    daemonWs.close(1000, "daemon done");
    const { code, reason } = await clientClosed;
    expect(code).toBe(1012);
    expect(reason).toBe("Server disconnected");

    clientWs.close();
  });

  it(
    "v2: connectionId-less clients each get their own routing id",
    { timeout: 15_000 },
    async () => {
      const serverId = "assign-e2e-" + Date.now();
      const base = `ws://127.0.0.1:${port}/ws`;

      const controlWs = await open(`${base}?serverId=${serverId}&role=server&v=2`);
      const seen: string[] = [];
      controlWs.on("message", (raw) => {
        const msg = JSON.parse(rawToText(raw));
        if (msg?.type === "connected") seen.push(msg.connectionId);
      });

      const firstClient = await open(`${base}?serverId=${serverId}&role=client&v=2`);
      const secondClient = await open(`${base}?serverId=${serverId}&role=client&v=2`);
      await sleep(200);

      expect(seen).toHaveLength(2);
      expect(new Set(seen).size).toBe(2);
      for (const id of seen) expect(id).toMatch(/^conn_/);

      firstClient.close();
      secondClient.close();
      controlWs.close();
    },
  );

  it(
    "v2: a second server-control socket replaces the first (1008)",
    { timeout: 15_000 },
    async () => {
      const serverId = "replace-e2e-" + Date.now();
      const base = `ws://127.0.0.1:${port}/ws`;

      const firstControl = await open(`${base}?serverId=${serverId}&role=server&v=2`);
      const firstClosed = new Promise<{ code: number; reason: string }>((resolve) => {
        firstControl.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      });

      const secondControl = await open(`${base}?serverId=${serverId}&role=server&v=2`);
      const { code, reason } = await firstClosed;
      expect(code).toBe(1008);
      expect(reason).toBe("Replaced by new connection");

      secondControl.close();
    },
  );

  it(
    "v2: server data socket survives while another client for the same connectionId remains",
    { timeout: 15_000 },
    async () => {
      const serverId = "multi-e2e-" + Date.now();
      const connectionId = "clt_multi_" + Date.now();
      const base = `ws://127.0.0.1:${port}/ws`;

      const controlWs = await open(`${base}?serverId=${serverId}&role=server&v=2`);
      const disconnects: string[] = [];
      controlWs.on("message", (raw) => {
        const msg = JSON.parse(rawToText(raw));
        if (msg?.type === "disconnected") disconnects.push(msg.connectionId);
      });

      const firstClient = await open(
        `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
      );
      const secondClient = await open(
        `${base}?serverId=${serverId}&role=client&connectionId=${connectionId}&v=2`,
      );
      const daemonWs = await open(
        `${base}?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
      );

      const daemonClosed = new Promise<void>((resolve) => daemonWs.once("close", () => resolve()));

      firstClient.close();
      await sleep(300);
      expect(daemonWs.readyState).toBe(WebSocket.OPEN);
      expect(disconnects).toHaveLength(0);

      // Last client leaving closes the server data socket (1001) and notifies control.
      secondClient.close();
      await daemonClosed;
      expect(disconnects).toContain(connectionId);

      controlWs.close();
    },
  );

  it("v1: single pair forwarding", { timeout: 15_000 }, async () => {
    const serverId = "v1-e2e-" + Date.now();
    const base = `ws://127.0.0.1:${port}/ws`;

    const daemonWs = await open(`${base}?serverId=${serverId}&role=server&v=1`);
    const clientWs = await open(`${base}?serverId=${serverId}&role=client&v=1`);

    clientWs.send("v1-hello");
    expect((await onceMessage(daemonWs)).toString()).toBe("v1-hello");

    daemonWs.send("v1-ack");
    expect((await onceMessage(clientWs)).toString()).toBe("v1-ack");

    daemonWs.close();
    clientWs.close();
  });

  it("rejects missing serverId and invalid v", async () => {
    const base = `ws://127.0.0.1:${port}/ws`;
    await expect(open(`${base}?role=server&v=2`)).rejects.toThrow();
    await expect(open(`${base}?serverId=s&role=server&v=3`)).rejects.toThrow();
    await expect(open(`${base}?serverId=s&v=2`)).rejects.toThrow();
  });
});

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
