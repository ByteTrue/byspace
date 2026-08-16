import { chmod, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectRemoteTunnelSupervisor,
  startRemoteTunnelSession,
} from "./remote-tunnel-supervisor-client.js";

const MAGIC = Buffer.from("BYSPTUN1", "ascii");
const fixtures = new Set<SupervisorFixture>();

interface Frame {
  opcode: number;
  payload: Buffer;
}

interface SupervisorFixture {
  socketPath: string;
  handled: Promise<void>;
  close(): Promise<void>;
}

function encodeFrame(opcode: number, payload = Buffer.alloc(0)): Buffer {
  const frame = Buffer.alloc(16 + payload.length);
  MAGIC.copy(frame, 0);
  frame[8] = 1;
  frame[9] = opcode;
  frame.writeUInt32BE(payload.length, 12);
  payload.copy(frame, 16);
  return frame;
}

async function* readFrames(socket: net.Socket): AsyncGenerator<Frame> {
  let buffered = Buffer.alloc(0);
  for await (const chunk of socket) {
    buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
    while (buffered.length >= 16) {
      const payloadLength = buffered.readUInt32BE(12);
      const frameLength = 16 + payloadLength;
      if (buffered.length < frameLength) break;
      yield {
        opcode: buffered[9],
        payload: Buffer.from(buffered.subarray(16, frameLength)),
      };
      buffered = buffered.subarray(frameLength);
    }
  }
}

async function nextFrame(frames: AsyncIterator<Frame>): Promise<Frame> {
  const result = await frames.next();
  if (result.done) throw new Error("client disconnected before request");
  return result.value;
}

async function createFixture(
  handler: (socket: net.Socket, frames: AsyncIterator<Frame>) => Promise<void>,
): Promise<SupervisorFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "byspace-tunnel-supervisor-"));
  const socketPath = path.join(directory, "supervisor.sock");
  const sockets = new Set<net.Socket>();
  let resolveHandled: () => void;
  let rejectHandled: (error: unknown) => void;
  const handled = new Promise<void>((resolve, reject) => {
    resolveHandled = resolve;
    rejectHandled = reject;
  });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    void handler(socket, readFrames(socket)[Symbol.asyncIterator]()).then(
      () => resolveHandled(),
      (error) => {
        socket.destroy();
        rejectHandled(error);
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);

  const fixture: SupervisorFixture = {
    socketPath,
    handled,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.add(fixture);
  return fixture;
}

function readyPayload(peer = Buffer.from([10, 253, 254, 2]), interfaceName = "utun9"): Buffer {
  const payload = Buffer.alloc(20);
  peer.copy(payload, 0);
  payload.write(interfaceName, 4, "utf8");
  return payload;
}

afterEach(async () => {
  await Promise.all([...fixtures].map((fixture) => fixture.close()));
  fixtures.clear();
});

describe("Remote Tunnel supervisor client", () => {
  it("checks socket ownership and permissions before connecting", async () => {
    const missingPath = path.join(tmpdir(), `missing-byspace-tunnel-${process.pid}.sock`);
    await expect(inspectRemoteTunnelSupervisor({ socketPath: missingPath })).resolves.toEqual({
      available: false,
      socketPath: missingPath,
      reason: "missing",
    });

    const fixture = await createFixture(async (socket) => {
      await new Promise<void>((resolve) => socket.once("close", resolve));
    });
    await chmod(fixture.socketPath, 0o666);
    await expect(
      inspectRemoteTunnelSupervisor({ socketPath: fixture.socketPath }),
    ).resolves.toEqual({
      available: false,
      socketPath: fixture.socketPath,
      reason: "insecure_permissions",
    });
  });

  it("runs START and idempotent STOP over fragmented supervisor responses", async () => {
    const fixture = await createFixture(async (socket, frames) => {
      const start = await nextFrame(frames);
      expect(start.opcode).toBe(0x01);
      expect([...start.payload]).toEqual([10, 253, 0, 1, 10, 253, 254, 2, 0x4a, 0x58, 0x21, 0x34]);

      const ready = encodeFrame(0x81, readyPayload());
      socket.write(ready.subarray(0, 11));
      socket.write(ready.subarray(11));

      const stop = await nextFrame(frames);
      expect(stop).toEqual({ opcode: 0x02, payload: Buffer.alloc(0) });
      socket.end(encodeFrame(0x82));
    });

    const session = await startRemoteTunnelSession({
      socketPath: fixture.socketPath,
      peerIpv4: "10.253.254.2",
      socksPort: 19_032,
      mtu: 8500,
    });
    expect(session.interfaceName).toBe("utun9");
    expect(session.peerIpv4).toBe("10.253.254.2");

    await Promise.all([session.stop(), session.stop()]);
    await expect(session.closed).resolves.toBeUndefined();
    await fixture.handled;
  });

  it("settles closed when the helper exits immediately after READY", async () => {
    const fixture = await createFixture(async (socket, frames) => {
      await nextFrame(frames);
      socket.end(encodeFrame(0x81, readyPayload()));
    });

    const session = await startRemoteTunnelSession({
      socketPath: fixture.socketPath,
      peerIpv4: "10.253.254.2",
      socksPort: 19_080,
    });
    await expect(session.closed).resolves.toBeUndefined();
    await expect(session.stop()).rejects.toThrow("disconnected before STOP");
    await fixture.handled;
  });

  it("surfaces helper errors and closes the control socket", async () => {
    const fixture = await createFixture(async (socket, frames) => {
      await nextFrame(frames);
      socket.end(encodeFrame(0xff, Buffer.from("route conflict")));
    });

    await expect(
      startRemoteTunnelSession({
        socketPath: fixture.socketPath,
        peerIpv4: "10.253.254.2",
        socksPort: 19_080,
      }),
    ).rejects.toThrow("route conflict");
    await fixture.handled;
  });

  it("rejects a READY response for another peer", async () => {
    const fixture = await createFixture(async (socket, frames) => {
      await nextFrame(frames);
      socket.end(encodeFrame(0x81, readyPayload(Buffer.from([10, 253, 254, 3]))));
    });

    await expect(
      startRemoteTunnelSession({
        socketPath: fixture.socketPath,
        peerIpv4: "10.253.254.2",
        socksPort: 19_080,
      }),
    ).rejects.toThrow("wrong peer address");
    await fixture.handled;
  });

  it("times out a silent helper and rejects public routes before connecting", async () => {
    const fixture = await createFixture(async (socket, frames) => {
      await nextFrame(frames);
      await new Promise<void>((resolve) => socket.once("close", resolve));
    });

    await expect(
      startRemoteTunnelSession({
        socketPath: fixture.socketPath,
        peerIpv4: "10.253.254.2",
        socksPort: 19_080,
        requestTimeoutMs: 20,
      }),
    ).rejects.toThrow("Timed out waiting for Remote Tunnel READY");
    await fixture.handled;

    await expect(
      startRemoteTunnelSession({
        socketPath: fixture.socketPath,
        peerIpv4: "192.168.1.2",
        socksPort: 19_080,
      }),
    ).rejects.toThrow("dedicated overlay range");
  });
});
