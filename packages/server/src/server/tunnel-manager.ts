import net from "node:net";

import type pino from "pino";

import { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { TunnelFrameOpcode, type TunnelFrame } from "@bytetrue/protocol/binary-frames/index";
import type { TunnelOpenResponse } from "@bytetrue/protocol/messages";

/**
 * Initiator-side (D1) tunnel manager. Owns one embedded DaemonClient per
 * configured peer daemon and one local TCP listener per forwarded port. The
 * daemon connects to the peer exactly like any other paired client (direct
 * ws:// or relay wss:// with E2EE + password), so the peer needs no
 * daemon-to-daemon awareness.
 *
 * One forwarded port accepts many local TCP streams; each accepted socket
 * performs its own tunnel.open request and gets its own tunnelId and paired
 * target socket on the peer.
 *
 * Lifecycle: runs at daemon level whether or not any app client is connected.
 * The peer connection rides DaemonClient's built-in reconnect; once the peer
 * has connected at least once, new local sockets arriving during a brief
 * reconnect wait up to connectWaitTimeoutMs for recovery, while already-open
 * streams pause and buffer across brief reconnects within the disconnect grace
 * window.
 */

const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 2_000;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_CONNECT_WAIT_TIMEOUT_MS = 30_000;
const MAX_PENDING_UPSTREAM_BYTES_PER_STREAM = 16 * 1024 * 1024;
const CLOSE_DRAIN_TIMEOUT_MS = 5_000;

function gracefulCloseSocket(socket: net.Socket): void {
  if (socket.destroyed) return;
  const timer = setTimeout(() => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }, CLOSE_DRAIN_TIMEOUT_MS);
  timer.unref?.();
  socket.once("close", () => clearTimeout(timer));
  socket.end();
}

export interface PeerTunnelConfig {
  /** Peer daemon id (serverId) for logging and identity. */
  peerId: string;
  /** ws:// or wss:// client URL for the peer daemon (relay or direct). */
  url: string;
  /** Peer daemon password (bearer). */
  password: string;
  /** E2EE daemon public key (base64) when the URL is a relay client URL. */
  daemonPublicKeyB64?: string;
  /** Remote ports to forward and their labels. */
  forwards: Array<{ remotePort: number; label?: string }>;
}

export interface TunnelManagerOptions {
  config: PeerTunnelConfig;
  logger: pino.Logger;
  /** Local listen host for forwarded ports. Default 127.0.0.1. */
  localHost?: string;
  /** Reconnect base backoff in ms. Default 250. */
  reconnectBaseDelayMs?: number;
  /** Reconnect max backoff in ms. Default 2000. */
  reconnectMaxDelayMs?: number;
  /** How long in-flight streams survive a peer disconnect before teardown. Default 30000. */
  disconnectGraceMs?: number;
  /** How long new local sockets wait for an in-progress reconnect before failing. Default 30000. */
  connectWaitTimeoutMs?: number;
}

interface ActiveStream {
  tunnelId: string;
  pendingUpstream: Buffer[];
  pendingUpstreamBytes: number;
}

interface ForwardState {
  remotePort: number;
  label: string;
  localPort: number | null;
  listener: net.Server | null;
  /** One ActiveStream per accepted local socket. */
  streams: Map<net.Socket, ActiveStream>;
  state: "connecting" | "connected" | "disconnected" | "error";
  lastError: string | null;
}

export class TunnelManager {
  readonly peerId: string;
  private readonly options: TunnelManagerOptions;
  private readonly logger: pino.Logger;
  private readonly forwards = new Map<number, ForwardState>();
  private readonly pendingUpstreamCloses = new Set<string>();
  private readonly connectWaiters = new Set<(connected: boolean) => void>();
  private client: DaemonClient | null = null;
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedOnce = false;
  private reconcileGeneration = 0;
  private disposed = false;

  constructor(options: TunnelManagerOptions) {
    this.peerId = options.config.peerId;
    this.options = options;
    this.logger = options.logger.child({ module: "tunnel-manager", peer: options.config.peerId });
    for (const forward of options.config.forwards) {
      this.forwards.set(forward.remotePort, {
        remotePort: forward.remotePort,
        label: forward.label ?? `port-${forward.remotePort}`,
        localPort: null,
        listener: null,
        streams: new Map(),
        state: "connecting",
        lastError: null,
      });
    }
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error("TunnelManager is disposed");
    this.connectClient();
    await Promise.all([...this.forwards.values()].map((f) => this.startListener(f)));
  }

  async stop(): Promise<void> {
    this.disposed = true;
    this.clearDisconnectGraceTimer();
    this.flushConnectWaiters(false);
    this.pendingUpstreamCloses.clear();
    for (const forward of this.forwards.values()) {
      forward.listener?.close();
      forward.listener = null;
      forward.state = "disconnected";
      for (const [socket] of forward.streams) {
        socket.destroy();
      }
      forward.streams.clear();
    }
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }

  getStatus(): Array<{
    remotePort: number;
    label: string;
    localPort: number | null;
    state: ForwardState["state"];
    lastError: string | null;
  }> {
    return [...this.forwards.values()].map((f) => ({
      remotePort: f.remotePort,
      label: f.label,
      localPort: f.localPort,
      state: f.state,
      lastError: f.lastError,
    }));
  }

  private connectClient(): void {
    const { url, password, daemonPublicKeyB64, peerId } = this.options.config;
    const isRelay = url.includes("serverId=");
    const client = new DaemonClient({
      url,
      password,
      clientId: `byspace-tunnel-${peerId}`,
      clientType: "cli",
      reconnect: {
        enabled: true,
        baseDelayMs: this.options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
        maxDelayMs: this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
      },
      logger: this.logger,
      ...(isRelay && daemonPublicKeyB64 ? { e2ee: { enabled: true, daemonPublicKeyB64 } } : {}),
    });
    this.client = client;

    client.onTunnelFrame((frame) => this.handleTunnelFrame(frame));
    client.subscribeConnectionStatus((status) => {
      const connected = status.status === "connected";
      for (const forward of this.forwards.values()) {
        if (forward.state !== "error") {
          forward.state = connected ? "connected" : "connecting";
        }
      }
      this.logger.info({ status: status.status }, "Tunnel peer connection state changed");
      if (connected) {
        this.handlePeerReconnected();
      } else {
        this.handlePeerDisconnected();
      }
    });

    void client.connect().catch((error: unknown) => {
      // connect() rejects only on terminal failure; the built-in reconnect
      // loop keeps retrying in the background. Log and let it run.
      this.logger.warn({ err: error }, "Tunnel peer connect failed; reconnecting");
    });
  }

  private handlePeerDisconnected(): void {
    let activeStreamCount = 0;
    for (const forward of this.forwards.values()) {
      for (const [socket] of forward.streams) {
        activeStreamCount += 1;
        socket.pause();
      }
    }
    if (activeStreamCount > 0 && !this.disconnectGraceTimer && !this.disposed) {
      const graceMs = this.options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
      this.disconnectGraceTimer = setTimeout(() => {
        this.disconnectGraceTimer = null;
        this.destroyAllStreams("peer reconnect grace period expired");
      }, graceMs);
      this.disconnectGraceTimer.unref?.();
    }
  }

  private handlePeerReconnected(): void {
    this.hasConnectedOnce = true;
    this.clearDisconnectGraceTimer();
    this.flushConnectWaiters(true);
    const client = this.client;
    if (!client || !client.isConnected || this.disposed) {
      return;
    }

    if (this.pendingUpstreamCloses.size > 0) {
      for (const tunnelId of this.pendingUpstreamCloses) {
        try {
          client.sendTunnelFrame(TunnelFrameOpcode.Close, tunnelId);
          this.pendingUpstreamCloses.delete(tunnelId);
        } catch {
          break;
        }
      }
    }

    const preReconnectTunnelIds = new Set<string>();
    for (const forward of this.forwards.values()) {
      for (const [socket, stream] of forward.streams) {
        if (socket.destroyed) {
          forward.streams.delete(socket);
          continue;
        }
        preReconnectTunnelIds.add(stream.tunnelId);
        if (!this.flushStreamUpstream(client, forward, socket, stream)) {
          continue;
        }
        socket.resume();
      }
    }

    if (preReconnectTunnelIds.size > 0) {
      void this.reconcileRemoteStreams(client, preReconnectTunnelIds);
    }
  }

  private flushStreamUpstream(
    client: DaemonClient,
    forward: ForwardState,
    socket: net.Socket,
    stream: ActiveStream,
  ): boolean {
    while (stream.pendingUpstream.length > 0) {
      const chunk = stream.pendingUpstream[0];
      if (!chunk) break;
      try {
        client.sendTunnelFrame(TunnelFrameOpcode.DataUpstream, stream.tunnelId, chunk);
        stream.pendingUpstream.shift();
        stream.pendingUpstreamBytes -= chunk.byteLength;
      } catch {
        socket.pause();
        return false;
      }
    }
    void forward;
    return true;
  }

  private async reconcileRemoteStreams(
    client: DaemonClient,
    preReconnectTunnelIds: Set<string>,
  ): Promise<void> {
    const generation = ++this.reconcileGeneration;
    try {
      const list = await client.listTunnels();
      if (
        this.disposed ||
        this.client !== client ||
        !client.isConnected ||
        this.reconcileGeneration !== generation
      ) {
        return;
      }
      const activeRemoteTunnelIds = new Set(
        list.entries
          .filter((entry) => entry.direction === "inbound" && entry.state === "connected")
          .map((entry) => entry.tunnelId),
      );
      for (const forward of this.forwards.values()) {
        for (const [socket, stream] of forward.streams) {
          if (
            preReconnectTunnelIds.has(stream.tunnelId) &&
            !activeRemoteTunnelIds.has(stream.tunnelId)
          ) {
            this.logger.info(
              { tunnelId: stream.tunnelId, remotePort: forward.remotePort },
              "Closing local tunnel stream missing on peer after reconnect",
            );
            forward.streams.delete(socket);
            gracefulCloseSocket(socket);
          }
        }
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to reconcile remote tunnel streams after reconnect");
    }
  }

  private clearDisconnectGraceTimer(): void {
    if (!this.disconnectGraceTimer) return;
    clearTimeout(this.disconnectGraceTimer);
    this.disconnectGraceTimer = null;
  }

  private flushConnectWaiters(connected: boolean): void {
    if (this.connectWaiters.size === 0) return;
    const waiters = [...this.connectWaiters];
    this.connectWaiters.clear();
    for (const resolve of waiters) {
      resolve(connected);
    }
  }

  private isPeerConnected(): boolean {
    return this.client?.isConnected === true;
  }

  private waitForPeerConnected(socket: net.Socket): Promise<boolean> {
    if (this.isPeerConnected()) {
      return Promise.resolve(true);
    }
    if (this.disposed || !this.hasConnectedOnce) {
      return Promise.resolve(false);
    }
    const timeoutMs = this.options.connectWaitTimeoutMs ?? DEFAULT_CONNECT_WAIT_TIMEOUT_MS;
    let resolveWait!: (ok: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveWait = resolve;
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.connectWaiters.delete(finish);
      socket.off("close", onSocketClose);
      resolveWait(ok);
    };
    const onSocketClose = (): void => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    this.connectWaiters.add(finish);
    socket.once("close", onSocketClose);
    return promise;
  }

  private destroyAllStreams(reason: string): void {
    let destroyed = 0;
    for (const forward of this.forwards.values()) {
      for (const [socket] of forward.streams) {
        destroyed += 1;
        socket.destroy();
      }
      forward.streams.clear();
    }
    this.pendingUpstreamCloses.clear();
    if (destroyed > 0) {
      this.logger.warn({ destroyed, reason }, "Destroyed active tunnel streams");
    }
  }

  private async startListener(forward: ForwardState): Promise<void> {
    const host = this.options.localHost ?? "127.0.0.1";
    const listener = net.createServer((socket) => {
      void this.handleLocalConnection(forward, socket);
    });
    forward.listener = listener;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => reject(error);
      listener.once("error", fail);
      listener.listen({ host, port: 0 }, () => {
        listener.off("error", fail);
        const address = listener.address();
        forward.localPort = address && typeof address === "object" ? address.port : null;
        forward.state = this.client?.isConnected === true ? "connected" : "connecting";
        this.logger.info(
          { remotePort: forward.remotePort, localPort: forward.localPort },
          "Tunnel local listener ready",
        );
        resolve();
      });
    });
  }

  private async openRemoteTunnelWithRetry(
    forward: ForwardState,
    socket: net.Socket,
  ): Promise<TunnelOpenResponse["payload"] | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (socket.destroyed || this.disposed) {
        return null;
      }
      if (!this.isPeerConnected()) {
        const connected = await this.waitForPeerConnected(socket);
        if (!connected || !this.client || !this.isPeerConnected()) {
          forward.lastError = "peer daemon not connected";
          socket.destroy();
          return null;
        }
      }
      try {
        return await this.client!.openTunnel(forward.remotePort);
      } catch (error) {
        if (attempt === 0 && !this.isPeerConnected() && this.hasConnectedOnce) {
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        forward.lastError = message;
        if (this.isPeerConnected()) {
          forward.state = "error";
        }
        this.logger.warn(
          { remotePort: forward.remotePort, err: error },
          "Tunnel open request failed",
        );
        socket.destroy();
        return null;
      }
    }
    socket.destroy();
    return null;
  }

  private sendOrQueueUpstreamClose(tunnelId: string): void {
    if (this.isPeerConnected() && this.client) {
      try {
        this.client.sendTunnelFrame(TunnelFrameOpcode.Close, tunnelId);
        return;
      } catch {
        // Fall through to queue for next reconnect.
      }
    }
    this.pendingUpstreamCloses.add(tunnelId);
  }

  private async handleLocalConnection(forward: ForwardState, socket: net.Socket): Promise<void> {
    let tunnelId: string | null = null;
    socket.on("error", () => {
      const removed = forward.streams.delete(socket);
      socket.destroy();
      if (removed && tunnelId !== null) {
        this.sendOrQueueUpstreamClose(tunnelId);
      }
    });
    socket.on("close", () => {
      if (!forward.streams.delete(socket) || tunnelId === null) {
        return;
      }
      this.sendOrQueueUpstreamClose(tunnelId);
    });

    socket.pause();
    const open = await this.openRemoteTunnelWithRetry(forward, socket);
    if (!open) {
      return;
    }
    if (!open.allowed) {
      const reason = open.reason ?? "open denied";
      forward.lastError = reason;
      forward.state = "error";
      this.logger.warn({ remotePort: forward.remotePort, reason }, "Tunnel open denied by peer");
      socket.destroy();
      return;
    }
    tunnelId = open.tunnelId;
    if (socket.destroyed) {
      this.sendOrQueueUpstreamClose(tunnelId);
      return;
    }
    forward.lastError = null;
    forward.state = "connected";
    const activeTunnelId = tunnelId;
    const stream: ActiveStream = {
      tunnelId: activeTunnelId,
      pendingUpstream: [],
      pendingUpstreamBytes: 0,
    };
    forward.streams.set(socket, stream);

    socket.on("data", (chunk: Buffer) => {
      if (this.isPeerConnected() && this.client && stream.pendingUpstream.length === 0) {
        try {
          this.client.sendTunnelFrame(TunnelFrameOpcode.DataUpstream, activeTunnelId, chunk);
          return;
        } catch {
          // Fall through to pause & buffer while reconnecting.
        }
      }
      socket.pause();
      if (stream.pendingUpstreamBytes + chunk.byteLength > MAX_PENDING_UPSTREAM_BYTES_PER_STREAM) {
        this.logger.warn(
          {
            tunnelId: activeTunnelId,
            remotePort: forward.remotePort,
            bufferedBytes: stream.pendingUpstreamBytes,
          },
          "Tunnel upstream buffer exceeded while peer disconnected; destroying local socket",
        );
        forward.streams.delete(socket);
        socket.destroy();
        this.sendOrQueueUpstreamClose(activeTunnelId);
        return;
      }
      stream.pendingUpstream.push(Buffer.from(chunk));
      stream.pendingUpstreamBytes += chunk.byteLength;
    });

    if (this.isPeerConnected()) {
      socket.resume();
    }
  }

  private handleTunnelFrame(frame: TunnelFrame): void {
    if (frame.opcode === TunnelFrameOpcode.Close) {
      for (const forward of this.forwards.values()) {
        for (const [socket, stream] of forward.streams) {
          if (stream.tunnelId === frame.tunnelId) {
            forward.streams.delete(socket);
            gracefulCloseSocket(socket);
          }
        }
      }
      return;
    }
    if (frame.opcode !== TunnelFrameOpcode.DataDownstream) return;
    for (const forward of this.forwards.values()) {
      for (const [socket, stream] of forward.streams) {
        if (stream.tunnelId === frame.tunnelId && !socket.destroyed) {
          socket.write(frame.payload);
          return;
        }
      }
    }
    // Unknown tunnelId: stream was torn down on this side already; tell the peer.
    if (this.client?.isConnected) {
      try {
        this.client.sendTunnelFrame(TunnelFrameOpcode.Close, frame.tunnelId);
      } catch {
        // ignore
      }
    }
  }
}
