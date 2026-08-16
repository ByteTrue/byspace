import { lstat } from "node:fs/promises";
import net from "node:net";

const FRAME_MAGIC = Buffer.from("BYSPTUN1", "ascii");
const FRAME_HEADER_SIZE = 16;
const MAX_PAYLOAD_SIZE = 256;
const READY_PAYLOAD_SIZE = 20;
const LOCAL_OVERLAY_IPV4 = Buffer.from([10, 253, 0, 1]);
const DEFAULT_MTU = 8500;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const OPCODE_START = 0x01;
const OPCODE_STOP = 0x02;
const OPCODE_READY = 0x81;
const OPCODE_STOPPED = 0x82;
const OPCODE_ERROR = 0xff;

interface TunnelFrame {
  opcode: number;
  payload: Buffer;
}

export type RemoteTunnelSupervisorStatus =
  | { available: true; socketPath: string }
  | {
      available: false;
      socketPath: string | null;
      reason:
        | "unsupported_platform"
        | "daemon_is_root"
        | "missing"
        | "invalid_socket"
        | "invalid_owner"
        | "insecure_permissions";
    };

export interface RemoteTunnelSession {
  readonly peerIpv4: string;
  readonly interfaceName: string;
  readonly closed: Promise<void>;
  stop(): Promise<void>;
  abort(): void;
}

export interface StartRemoteTunnelSessionOptions {
  peerIpv4: string;
  socksPort: number;
  mtu?: number;
  socketPath?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

export function remoteTunnelSupervisorSocketPath(uid: number): string {
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("Remote Tunnel supervisor requires a non-root daemon UID");
  }
  return `/var/run/byspace-tunnel-${uid}.sock`;
}

export async function inspectRemoteTunnelSupervisor(options?: {
  socketPath?: string;
}): Promise<RemoteTunnelSupervisorStatus> {
  const uid = currentUid();
  if (uid === 0) {
    return { available: false, socketPath: options?.socketPath ?? null, reason: "daemon_is_root" };
  }
  if (uid === null || (process.platform !== "darwin" && !options?.socketPath)) {
    return {
      available: false,
      socketPath: options?.socketPath ?? null,
      reason: "unsupported_platform",
    };
  }

  const socketPath = options?.socketPath ?? remoteTunnelSupervisorSocketPath(uid);
  let stats;
  try {
    stats = await lstat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { available: false, socketPath, reason: "missing" };
    }
    throw error;
  }

  if (!stats.isSocket()) {
    return { available: false, socketPath, reason: "invalid_socket" };
  }
  if (stats.uid !== uid) {
    return { available: false, socketPath, reason: "invalid_owner" };
  }
  if ((stats.mode & 0o077) !== 0) {
    return { available: false, socketPath, reason: "insecure_permissions" };
  }
  return { available: true, socketPath };
}

function parseIpv4(value: string): Buffer {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error(`Invalid Remote Tunnel peer IPv4 address: ${value}`);
  }
  return Buffer.from(parts.map(Number));
}

function encodeStartPayload(peerIpv4: string, socksPort: number, mtu: number): Buffer {
  const peer = parseIpv4(peerIpv4);
  const peerValue = peer.readUInt32BE(0);
  if (peerValue < 0x0afd0002 || peerValue > 0x0afdfffe) {
    throw new Error("Remote Tunnel peer must be inside the dedicated overlay range");
  }
  if (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65_535) {
    throw new Error("Remote Tunnel SOCKS port must be between 1 and 65535");
  }
  if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 9000) {
    throw new Error("Remote Tunnel MTU must be between 1280 and 9000");
  }

  const payload = Buffer.alloc(12);
  LOCAL_OVERLAY_IPV4.copy(payload, 0);
  peer.copy(payload, 4);
  payload.writeUInt16BE(socksPort, 8);
  payload.writeUInt16BE(mtu, 10);
  return payload;
}

function encodeFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const frame = Buffer.alloc(FRAME_HEADER_SIZE + payload.length);
  FRAME_MAGIC.copy(frame, 0);
  frame[8] = 1;
  frame[9] = opcode;
  frame.writeUInt32BE(payload.length, 12);
  payload.copy(frame, FRAME_HEADER_SIZE);
  return frame;
}

async function* readFrames(socket: net.Socket): AsyncGenerator<TunnelFrame> {
  let buffered = Buffer.alloc(0);
  for await (const chunk of socket) {
    buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
    while (buffered.length >= FRAME_HEADER_SIZE) {
      if (!buffered.subarray(0, FRAME_MAGIC.length).equals(FRAME_MAGIC)) {
        throw new Error("Remote Tunnel supervisor sent invalid frame magic");
      }
      if (buffered[8] !== 1 || buffered[10] !== 0 || buffered[11] !== 0) {
        throw new Error("Remote Tunnel supervisor sent an unsupported frame header");
      }
      const payloadLength = buffered.readUInt32BE(12);
      if (payloadLength > MAX_PAYLOAD_SIZE) {
        throw new Error("Remote Tunnel supervisor sent an oversized frame");
      }
      const frameLength = FRAME_HEADER_SIZE + payloadLength;
      if (buffered.length < frameLength) break;
      yield {
        opcode: buffered[9],
        payload: Buffer.from(buffered.subarray(FRAME_HEADER_SIZE, frameLength)),
      };
      buffered = buffered.subarray(frameLength);
    }
  }
  if (buffered.length > 0) {
    throw new Error("Remote Tunnel supervisor closed with a partial frame");
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  socket: net.Socket,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function connect(socketPath: string, timeoutMs: number): Promise<net.Socket> {
  const socket = net.createConnection({ path: socketPath });
  const connected = new Promise<net.Socket>((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
  return withTimeout(
    connected,
    timeoutMs,
    `Timed out connecting to Remote Tunnel supervisor at ${socketPath}`,
    socket,
  );
}

async function nextFrame(
  frames: AsyncIterator<TunnelFrame>,
  socket: net.Socket,
  timeoutMs: number,
  operation: string,
): Promise<TunnelFrame> {
  const result = await withTimeout(
    frames.next(),
    timeoutMs,
    `Timed out waiting for Remote Tunnel ${operation}`,
    socket,
  );
  if (result.done) {
    throw new Error(`Remote Tunnel supervisor disconnected before ${operation}`);
  }
  if (result.value.opcode === OPCODE_ERROR) {
    throw new Error(
      `Remote Tunnel helper rejected the request: ${result.value.payload.toString()}`,
    );
  }
  return result.value;
}

function writeFrame(socket: net.Socket, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(frame, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

class ActiveRemoteTunnelSession implements RemoteTunnelSession {
  readonly closed: Promise<void>;
  private stopPromise: Promise<void> | null = null;
  private isClosed = false;

  constructor(
    readonly peerIpv4: string,
    readonly interfaceName: string,
    private readonly socket: net.Socket,
    private readonly frames: AsyncIterator<TunnelFrame>,
    private readonly requestTimeoutMs: number,
  ) {
    if (socket.destroyed) {
      this.isClosed = true;
      this.closed = Promise.resolve();
    } else {
      this.closed = new Promise((resolve) => {
        socket.once("close", () => {
          this.isClosed = true;
          resolve();
        });
      });
    }
  }

  stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopOnce();
    return this.stopPromise;
  }

  abort(): void {
    this.socket.destroy();
  }

  private async stopOnce(): Promise<void> {
    if (this.isClosed || this.socket.destroyed) {
      throw new Error("Remote Tunnel supervisor disconnected before STOP");
    }
    try {
      await writeFrame(this.socket, encodeFrame(OPCODE_STOP));
      const response = await nextFrame(this.frames, this.socket, this.requestTimeoutMs, "STOPPED");
      if (response.opcode !== OPCODE_STOPPED || response.payload.length !== 0) {
        throw new Error("Remote Tunnel supervisor sent an invalid STOPPED response");
      }
      this.socket.destroy();
      await this.closed;
    } catch (error) {
      this.socket.destroy();
      throw error;
    }
  }
}

export async function startRemoteTunnelSession(
  options: StartRemoteTunnelSessionOptions,
): Promise<RemoteTunnelSession> {
  const startPayload = encodeStartPayload(
    options.peerIpv4,
    options.socksPort,
    options.mtu ?? DEFAULT_MTU,
  );
  const peerValue = startPayload.readUInt32BE(4);
  const status = await inspectRemoteTunnelSupervisor({ socketPath: options.socketPath });
  if (!status.available) {
    throw new Error(`Remote Tunnel supervisor is unavailable: ${status.reason}`);
  }

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const socket = await connect(
    status.socketPath,
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  );
  const frames = readFrames(socket)[Symbol.asyncIterator]();
  try {
    await writeFrame(socket, encodeFrame(OPCODE_START, startPayload));
    const response = await nextFrame(frames, socket, requestTimeoutMs, "READY");
    if (response.opcode !== OPCODE_READY || response.payload.length !== READY_PAYLOAD_SIZE) {
      throw new Error("Remote Tunnel supervisor sent an invalid READY response");
    }
    if (response.payload.readUInt32BE(0) !== peerValue) {
      throw new Error("Remote Tunnel READY response contains the wrong peer address");
    }
    const interfaceField = response.payload.subarray(4);
    const interfaceEnd = interfaceField.indexOf(0);
    if (interfaceEnd < 1 || interfaceField.subarray(interfaceEnd).some((value) => value !== 0)) {
      throw new Error("Remote Tunnel READY response contains invalid interface padding");
    }
    const interfaceName = interfaceField.subarray(0, interfaceEnd).toString("ascii");
    if (!/^utun\d+$/.test(interfaceName)) {
      throw new Error("Remote Tunnel READY response contains an invalid interface name");
    }
    return new ActiveRemoteTunnelSession(
      options.peerIpv4,
      interfaceName,
      socket,
      frames,
      requestTimeoutMs,
    );
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
