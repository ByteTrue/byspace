import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { ConnectionOfferV2 } from "@bytetrue/byspace-protocol/connection-offer";
import {
  bridgeRemoteTcpForwardSocket,
  type RemoteTcpForwardBridge,
  type RemoteTcpForwardChannel,
} from "./remote-tcp-forward-bridge.js";
import { openRemoteTcpForwardChannel } from "./remote-tcp-forward-session.js";

const MAX_FORWARDS_PER_OWNER = 16;
const MAX_STREAMS_PER_FORWARD = 64;

interface RemoteTcpForwardLogger {
  warn(fields: object, message: string): void;
}

export interface RemoteTcpForwardOpenOptions {
  target: ConnectionOfferV2;
  targetPort: number;
  localPort?: number;
}

export interface RemoteTcpForwardInfo {
  forwardId: string;
  localHost: "127.0.0.1";
  localPort: number;
  targetServerId: string;
  targetPort: number;
}

interface ActiveStream {
  socket: Socket;
  channel: RemoteTcpForwardChannel | null;
  bridge: RemoteTcpForwardBridge | null;
}

interface PendingForward {
  ownerId: string;
  cancelled: boolean;
  done: Promise<void>;
  finish(): void;
}

interface ActiveForward {
  ownerId: string;
  info: RemoteTcpForwardInfo;
  server: Server;
  streams: Set<ActiveStream>;
  closing: boolean;
}

export class RemoteTcpForwardManager {
  private readonly forwards = new Map<string, ActiveForward>();
  private readonly pendingForwards = new Map<string, PendingForward>();
  private readonly connectRemote: (target: ConnectionOfferV2) => Promise<RemoteTcpForwardChannel>;
  private readonly logger: RemoteTcpForwardLogger | null;

  constructor(options: {
    connectRemote: (target: ConnectionOfferV2) => Promise<RemoteTcpForwardChannel>;
    logger?: RemoteTcpForwardLogger;
  }) {
    this.connectRemote = options.connectRemote;
    this.logger = options.logger ?? null;
  }

  async open(ownerId: string, options: RemoteTcpForwardOpenOptions): Promise<RemoteTcpForwardInfo> {
    const ownerForwardCount =
      [...this.forwards.values()].filter((forward) => forward.ownerId === ownerId).length +
      [...this.pendingForwards.values()].filter((forward) => forward.ownerId === ownerId).length;
    if (ownerForwardCount >= MAX_FORWARDS_PER_OWNER) {
      throw new Error(`A session may own at most ${MAX_FORWARDS_PER_OWNER} remote TCP forwards`);
    }

    const forwardId = randomUUID();
    const pending = createPendingForward(ownerId);
    this.pendingForwards.set(forwardId, pending);
    const active: ActiveForward = {
      ownerId,
      info: {
        forwardId,
        localHost: "127.0.0.1",
        localPort: 0,
        targetServerId: options.target.serverId,
        targetPort: options.targetPort,
      },
      server: createServer({ allowHalfOpen: true }),
      streams: new Set(),
      closing: false,
    };
    const bindConnections = () => {
      active.server.on("connection", (socket) => {
        this.acceptLocalSocket(active, socket, options.target);
      });
    };
    const listen = (port: number) =>
      listenLoopback(active.server, port, (error) => this.handleListenerError(active, error));
    bindConnections();

    try {
      const preferredPort = options.localPort ?? options.targetPort;
      try {
        active.info.localPort = await listen(preferredPort);
      } catch (error) {
        if (options.localPort !== undefined || !shouldFallBackToEphemeralPort(error)) {
          active.server.close();
          throw error;
        }
        active.server.close();
        if (pending.cancelled) {
          throw new Error("Remote TCP forward owner closed while the listener was opening", {
            cause: error,
          });
        }
        active.server = createServer({ allowHalfOpen: true });
        bindConnections();
        active.info.localPort = await listen(0);
      }

      if (pending.cancelled || active.closing) {
        await this.closeForward(active);
        throw new Error("Remote TCP forward owner closed or listener failed while opening");
      }
      this.forwards.set(forwardId, active);
      return active.info;
    } finally {
      this.pendingForwards.delete(forwardId);
      pending.finish();
    }
  }

  async close(ownerId: string, forwardId: string): Promise<void> {
    const active = this.forwards.get(forwardId);
    if (!active || active.ownerId !== ownerId) {
      throw new Error("Remote TCP forward not found");
    }
    await this.closeForward(active);
  }

  async closeOwner(ownerId: string): Promise<void> {
    const owned = [...this.forwards.values()].filter((forward) => forward.ownerId === ownerId);
    const pending = [...this.pendingForwards.values()].filter(
      (forward) => forward.ownerId === ownerId,
    );
    for (const forward of pending) forward.cancelled = true;
    await Promise.all([
      ...owned.map((forward) => this.closeForward(forward)),
      ...pending.map((forward) => forward.done),
    ]);
  }

  async stop(): Promise<void> {
    const pending = [...this.pendingForwards.values()];
    for (const forward of pending) forward.cancelled = true;
    await Promise.all([
      ...[...this.forwards.values()].map((forward) => this.closeForward(forward)),
      ...pending.map((forward) => forward.done),
    ]);
  }

  private acceptLocalSocket(
    active: ActiveForward,
    socket: Socket,
    target: ConnectionOfferV2,
  ): void {
    if (active.closing || active.streams.size >= MAX_STREAMS_PER_FORWARD) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    socket.pause();
    const onPreBridgeError = () => socket.destroy();
    socket.on("error", onPreBridgeError);
    const stream: ActiveStream = { socket, channel: null, bridge: null };
    active.streams.add(stream);
    socket.once("close", () => {
      socket.off("error", onPreBridgeError);
      active.streams.delete(stream);
    });

    void (async () => {
      try {
        const channel = await this.connectRemote(target);
        stream.channel = channel;
        if (active.closing || socket.destroyed) {
          channel.close(1000, "Remote TCP forward closed before stream start");
          return;
        }
        await openRemoteTcpForwardChannel(channel, active.info.targetPort);
        if (active.closing || socket.destroyed) {
          channel.close(1000, "Remote TCP forward closed before stream start");
          return;
        }
        stream.bridge = bridgeRemoteTcpForwardSocket(socket, channel);
        socket.off("error", onPreBridgeError);
        socket.resume();
      } catch (error) {
        this.logger?.warn(
          {
            err: error,
            forwardId: active.info.forwardId,
            targetServerId: active.info.targetServerId,
            targetPort: active.info.targetPort,
          },
          "remote_tcp_forward_stream_failed",
        );
        stream.channel?.close(1011, "Remote TCP stream failed");
        socket.destroy();
      }
    })();
  }

  private handleListenerError(active: ActiveForward, error: Error): void {
    this.logger?.warn(
      { err: error, forwardId: active.info.forwardId, localPort: active.info.localPort },
      "remote_tcp_forward_listener_failed",
    );
    void this.closeForward(active).catch((closeError) => {
      this.logger?.warn(
        { err: closeError, forwardId: active.info.forwardId },
        "remote_tcp_forward_listener_cleanup_failed",
      );
    });
  }

  private async closeForward(active: ActiveForward): Promise<void> {
    if (active.closing) return;
    active.closing = true;
    this.forwards.delete(active.info.forwardId);

    const closed = new Promise<void>((resolve) => {
      active.server.close(() => resolve());
    });
    for (const stream of active.streams) {
      stream.bridge?.close();
      stream.channel?.close(1000, "Remote TCP forward closed");
      stream.socket.destroy();
    }
    await closed;
  }
}

function createPendingForward(ownerId: string): PendingForward {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { ownerId, cancelled: false, done, finish };
}

function listenLoopback(
  server: Server,
  port: number,
  onRuntimeError: (error: Error) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let listening = false;
    const onError = (error: Error) => {
      if (listening) {
        onRuntimeError(error);
        return;
      }
      server.off("listening", onListening);
      server.off("error", onError);
      reject(error);
    };
    const onListening = () => {
      listening = true;
      const address = server.address();
      if (!address || typeof address === "string") {
        server.off("error", onError);
        reject(new Error("Remote TCP forward listener has no TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.on("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function shouldFallBackToEphemeralPort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "EADDRINUSE" || code === "EACCES" || code === "EPERM";
}
