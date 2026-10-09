import net from "node:net";

import type pino from "pino";

import {
  encodeTunnelFrame,
  TunnelFrameOpcode,
  type TunnelCloseFrame,
  type TunnelDataFrame,
  type TunnelFrame,
} from "@bytetrue/protocol/binary-frames/index";
import type {
  SessionInboundMessage,
  SessionOutboundMessage,
  TunnelCreateRequest,
  TunnelListRequest,
  TunnelCloseRequest,
  TunnelOpenRequest,
  TunnelStatsRequest,
  TunnelRemoveRequest,
} from "@bytetrue/protocol/messages";

/**
 * Target-side (D2) tunnel session controller. A paired daemon (D1) connected
 * as a regular authenticated client asks to forward its local TCP bytes to
 * whitelisted ports on this host. Control rides the JSON session RPCs; byte
 * streams ride the tunnel binary frames.
 *
 * Security boundary (issue 062): every open request is checked against the
 * static port allowlist, and the daemon must have a password configured —
 * the feature refuses to run otherwise. Authentication itself is the session
 * password auth plus the E2EE pairing key when the peer comes via relay.
 */
export interface TunnelSessionHost {
  emit(msg: SessionOutboundMessage): void;
  emitBinary(frame: Uint8Array): void;
}

export interface OutboundTunnelStatus {
  peerId: string;
  peerHostname: string | null;
  state: "connecting" | "connected" | "disconnected" | "error";
  lastError: string | null;
  forwards: Array<{
    remotePort: number;
    label: string;
    localPort: number | null;
    state: "connecting" | "connected" | "disconnected" | "error";
    lastError: string | null;
  }>;
}

/** D1-side tunnel management surface, present only when tunnels are configured. */
export interface TunnelOutboundController {
  list(): OutboundTunnelStatus[];
  add(config: {
    peerId: string;
    peerHostname?: string;
    url: string;
    password: string;
    daemonPublicKeyB64?: string;
    forwards: Array<{ remotePort: number; label?: string }>;
  }): Promise<void>;
  remove(peerId: string): Promise<void>;
}

export interface TunnelSessionOptions {
  host: TunnelSessionHost;
  /** Ports this host allows to be forwarded. Read live; config changes apply to new opens. */
  getAllowedPorts: () => number[];
  /** Feature gate: the daemon must have a password set before any open is granted. */
  isPasswordSet: () => boolean;
  /** Host address the forwarded connections dial. Production: 127.0.0.1. */
  targetHost?: string;
  /** D1-side management (initiator daemons only). */
  outbound?: TunnelOutboundController | null;
  logger: pino.Logger;
}

interface InboundTunnel {
  tunnelId: string;
  socket: net.Socket | null;
  remotePort: number;
  bytesUp: number;
  bytesDown: number;
  state: "connected" | "closed";
  closeReason: string | null;
}

let tunnelIdCounter = 0;

export class TunnelSession {
  private readonly host: TunnelSessionHost;
  private readonly getAllowedPorts: () => number[];
  private readonly isPasswordSet: () => boolean;
  private readonly targetHost: string;
  private readonly logger: pino.Logger;
  private readonly tunnels = new Map<string, InboundTunnel>();
  private readonly outbound: TunnelOutboundController | null;

  constructor(options: TunnelSessionOptions) {
    this.host = options.host;
    this.getAllowedPorts = options.getAllowedPorts;
    this.isPasswordSet = options.isPasswordSet;
    this.targetHost = options.targetHost ?? "127.0.0.1";
    this.outbound = options.outbound ?? null;
    this.logger = options.logger.child({ module: "tunnel-session" });
  }

  /**
   * Single entry point from Session dispatch: owns every `tunnel.*` request
   * type so the session switch stays one case.
   */
  async dispatchTunnelMessage(
    msg: Extract<
      SessionInboundMessage,
      {
        type:
          | "tunnel.open.request"
          | "tunnel.close.request"
          | "tunnel.list.request"
          | "tunnel.stats.request"
          | "tunnel.create.request"
          | "tunnel.remove.request";
      }
    >,
  ): Promise<void> {
    switch (msg.type) {
      case "tunnel.open.request":
        return this.handleOpenRequest(msg);
      case "tunnel.close.request":
        this.handleCloseRequest(msg);
        return;
      case "tunnel.list.request":
        this.handleListRequest(msg);
        return;
      case "tunnel.stats.request":
        this.handleStatsRequest(msg);
        return;
      case "tunnel.create.request":
        return this.handleCreateRequest(msg);
      case "tunnel.remove.request":
        return this.handleRemoveRequest(msg);
    }
  }

  async handleOpenRequest(msg: TunnelOpenRequest): Promise<void> {
    const { remotePort, requestId } = msg;
    const deny = (reason: string): void => {
      this.host.emit({
        type: "tunnel.open.response",
        payload: { requestId, tunnelId: "", remotePort, allowed: false, reason },
      });
    };

    if (!this.isPasswordSet()) {
      this.logger.warn({ remotePort }, "Tunnel open denied: daemon has no password");
      deny("Daemon password is not set. Set a daemon password to enable tunnels.");
      return;
    }
    if (!this.getAllowedPorts().includes(remotePort)) {
      this.logger.warn({ remotePort }, "Tunnel open denied: port not in allowlist");
      deny(`Port ${remotePort} is not in the tunnel allowlist.`);
      return;
    }

    const tunnelId = `tun-${Date.now().toString(36)}-${(tunnelIdCounter += 1)}`;
    try {
      const socket = await this.connectTarget(remotePort);
      const tunnel: InboundTunnel = {
        tunnelId,
        socket,
        remotePort,
        bytesUp: 0,
        bytesDown: 0,
        state: "connected",
        closeReason: null,
      };
      this.tunnels.set(tunnelId, tunnel);

      socket.on("data", (chunk: Buffer) => {
        tunnel.bytesDown += chunk.byteLength;
        this.sendFrame(tunnelId, TunnelFrameOpcode.DataDownstream, chunk);
      });
      socket.on("close", () => this.closeTunnel(tunnelId, "target closed"));
      socket.on("error", (error: Error) => this.closeTunnel(tunnelId, error.message));

      this.host.emit({
        type: "tunnel.open.response",
        payload: { requestId, tunnelId, remotePort, allowed: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ remotePort, err: error }, "Tunnel target connect failed");
      deny(`Failed to connect to 127.0.0.1:${remotePort}: ${message}`);
    }
  }

  handleCloseRequest(msg: TunnelCloseRequest): void {
    this.closeTunnel(msg.tunnelId, "peer requested close");
    this.host.emit({
      type: "tunnel.close.response",
      payload: { requestId: msg.requestId, tunnelId: msg.tunnelId },
    });
  }

  handleListRequest(msg: TunnelListRequest): void {
    const inboundEntries = [...this.tunnels.values()].map((tunnel) => ({
      tunnelId: tunnel.tunnelId,
      direction: "inbound" as const,
      remotePort: tunnel.remotePort,
      state: tunnel.state === "connected" ? ("connected" as const) : ("disconnected" as const),
      lastError: tunnel.closeReason,
    }));
    const outboundEntries = (this.outbound?.list() ?? []).flatMap((peer) =>
      peer.forwards.map((forward) => ({
        tunnelId: `${peer.peerId}:${forward.remotePort}`,
        direction: "outbound" as const,
        remotePort: forward.remotePort,
        localPort: forward.localPort,
        peerHostname: peer.peerHostname,
        state: forward.state,
        lastError: forward.lastError,
      })),
    );
    this.host.emit({
      type: "tunnel.list.response",
      payload: {
        requestId: msg.requestId,
        entries: [...inboundEntries, ...outboundEntries],
      },
    });
  }

  async handleCreateRequest(msg: TunnelCreateRequest): Promise<void> {
    if (!this.outbound) {
      this.host.emit({
        type: "tunnel.create.response",
        payload: {
          requestId: msg.requestId,
          peerId: msg.config.peerId,
          ok: false,
          error: "This daemon has no tunnel manager.",
        },
      });
      return;
    }
    // Issue 062 gate: both daemons must have a password. The D2 side enforces
    // its own on tunnel.open; here the local (initiator) daemon refuses to
    // create a tunnel while its own password is unset.
    if (!this.isPasswordSet()) {
      this.host.emit({
        type: "tunnel.create.response",
        payload: {
          requestId: msg.requestId,
          peerId: msg.config.peerId,
          ok: false,
          error: "Daemon password is not set. Set a daemon password to enable tunnels.",
        },
      });
      return;
    }
    try {
      await this.outbound.add(msg.config);
      this.host.emit({
        type: "tunnel.create.response",
        payload: { requestId: msg.requestId, peerId: msg.config.peerId, ok: true },
      });
    } catch (error) {
      this.host.emit({
        type: "tunnel.create.response",
        payload: {
          requestId: msg.requestId,
          peerId: msg.config.peerId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async handleRemoveRequest(msg: TunnelRemoveRequest): Promise<void> {
    if (!this.outbound) {
      this.host.emit({
        type: "tunnel.remove.response",
        payload: {
          requestId: msg.requestId,
          peerId: msg.peerId,
          ok: false,
          error: "This daemon has no tunnel manager.",
        },
      });
      return;
    }
    try {
      await this.outbound.remove(msg.peerId);
      this.host.emit({
        type: "tunnel.remove.response",
        payload: { requestId: msg.requestId, peerId: msg.peerId, ok: true },
      });
    } catch (error) {
      this.host.emit({
        type: "tunnel.remove.response",
        payload: {
          requestId: msg.requestId,
          peerId: msg.peerId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  handleStatsRequest(msg: TunnelStatsRequest): void {
    this.host.emit({
      type: "tunnel.stats.response",
      payload: {
        requestId: msg.requestId,
        entries: [...this.tunnels.values()].map((tunnel) => ({
          tunnelId: tunnel.tunnelId,
          remotePort: tunnel.remotePort,
          bytesUp: tunnel.bytesUp,
          bytesDown: tunnel.bytesDown,
        })),
      },
    });
  }

  handleBinaryFrame(frame: TunnelFrame): void {
    if (frame.opcode === TunnelFrameOpcode.Close) {
      this.handleCloseFrame(frame);
      return;
    }
    if (frame.opcode !== TunnelFrameOpcode.DataUpstream) {
      this.logger.warn({ opcode: frame.opcode }, "Unexpected tunnel frame direction; ignored");
      return;
    }
    const data = frame as TunnelDataFrame;
    const tunnel = this.tunnels.get(data.tunnelId);
    if (!tunnel) {
      // Tell the peer the stream is gone so it can stop writing.
      this.sendFrame(data.tunnelId, TunnelFrameOpcode.Close);
      return;
    }
    tunnel.bytesUp += data.payload.byteLength;
    if (tunnel.socket && !tunnel.socket.destroyed) {
      tunnel.socket.write(data.payload);
    }
  }

  /** Session teardown: destroy every target socket. */
  cleanup(): void {
    for (const tunnel of this.tunnels.values()) {
      this.closeTunnel(tunnel.tunnelId, "session closed");
    }
  }

  private handleCloseFrame(frame: TunnelCloseFrame): void {
    this.closeTunnel(frame.tunnelId, "peer closed");
  }

  private closeTunnel(tunnelId: string, reason: string): void {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return;
    if (tunnel.state !== "closed") {
      tunnel.state = "closed";
      tunnel.closeReason = reason;
      this.sendFrame(tunnelId, TunnelFrameOpcode.Close);
    }
    tunnel.socket?.destroy();
    this.tunnels.delete(tunnelId);
  }

  private sendFrame(tunnelId: string, opcode: TunnelFrameOpcode, payload?: Uint8Array): void {
    this.host.emitBinary(encodeTunnelFrame({ opcode, tunnelId, payload }));
  }

  private connectTarget(remotePort: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.targetHost, port: remotePort });
      const fail = (error: Error): void => {
        socket.destroy();
        reject(error);
      };
      socket.once("connect", () => {
        socket.off("error", fail);
        resolve(socket);
      });
      socket.once("error", fail);
    });
  }
}
