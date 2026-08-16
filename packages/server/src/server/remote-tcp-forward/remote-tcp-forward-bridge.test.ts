import { EventEmitter, once } from "node:events";
import { createServer, Socket, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import {
  RemoteTcpForwardFrameOpcode,
  decodeRemoteTcpForwardFrame,
  encodeRemoteTcpForwardResetFrame,
} from "@bytetrue/byspace-protocol/remote-tcp-forward";
import {
  bridgeRemoteTcpForwardSocket,
  type RemoteTcpForwardChannel,
} from "./remote-tcp-forward-bridge.js";
import {
  acceptRemoteTcpForwardChannel,
  openRemoteTcpForwardChannel,
} from "./remote-tcp-forward-session.js";
import { RemoteTcpForwardManager } from "./remote-tcp-forward-manager.js";

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array | null {
  if (typeof data === "string") return null;
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function createEchoServer(): Server {
  return createServer({ allowHalfOpen: true }, (socket) => {
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => chunks.push(chunk);
    const reply = () => socket.end(Buffer.concat(chunks));
    socket.on("data", collect);
    socket.once("end", reply);
  });
}

class MemoryChannel implements RemoteTcpForwardChannel {
  readonly emitter = new EventEmitter();
  peer: MemoryChannel | null = null;
  private closed = false;
  private unackedDataFrames = 0;
  maxUnackedDataFrames = 0;

  async send(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    if (this.closed || !this.peer) throw new Error("channel closed");
    const bytes = toBytes(data);
    const frame = bytes ? decodeRemoteTcpForwardFrame(bytes) : null;
    if (frame?.opcode === RemoteTcpForwardFrameOpcode.Data) {
      this.unackedDataFrames += 1;
      this.maxUnackedDataFrames = Math.max(this.maxUnackedDataFrames, this.unackedDataFrames);
    } else if (frame?.opcode === RemoteTcpForwardFrameOpcode.Ack) {
      this.peer.unackedDataFrames -= 1;
    }
    const delivered =
      typeof data === "string"
        ? data
        : bytes!.buffer.slice(bytes!.byteOffset, bytes!.byteOffset + bytes!.byteLength);
    queueMicrotask(() => this.peer?.emitter.emit("message", delivered));
  }

  close(code = 1000, reason = "closed"): void {
    if (Buffer.byteLength(reason) > 123) throw new Error("WebSocket close reason is too long");
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    queueMicrotask(() => {
      this.emitter.emit("close", code, reason);
      peer?.emitter.emit("close", code, reason);
    });
  }

  on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): void {
    this.emitter.on(event, listener);
  }
}

function createChannelPair(): [MemoryChannel, MemoryChannel] {
  const left = new MemoryChannel();
  const right = new MemoryChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

async function createSocketPair(): Promise<{
  client: Socket;
  accepted: Socket;
  server: Server;
}> {
  const server = createServer({ allowHalfOpen: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing listener address");

  const connection = once(server, "connection");
  const client = await new Promise<Socket>((resolve, reject) => {
    const socket = new Socket({ allowHalfOpen: true });
    socket.once("error", reject);
    socket.connect(address.port, "127.0.0.1", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
  const [accepted] = (await connection) as [Socket];
  return { client, accepted, server };
}

function readUntilEnd(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => resolve(Buffer.concat(chunks)));
    socket.once("error", reject);
  });
}

interface TestActiveForward {
  server: Server;
  streams: Set<{ socket: Socket }>;
}

function getActiveForward(manager: RemoteTcpForwardManager): TestActiveForward {
  const internals = manager as unknown as { forwards: Map<string, TestActiveForward> };
  const [forward] = internals.forwards.values();
  if (!forward) throw new Error("missing active forward");
  return forward;
}

describe("remote TCP forward bridge", () => {
  it("preserves bytes, half-close, and one-frame backpressure in both directions", async () => {
    const left = await createSocketPair();
    const right = await createSocketPair();
    const [leftChannel, rightChannel] = createChannelPair();
    const leftBridge = bridgeRemoteTcpForwardSocket(left.accepted, leftChannel, {
      ackTimeoutMs: 2_000,
    });
    const rightBridge = bridgeRemoteTcpForwardSocket(right.accepted, rightChannel, {
      ackTimeoutMs: 2_000,
    });

    const request = Buffer.alloc(1024 * 1024, 0x5a);
    const response = Buffer.alloc(256 * 1024, 0xa5);
    const requestRead = readUntilEnd(right.client);
    const responseRead = readUntilEnd(left.client);

    left.client.end(request);
    await expect(requestRead).resolves.toEqual(request);
    right.client.end(response);
    await expect(responseRead).resolves.toEqual(response);

    expect(leftChannel.maxUnackedDataFrames).toBe(1);
    expect(rightChannel.maxUnackedDataFrames).toBe(1);

    left.client.destroy();
    right.client.destroy();
    leftBridge.close();
    rightBridge.close();
    left.server.close();
    right.server.close();
  });

  it("destroys the TCP socket when the Relay channel closes", async () => {
    const pair = await createSocketPair();
    const [leftChannel, rightChannel] = createChannelPair();
    const bridge = bridgeRemoteTcpForwardSocket(pair.accepted, leftChannel);
    const closed = once(pair.accepted, "close");

    rightChannel.close(1012, "relay disconnected");
    await closed;
    expect(pair.accepted.destroyed).toBe(true);
    pair.client.destroy();

    bridge.close();
    pair.server.close();
  });

  it("opens only the requested loopback port before bridging bytes", async () => {
    const target = createEchoServer();
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === "string") {
      throw new Error("missing target address");
    }

    const local = await createSocketPair();
    const [sourceChannel, targetChannel] = createChannelPair();
    const accepted = acceptRemoteTcpForwardChannel(targetChannel, { handshakeTimeoutMs: 2_000 });
    await openRemoteTcpForwardChannel(sourceChannel, targetAddress.port, {
      handshakeTimeoutMs: 2_000,
    });
    const bridge = bridgeRemoteTcpForwardSocket(local.accepted, sourceChannel, {
      ackTimeoutMs: 2_000,
    });
    const payload = Buffer.from("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n");
    const response = readUntilEnd(local.client);

    local.client.end(payload);
    await expect(response).resolves.toEqual(payload);

    bridge.close();
    sourceChannel.close();
    await accepted;
    local.client.destroy();
    local.server.close();
    target.close();
  });

  it("closes the Relay channel for long and multibyte RESET reasons", async () => {
    for (const reason of ["x".repeat(124), "x".repeat(1024), "界".repeat(100)]) {
      const { client, accepted, server } = await createSocketPair();
      const [sourceChannel, targetChannel] = createChannelPair();
      bridgeRemoteTcpForwardSocket(accepted, sourceChannel);
      const socketClosed = once(accepted, "close");
      const channelClosed = once(targetChannel.emitter, "close");

      await targetChannel.send(encodeRemoteTcpForwardResetFrame(reason));
      await Promise.all([socketClosed, channelClosed]);
      client.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("returns a bounded error when the remote loopback port is unavailable", async () => {
    const unavailable = createServer();
    unavailable.listen(0, "127.0.0.1");
    await once(unavailable, "listening");
    const address = unavailable.address();
    if (!address || typeof address === "string") throw new Error("missing target address");
    const port = address.port;
    unavailable.close();
    await once(unavailable, "close");

    const [sourceChannel, targetChannel] = createChannelPair();
    const accepted = acceptRemoteTcpForwardChannel(targetChannel, { handshakeTimeoutMs: 2_000 });
    await expect(
      openRemoteTcpForwardChannel(sourceChannel, port, { handshakeTimeoutMs: 2_000 }),
    ).rejects.toThrow(/loopback port/i);
    await accepted;
  });

  it("caps concurrent target-side channels", async () => {
    const channels = Array.from({ length: 256 }, () => createChannelPair());
    const accepted = channels.map(([, targetChannel]) =>
      acceptRemoteTcpForwardChannel(targetChannel, { handshakeTimeoutMs: 60_000 }),
    );
    const [overflowSource, overflowTarget] = createChannelPair();
    const overflowClosed = once(overflowSource.emitter, "close");

    await acceptRemoteTcpForwardChannel(overflowTarget);
    await overflowClosed;
    for (const [sourceChannel] of channels) sourceChannel.close();
    await Promise.all(accepted);
  });

  it("owns a loopback listener for the controlling session and falls back from a busy port", async () => {
    const target = createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket));
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === "string") {
      throw new Error("missing target address");
    }

    const manager = new RemoteTcpForwardManager({
      connectRemote: async () => {
        const [sourceChannel, targetChannel] = createChannelPair();
        void acceptRemoteTcpForwardChannel(targetChannel);
        return sourceChannel;
      },
    });
    const info = await manager.open("session-1", {
      target: {
        v: 2,
        serverId: "remote-daemon",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "https://relay.example.com", useTls: true },
      },
      targetPort: targetAddress.port,
    });

    expect(info.localHost).toBe("127.0.0.1");
    expect(info.localPort).not.toBe(targetAddress.port);
    const client = new Socket({ allowHalfOpen: true });
    const connected = new Promise<void>((resolve, reject) => {
      client.once("error", reject);
      client.connect(info.localPort, info.localHost, () => {
        client.off("error", reject);
        resolve();
      });
    });
    await connected;
    const response = readUntilEnd(client);
    client.end("forwarded");
    await expect(response).resolves.toEqual(Buffer.from("forwarded"));

    await manager.closeOwner("session-1");
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.once("error", reject);
        socket.connect(info.localPort, info.localHost, resolve);
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    client.destroy();
    target.close();
  });

  it("owns accepted socket errors while the Relay connection is pending", async () => {
    let markConnectStarted!: () => void;
    let releaseRemote!: (channel: RemoteTcpForwardChannel) => void;
    const connectStarted = new Promise<void>((resolve) => {
      markConnectStarted = resolve;
    });
    const pendingRemote = new Promise<RemoteTcpForwardChannel>((resolve) => {
      releaseRemote = resolve;
    });
    const manager = new RemoteTcpForwardManager({
      connectRemote: () => {
        markConnectStarted();
        return pendingRemote;
      },
    });
    const info = await manager.open("reset-session", {
      target: {
        v: 2,
        serverId: "remote-daemon",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "https://relay.example.com", useTls: true },
      },
      targetPort: 3000,
      localPort: 0,
    });
    const client = new Socket();
    client.on("error", () => undefined);
    client.connect(info.localPort, info.localHost);
    await Promise.all([once(client, "connect"), connectStarted]);

    const [stream] = getActiveForward(manager).streams;
    if (!stream) throw new Error("missing accepted stream");
    const streamClosed = new Promise<void>((resolve) => stream.socket.once("close", resolve));
    expect(() => stream.socket.emit("error", new Error("client reset"))).not.toThrow();
    await streamClosed;

    const [sourceChannel] = createChannelPair();
    releaseRemote(sourceChannel);
    await new Promise<void>((resolve) => setImmediate(resolve));
    client.destroy();
    await manager.closeOwner("reset-session");
  });

  it("closes the forward when its listening server emits an error", async () => {
    const manager = new RemoteTcpForwardManager({
      connectRemote: async () => {
        throw new Error("not used");
      },
    });
    const info = await manager.open("listener-error-session", {
      target: {
        v: 2,
        serverId: "remote-daemon",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "https://relay.example.com", useTls: true },
      },
      targetPort: 3000,
      localPort: 0,
    });
    const active = getActiveForward(manager);
    const serverClosed = new Promise<void>((resolve) => active.server.once("close", resolve));

    expect(() => active.server.emit("error", new Error("listener failed"))).not.toThrow();
    await serverClosed;
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.once("error", reject);
        socket.connect(info.localPort, info.localHost, resolve);
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    await manager.closeOwner("listener-error-session");
  });

  it("cancels an in-flight listener when its owner disconnects", async () => {
    const manager = new RemoteTcpForwardManager({
      connectRemote: async () => {
        throw new Error("not used");
      },
    });
    const opening = manager.open("closing-session", {
      target: {
        v: 2,
        serverId: "remote-daemon",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "https://relay.example.com", useTls: true },
      },
      targetPort: 1,
      localPort: 0,
    });
    const rejected = expect(opening).rejects.toThrow(/owner closed/i);

    await manager.closeOwner("closing-session");
    await rejected;
  });

  it("counts concurrent listener opens against the owner limit", async () => {
    const manager = new RemoteTcpForwardManager({
      connectRemote: async () => {
        throw new Error("not used");
      },
    });
    const openings = Array.from({ length: 17 }, () =>
      manager.open("busy-session", {
        target: {
          v: 2,
          serverId: "remote-daemon",
          daemonPublicKeyB64: "public-key",
          relay: { endpoint: "https://relay.example.com", useTls: true },
        },
        targetPort: 1,
        localPort: 0,
      }),
    );

    const settled = await Promise.allSettled(openings);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(16);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      settled.find(
        (result) => result.status === "rejected" && /at most 16/.test(String(result.reason)),
      ),
    ).toBeDefined();
    await manager.closeOwner("busy-session");
  });
});
