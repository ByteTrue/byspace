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
 * The peer connection rides DaemonClient's built-in reconnect; local sockets
 * arriving while the peer is down are refused (closed) until it returns.
 */

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
}

interface ForwardState {
  remotePort: number;
  label: string;
  localPort: number | null;
  listener: net.Server | null;
  /** One tunnelId per accepted local socket. */
  streams: Map<net.Socket, string>;
  state: "connecting" | "connected" | "disconnected" | "error";
  lastError: string | null;
}

export class TunnelManager {
  readonly peerId: string;
  private readonly options: TunnelManagerOptions;
  private readonly logger: pino.Logger;
  private readonly forwards = new Map<number, ForwardState>();
  private client: DaemonClient | null = null;
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
      suppressSendErrors: true,
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
    });

    void client.connect().catch((error: unknown) => {
      // connect() rejects only on terminal failure; the built-in reconnect
      // loop keeps retrying in the background. Log and let it run.
      this.logger.warn({ err: error }, "Tunnel peer connect failed; reconnecting");
    });
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

  private async handleLocalConnection(forward: ForwardState, socket: net.Socket): Promise<void> {
    const client = this.client;
    if (!client || client.isConnected !== true) {
      forward.lastError = "peer daemon not connected";
      socket.destroy();
      return;
    }
    let open: TunnelOpenResponse["payload"];
    try {
      open = await client.openTunnel(forward.remotePort);
    } catch (error) {
      forward.lastError = error instanceof Error ? error.message : String(error);
      socket.destroy();
      return;
    }
    if (!open.allowed) {
      forward.lastError = open.reason ?? "open denied";
      socket.destroy();
      return;
    }
    forward.lastError = null;
    const tunnelId = open.tunnelId;
    forward.streams.set(socket, tunnelId);

    socket.on("data", (chunk: Buffer) => {
      try {
        client.sendTunnelFrame(TunnelFrameOpcode.DataUpstream, tunnelId, chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      forward.streams.delete(socket);
      try {
        client.sendTunnelFrame(TunnelFrameOpcode.Close, tunnelId);
      } catch {
        // client already gone
      }
    });
    socket.on("error", () => {
      forward.streams.delete(socket);
      socket.destroy();
      try {
        client.sendTunnelFrame(TunnelFrameOpcode.Close, tunnelId);
      } catch {
        // client already gone
      }
    });
  }

  private handleTunnelFrame(frame: TunnelFrame): void {
    if (frame.opcode === TunnelFrameOpcode.Close) {
      for (const forward of this.forwards.values()) {
        for (const [socket, tunnelId] of forward.streams) {
          if (tunnelId === frame.tunnelId) {
            forward.streams.delete(socket);
            socket.destroy();
          }
        }
      }
      return;
    }
    if (frame.opcode !== TunnelFrameOpcode.DataDownstream) return;
    for (const forward of this.forwards.values()) {
      for (const [socket, tunnelId] of forward.streams) {
        if (tunnelId === frame.tunnelId && !socket.destroyed) {
          socket.write(frame.payload);
          return;
        }
      }
    }
    // Unknown tunnelId: stream was torn down on this side already; tell the peer.
    this.client?.sendTunnelFrame(TunnelFrameOpcode.Close, frame.tunnelId);
  }
}
