import { once } from "node:events";
import { connect as connectTcp } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createClientChannel,
  createDaemonChannel,
  type EncryptedChannel,
  type Transport,
} from "./encrypted-channel.js";
import { exportPublicKey, generateKeyPair } from "./crypto.js";
import { startStandaloneRelayServer, type StandaloneRelayServer } from "./standalone-adapter.js";

interface QueuedMessage {
  data: WebSocket.RawData;
  isBinary: boolean;
}

interface MessageQueue {
  next: () => Promise<QueuedMessage>;
}

function createMessageQueue(socket: WebSocket): MessageQueue {
  const pending: QueuedMessage[] = [];
  const waiters: Array<(message: QueuedMessage) => void> = [];
  socket.on("message", (data, isBinary) => {
    const message = { data, isBinary };
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    pending.push(message);
  });
  return {
    next: async () => {
      const message = pending.shift();
      if (message) return message;
      return await new Promise<QueuedMessage>((resolve) => waiters.push(resolve));
    },
  };
}

const TEST_ACCESS_TOKEN = "test-data-relay-token";

async function openSocket(
  url: string,
  accessToken = TEST_ACCESS_TOKEN,
): Promise<{ socket: WebSocket; messages: MessageQueue }> {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const messages = createMessageQueue(socket);
  await once(socket, "open");
  return { socket, messages };
}

async function sendRawHttp(port: number, request: string): Promise<string> {
  const socket = connectTcp({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await once(socket, "connect");
  socket.write(request);
  await once(socket, "end");
  socket.destroy();
  return Buffer.concat(chunks).toString("utf8");
}

function decodeText(message: QueuedMessage): string {
  return Buffer.isBuffer(message.data)
    ? message.data.toString("utf8")
    : Buffer.from(message.data as ArrayBuffer).toString("utf8");
}

function createTransport(socket: WebSocket): Transport {
  const transport: Transport = {
    send: (data) =>
      new Promise<void>((resolve, reject) => {
        socket.send(data, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    close: (code, reason) => socket.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.on("message", (data, isBinary) => {
    const normalized = isBinary
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data.toString("utf8");
    transport.onmessage?.({ data: normalized, isBinary });
  });
  socket.on("close", (code, reason) => transport.onclose?.(code, reason.toString("utf8")));
  socket.on("error", (error) => transport.onerror?.(error));
  return transport;
}

function waitForControlMessage(
  queue: MessageQueue,
  type: "connected" | "disconnected" | "sync",
): Promise<Record<string, unknown>> {
  return (async () => {
    while (true) {
      const parsed = JSON.parse(decodeText(await queue.next())) as Record<string, unknown>;
      if (parsed.type === type) return parsed;
    }
  })();
}

async function waitForOpenChannel(
  create: (events: { onopen: () => void }) => Promise<EncryptedChannel>,
): Promise<EncryptedChannel> {
  let resolveOpen!: () => void;
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const channel = await create({ onopen: resolveOpen });
  await opened;
  return channel;
}

describe("standalone relay adapter", () => {
  const servers: StandaloneRelayServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  async function start(
    options: {
      maxBufferedBytes?: number;
      maxConnectionsPerSession?: number;
      maxSessions?: number;
      maxSockets?: number;
      maxTotalBufferedBytes?: number;
      pairingTimeoutMs?: number;
    } = {},
  ) {
    const server = await startStandaloneRelayServer({
      host: "127.0.0.1",
      port: 0,
      accessToken: TEST_ACCESS_TOKEN,
      ...options,
    });
    servers.push(server);
    return server;
  }

  async function connect(url: string) {
    const opened = await openSocket(url);
    sockets.push(opened.socket);
    return opened;
  }

  it("serves health and rejects unsupported relay versions", async () => {
    const server = await start();

    const health = await fetch(`${server.httpUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const response = await fetch(`${server.httpUrl}/ws?serverId=srv_test&role=server&v=1`);
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 2)");
  });

  it("rejects malformed HTTP and upgrade targets without stopping the relay", async () => {
    const server = await start();
    const malformedHttp = await sendRawHttp(
      server.port,
      "GET http://[ HTTP/1.1\r\nHost: relay.local\r\nConnection: close\r\n\r\n",
    );
    expect(malformedHttp).toContain("HTTP/1.1 400 Bad Request");
    expect(malformedHttp).toContain("Malformed request target");

    const malformedUpgrade = await sendRawHttp(
      server.port,
      "GET http://[ HTTP/1.1\r\n" +
        "Host: relay.local\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        `Authorization: Bearer ${TEST_ACCESS_TOKEN}\r\n` +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    expect(malformedUpgrade).toContain("HTTP/1.1 400 Bad Request");
    expect(malformedUpgrade).toContain("Malformed request target");

    const health = await fetch(`${server.httpUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("requires the configured access token for WebSocket upgrades", async () => {
    const server = await start();
    const socket = new WebSocket(`${server.wsUrl}/ws?serverId=srv_auth&role=server&v=2`);
    const response = once(socket, "unexpected-response");

    const [, httpResponse] = await response;
    const rejectedResponse = httpResponse as { statusCode?: number; destroy: () => void };
    expect(rejectedResponse.statusCode).toBe(401);
    rejectedResponse.destroy();
  });

  it("rejects clients until the target daemon control socket is online", async () => {
    const server = await start();
    const socket = new WebSocket(`${server.wsUrl}/ws?serverId=srv_offline&role=client&v=2`, {
      headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
    });
    sockets.push(socket);
    const closed = once(socket, "close");

    await once(socket, "open");
    const [code] = await closed;
    expect(code).toBe(1013);
  });

  it("enforces per-session connection limits", async () => {
    const server = await start({ maxConnectionsPerSession: 1 });
    const serverId = "srv_limited";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    await waitForControlMessage(control.messages, "connected");

    const rejected = new WebSocket(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`, {
      headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
    });
    sockets.push(rejected);
    const closed = once(rejected, "close");
    await once(rejected, "open");
    const [code] = await closed;
    expect(code).toBe(1013);
  });

  it("rejects a duplicate control socket instead of replacing the active target", async () => {
    const server = await start();
    const serverId = "srv_duplicate_control";
    const firstControl = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(firstControl.messages, "sync");

    const secondControl = new WebSocket(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`, {
      headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
    });
    sockets.push(secondControl);
    const secondClosed = once(secondControl, "close");
    await once(secondControl, "open");
    const [code] = await secondClosed;
    expect(code).toBe(1008);

    firstControl.socket.send(JSON.stringify({ type: "ping" }));
    await expect(waitForControlMessage(firstControl.messages, "pong")).resolves.toMatchObject({
      type: "pong",
    });
  });

  it("enforces a relay-wide physical socket limit", async () => {
    const server = await start({ maxSockets: 1 });
    const control = await connect(`${server.wsUrl}/ws?serverId=srv_socket_limit&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");

    const rejected = new WebSocket(`${server.wsUrl}/ws?serverId=srv_other&role=server&v=2`, {
      headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
    });
    const unexpectedResponse = once(rejected, "unexpected-response");
    const [, response] = await unexpectedResponse;
    const httpResponse = response as { statusCode?: number; destroy: () => void };
    expect(httpResponse.statusCode).toBe(503);
    httpResponse.destroy();
  });

  it("enforces a relay-wide pending-byte budget", async () => {
    const server = await start({ maxBufferedBytes: 8, maxTotalBufferedBytes: 6 });
    const serverId = "srv_total_buffer";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    const first = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    await waitForControlMessage(control.messages, "connected");
    first.socket.send("1234");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    await waitForControlMessage(control.messages, "connected");
    const closed = once(second.socket, "close");
    second.socket.send("1234");
    const [code] = await closed;
    expect(code).toBe(1013);
    expect(first.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("times out clients that never get a matching server data socket", async () => {
    const server = await start({ pairingTimeoutMs: 10 });
    const serverId = "srv_pair_timeout";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    const client = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    const connected = await waitForControlMessage(control.messages, "connected");
    const clientClosed = once(client.socket, "close");

    const [code] = await clientClosed;
    expect(code).toBe(1013);
    await expect(waitForControlMessage(control.messages, "disconnected")).resolves.toEqual({
      type: "disconnected",
      connectionId: connected.connectionId,
    });
  });

  it("closes the matching server socket when its client disconnects", async () => {
    const server = await start();
    const serverId = "srv_disconnect";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    const client = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    const connected = await waitForControlMessage(control.messages, "connected");
    const target = await connect(
      `${server.wsUrl}/ws?serverId=${serverId}&role=server&connectionId=${connected.connectionId}&v=2`,
    );
    const targetClosed = once(target.socket, "close");

    client.socket.close(1000, "done");

    const [code] = await targetClosed;
    expect(code).toBe(1001);
    await expect(waitForControlMessage(control.messages, "disconnected")).resolves.toEqual({
      type: "disconnected",
      connectionId: connected.connectionId,
    });
  });

  it("stops gracefully and closes active sockets", async () => {
    const server = await start();
    const control = await connect(`${server.wsUrl}/ws?serverId=srv_stop&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    const closed = once(control.socket, "close");

    await server.stop();
    await closed;
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("pairs relay v2 client and server data sockets with transparent forwarding", async () => {
    const server = await start();
    const serverId = "srv_pair";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await expect(waitForControlMessage(control.messages, "sync")).resolves.toEqual({
      type: "sync",
      connectionIds: [],
    });

    const client = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    const connected = await waitForControlMessage(control.messages, "connected");
    const connectionId = connected.connectionId;
    expect(connectionId).toEqual(expect.stringMatching(/^conn_/));

    client.socket.send("before-pair");
    const target = await connect(
      `${server.wsUrl}/ws?serverId=${serverId}&role=server&connectionId=${connectionId}&v=2`,
    );
    expect(decodeText(await target.messages.next())).toBe("before-pair");

    target.socket.send(Uint8Array.from([1, 2, 3]));
    const binary = await client.messages.next();
    expect(binary.isBinary).toBe(true);
    expect(Buffer.from(binary.data as Buffer)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("carries an existing E2EE channel without seeing application plaintext", async () => {
    const server = await start();
    const serverId = "srv_e2ee";
    const keyPair = generateKeyPair();
    const daemonPublicKey = exportPublicKey(keyPair.publicKey);
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");

    const clientSocket = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    const connected = await waitForControlMessage(control.messages, "connected");
    const targetSocket = await connect(
      `${server.wsUrl}/ws?serverId=${serverId}&role=server&connectionId=${connected.connectionId}&v=2`,
    );

    let daemonMessage!: string | ArrayBuffer;
    const daemonReceived = new Promise<void>((resolve) => {
      void waitForOpenChannel((events) =>
        createDaemonChannel(createTransport(targetSocket.socket), keyPair, {
          ...events,
          onmessage: (data) => {
            daemonMessage = data;
            resolve();
          },
        }),
      ).then(async (daemonChannel) => {
        await daemonReceived;
        return daemonChannel.send(Uint8Array.from([9, 8, 7]).buffer);
      });
    });

    let clientMessage!: string | ArrayBuffer;
    const clientReceived = new Promise<void>((resolve) => {
      void waitForOpenChannel((events) =>
        createClientChannel(createTransport(clientSocket.socket), daemonPublicKey, {
          ...events,
          onmessage: (data) => {
            clientMessage = data;
            resolve();
          },
        }),
      ).then((clientChannel) => clientChannel.send("secret-request"));
    });

    await Promise.all([daemonReceived, clientReceived]);
    expect(daemonMessage).toBe("secret-request");
    expect(new Uint8Array(clientMessage as ArrayBuffer)).toEqual(Uint8Array.from([9, 8, 7]));
  });

  it("fails both sides instead of buffering beyond the configured limit", async () => {
    const server = await start({ maxBufferedBytes: 4 });
    const serverId = "srv_backpressure";
    const control = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=server&v=2`);
    await waitForControlMessage(control.messages, "sync");
    const client = await connect(`${server.wsUrl}/ws?serverId=${serverId}&role=client&v=2`);
    const connected = await waitForControlMessage(control.messages, "connected");
    const target = await connect(
      `${server.wsUrl}/ws?serverId=${serverId}&role=server&connectionId=${connected.connectionId}&v=2`,
    );

    const clientClosed = once(client.socket, "close");
    const targetClosed = once(target.socket, "close");
    client.socket.send("12345");

    await Promise.all([clientClosed, targetClosed]);
  });
});
