import { randomBytes, randomUUID } from "node:crypto";
import { Socket } from "node:net";
import type pino from "pino";
import { WebSocket } from "ws";
import { createClientChannel, type KeyPair } from "@bytetrue/byspace-relay/e2ee";
import { buildRelayWebSocketUrl } from "@bytetrue/byspace-protocol/daemon-endpoints";
import { createRelayTransportAdapter, type RelaySocketLike } from "../relay-transport.js";
import { RemoteByteStream } from "./remote-byte-stream.js";
import type { RemoteWebService } from "./remote-web-service-store.js";

const PROTOCOL_VERSION = 1;
const CONNECT_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const LOOPBACK_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TARGET_STREAMS = 256;
const MAX_PRE_HANDSHAKE_FRAMES = 64;
const MAX_PRE_HANDSHAKE_BYTES = 256 * 1024;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SERVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ChallengeMessage {
  type: "remote.web.challenge";
  version: typeof PROTOCOL_VERSION;
  targetNonce: string;
}

interface OpenMessage {
  type: "remote.web.open";
  version: typeof PROTOCOL_VERSION;
  serviceId: string;
  targetPort: number;
  sourceNonce: string;
  targetNonce: string;
}

interface ReadyMessage {
  type: "remote.web.ready";
  version: typeof PROTOCOL_VERSION;
  sourceNonce: string;
  targetNonce: string;
}

interface ErrorMessage {
  type: "remote.web.error";
  version: typeof PROTOCOL_VERSION;
  message: string;
}

type HandshakeMessage = ChallengeMessage | ReadyMessage | ErrorMessage;

export interface DataRelayClientConfig {
  endpoint: string;
  useTls: boolean;
  accessToken: string;
}

export interface RemoteWebServiceAuthorization {
  serviceId: string;
  sourceDaemonPublicKeyB64: string;
  targetPort: number;
}

export async function connectRemoteWebService(
  config: DataRelayClientConfig,
  service: RemoteWebService,
  sourceKeyPair: KeyPair,
  logger: pino.Logger,
): Promise<RemoteByteStream> {
  const target = service.target;
  const connectionId = `rws_${randomUUID()}`;
  const sourceNonce = createNonce();
  const url = buildRelayWebSocketUrl({
    endpoint: config.endpoint,
    useTls: config.useTls,
    serverId: target.serverId,
    role: "client",
    version: 2,
    connectionId,
  });
  const socket = new WebSocket(url, {
    handshakeTimeout: CONNECT_TIMEOUT_MS,
    perMessageDeflate: false,
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  await waitForWebSocketOpen(socket, CONNECT_TIMEOUT_MS);

  try {
    const transport = createRelayTransportAdapter(socket, logger.child({ connectionId }));
    let stream: RemoteByteStream | null = null;
    let channel: Awaited<ReturnType<typeof createClientChannel>> | null = null;
    let settleHandshake: ((message: HandshakeMessage) => void) | null = null;
    let rejectHandshake: ((error: Error) => void) | null = null;
    let handshakeFailure: Error | null = null;
    const pendingHandshakeMessages: Array<{ message: HandshakeMessage; bytes: number }> = [];
    const pendingFrames: Array<string | ArrayBuffer> = [];
    let pendingFrameBytes = 0;

    const failHandshake = (error: Error): void => {
      handshakeFailure = error;
      const reject = rejectHandshake;
      settleHandshake = null;
      rejectHandshake = null;
      reject?.(error);
    };
    const nextHandshakeMessage = (): Promise<HandshakeMessage> => {
      const pending = pendingHandshakeMessages.shift();
      if (pending) {
        pendingFrameBytes -= pending.bytes;
        return Promise.resolve(pending.message);
      }
      if (handshakeFailure) return Promise.reject(handshakeFailure);
      return new Promise<HandshakeMessage>((resolve, reject) => {
        settleHandshake = resolve;
        rejectHandshake = reject;
      });
    };

    channel = await createClientChannel(
      transport,
      target.daemonPublicKeyB64,
      {
        onmessage: (data) => {
          if (stream) {
            stream.receive(data);
            return;
          }
          if (typeof data === "string") {
            const message = parseHandshakeMessage(data);
            if (message) {
              const settle = settleHandshake;
              settleHandshake = null;
              rejectHandshake = null;
              if (settle) {
                settle(message);
              } else {
                const byteLength = Buffer.byteLength(data);
                if (
                  pendingFrames.length + pendingHandshakeMessages.length >=
                    MAX_PRE_HANDSHAKE_FRAMES ||
                  pendingFrameBytes + byteLength > MAX_PRE_HANDSHAKE_BYTES
                ) {
                  const error = new Error(
                    "Remote Web Service pre-handshake buffer exceeded its limit",
                  );
                  failHandshake(error);
                  channel?.close(1009, "Remote Web Service pre-handshake buffer overflow");
                  return;
                }
                pendingHandshakeMessages.push({ message, bytes: byteLength });
                pendingFrameBytes += byteLength;
              }
              return;
            }
          }
          const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
          if (
            pendingFrames.length + pendingHandshakeMessages.length >= MAX_PRE_HANDSHAKE_FRAMES ||
            pendingFrameBytes + byteLength > MAX_PRE_HANDSHAKE_BYTES
          ) {
            const error = new Error("Remote Web Service pre-handshake buffer exceeded its limit");
            failHandshake(error);
            channel?.close(1009, "Remote Web Service pre-handshake buffer overflow");
            return;
          }
          pendingFrames.push(data);
          pendingFrameBytes += byteLength;
        },
        onclose: (code, reason) => {
          if (stream) stream.receiveClose(code, reason);
          else failHandshake(new Error(reason || "Data Relay channel closed"));
        },
        onerror: (error) => {
          if (stream) stream.destroy(error);
          else failHandshake(error);
        },
      },
      sourceKeyPair,
    );

    await waitForChannelOpen(channel, HANDSHAKE_TIMEOUT_MS);
    const handshakeDeadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
    const waitForHandshakeMessage = () =>
      withTimeout(nextHandshakeMessage(), Math.max(1, handshakeDeadline - Date.now()), () =>
        channel?.close(1008, "Remote Web Service handshake timed out"),
      );
    const challenge = await waitForHandshakeMessage();
    if (challenge.type === "remote.web.error") {
      channel.close(1008, "Remote Web Service target rejected");
      throw new Error(challenge.message);
    }
    if (challenge.type !== "remote.web.challenge") {
      channel.close(1008, "Remote Web Service challenge missing");
      throw new Error("Remote Web Service target did not issue a fresh challenge");
    }

    await channel.send(
      JSON.stringify({
        type: "remote.web.open",
        version: PROTOCOL_VERSION,
        serviceId: service.id,
        targetPort: target.port,
        sourceNonce,
        targetNonce: challenge.targetNonce,
      } satisfies OpenMessage),
    );
    const response = await waitForHandshakeMessage();
    settleHandshake = null;
    rejectHandshake = null;
    if (response.type === "remote.web.error") {
      channel.close(1008, "Remote Web Service target rejected");
      throw new Error(response.message);
    }
    if (
      response.type !== "remote.web.ready" ||
      response.sourceNonce !== sourceNonce ||
      response.targetNonce !== challenge.targetNonce
    ) {
      channel.close(1008, "Remote Web Service handshake replay rejected");
      throw new Error("Remote Web Service handshake did not match this connection");
    }

    stream = new RemoteByteStream(
      {
        send: (data) => channel.send(data),
        close: (code, reason) => channel.close(code, reason),
      },
      { sessionId: `${sourceNonce}.${response.targetNonce}` },
    );
    for (const frame of pendingFrames) stream.receive(frame);
    pendingFrames.length = 0;
    pendingFrameBytes = 0;
    return stream;
  } catch (error) {
    socket.terminate();
    throw error;
  }
}

export class RemoteWebServiceTargetAcceptor {
  private activeStreams = 0;

  constructor(
    private readonly logger: pino.Logger,
    private readonly authorize: (input: RemoteWebServiceAuthorization) => Promise<boolean>,
    private readonly maxTargetStreams = DEFAULT_MAX_TARGET_STREAMS,
  ) {}

  attachSocket(socket: RelaySocketLike): void {
    if (this.activeStreams >= this.maxTargetStreams) {
      socket.close(1013, "Remote Web Service target is at capacity");
      return;
    }
    this.activeStreams += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeStreams -= 1;
    };
    socket.once("close", release);
    void this.accept(socket).catch((error: unknown) => {
      this.logger.warn({ err: error }, "Remote Web Service target connection failed");
      void Promise.resolve()
        .then(() =>
          socket.send(
            JSON.stringify({
              type: "remote.web.error",
              version: PROTOCOL_VERSION,
              message: "Remote Web Service target rejected",
            } satisfies ErrorMessage),
          ),
        )
        .catch(() => undefined)
        .finally(() => socket.close(1008, "Remote Web Service target rejected"));
    });
  }

  private async accept(socket: RelaySocketLike): Promise<void> {
    const targetNonce = createNonce();
    const messagePromise = waitForFirstMessage(socket, HANDSHAKE_TIMEOUT_MS);
    await Promise.resolve(
      socket.send(
        JSON.stringify({
          type: "remote.web.challenge",
          version: PROTOCOL_VERSION,
          targetNonce,
        } satisfies ChallengeMessage),
      ),
    );
    const message = await messagePromise;
    const open = parseOpenMessage(message);
    if (!open || open.targetNonce !== targetNonce) {
      throw new Error("Invalid or replayed Remote Web Service open message");
    }
    const sourceDaemonPublicKeyB64 = socket.peerPublicKeyB64?.trim();
    if (!sourceDaemonPublicKeyB64) throw new Error("Remote Web Service source identity is missing");
    const authorization = {
      serviceId: open.serviceId,
      sourceDaemonPublicKeyB64,
      targetPort: open.targetPort,
    };
    if (!(await this.authorize(authorization))) {
      throw new Error("Remote Web Service source is not authorized");
    }

    const loopback = await connectLoopback(open.targetPort);
    const stream = new RemoteByteStream(
      {
        send: (data) => Promise.resolve(socket.send(data)).then(() => undefined),
        close: (code, reason) => socket.close(code, reason),
      },
      { sessionId: `${open.sourceNonce}.${targetNonce}` },
    );
    socket.on("message", (data) => {
      const normalized = normalizeSocketMessage(data);
      if (normalized !== null) stream.receive(normalized);
    });
    socket.on("close", (code, reason) => {
      stream.receiveClose(
        typeof code === "number" ? code : 1006,
        typeof reason === "string" ? reason : "Data Relay channel closed",
      );
    });
    socket.on("error", (error) => {
      stream.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    loopback.on("error", (error) => stream.destroy(error));
    stream.on("error", () => loopback.destroy());
    stream.on("close", () => loopback.destroy());

    try {
      await Promise.resolve(
        socket.send(
          JSON.stringify({
            type: "remote.web.ready",
            version: PROTOCOL_VERSION,
            sourceNonce: open.sourceNonce,
            targetNonce,
          } satisfies ReadyMessage),
        ),
      );
      stream.pipe(loopback);
      loopback.pipe(stream);
    } catch (error) {
      stream.destroy(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

function parseOpenMessage(data: unknown): OpenMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (
      parsed.type !== "remote.web.open" ||
      parsed.version !== PROTOCOL_VERSION ||
      typeof parsed.serviceId !== "string" ||
      !SERVICE_ID_PATTERN.test(parsed.serviceId) ||
      typeof parsed.sourceNonce !== "string" ||
      !NONCE_PATTERN.test(parsed.sourceNonce) ||
      typeof parsed.targetNonce !== "string" ||
      !NONCE_PATTERN.test(parsed.targetNonce) ||
      !Number.isInteger(parsed.targetPort) ||
      (parsed.targetPort as number) < 1 ||
      (parsed.targetPort as number) > 65_535
    ) {
      return null;
    }
    return parsed as unknown as OpenMessage;
  } catch {
    return null;
  }
}

function parseHandshakeMessage(data: string): HandshakeMessage | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.version !== PROTOCOL_VERSION) return null;
    if (
      parsed.type === "remote.web.challenge" &&
      typeof parsed.targetNonce === "string" &&
      NONCE_PATTERN.test(parsed.targetNonce)
    ) {
      return {
        type: "remote.web.challenge",
        version: PROTOCOL_VERSION,
        targetNonce: parsed.targetNonce,
      };
    }
    if (
      parsed.type === "remote.web.ready" &&
      typeof parsed.sourceNonce === "string" &&
      NONCE_PATTERN.test(parsed.sourceNonce) &&
      typeof parsed.targetNonce === "string" &&
      NONCE_PATTERN.test(parsed.targetNonce)
    ) {
      return {
        type: "remote.web.ready",
        version: PROTOCOL_VERSION,
        sourceNonce: parsed.sourceNonce,
        targetNonce: parsed.targetNonce,
      };
    }
    if (parsed.type === "remote.web.error" && typeof parsed.message === "string") {
      return {
        type: "remote.web.error",
        version: PROTOCOL_VERSION,
        message: parsed.message,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function createNonce(): string {
  return randomBytes(16).toString("base64url");
}

function waitForWebSocketOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Data Relay connection timed out"));
    }, timeoutMs);
    timeout.unref?.();
    const cleanup = () => clearTimeout(timeout);
    socket.once("open", () => {
      cleanup();
      resolve();
    });
    socket.once("error", (error) => {
      cleanup();
      reject(error);
    });
    socket.once("close", () => {
      cleanup();
      reject(new Error("Data Relay connection closed before opening"));
    });
  });
}

function waitForChannelOpen(
  channel: Awaited<ReturnType<typeof createClientChannel>>,
  timeoutMs: number,
): Promise<void> {
  if (channel.isOpen()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      channel.close(1008, "E2EE handshake timed out");
      reject(new Error("Data Relay E2EE handshake timed out"));
    }, timeoutMs);
    timeout.unref?.();
    channel.onTransitionToOpen(() => {
      clearTimeout(timeout);
      resolve();
    });
    channel.onClose(() => {
      clearTimeout(timeout);
      reject(new Error("Data Relay E2EE channel closed before opening"));
    });
  });
}

function waitForFirstMessage(socket: RelaySocketLike, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error("Remote Web Service handshake timed out"))),
      timeoutMs,
    );
    timeout.unref?.();
    socket.on("message", (data) => finish(() => resolve(data)));
    socket.once("close", () =>
      finish(() => reject(new Error("Remote Web Service channel closed during handshake"))),
    );
    socket.once("error", (error) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}

async function connectLoopback(targetPort: number): Promise<Socket> {
  let firstError: Error | null = null;
  for (const host of ["127.0.0.1", "::1"]) {
    try {
      return await connectHost(host, targetPort);
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`Remote loopback port ${targetPort} is unavailable`, { cause: firstError });
}

function connectHost(host: string, targetPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket({ allowHalfOpen: true });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Loopback connection to ${host}:${targetPort} timed out`));
    }, LOOPBACK_CONNECT_TIMEOUT_MS);
    timeout.unref?.();
    const fail = (error: Error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.connect(targetPort, host, () => {
      clearTimeout(timeout);
      socket.off("error", fail);
      socket.setNoDelay(true);
      resolve(socket);
    });
  });
}

function normalizeSocketMessage(data: unknown): string | ArrayBuffer | null {
  if (typeof data === "string" || data instanceof ArrayBuffer) return data;
  if (Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
    const view = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new Error("Remote Web Service handshake timed out"));
    }, timeoutMs);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        return resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        return reject(error);
      },
    );
  });
}
