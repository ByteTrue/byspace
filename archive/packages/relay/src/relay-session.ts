/**
 * Runtime-agnostic relay session logic for the self-hosted Node relay.
 *
 * This module mirrors the behavior of the Cloudflare Durable Object adapter
 * (`cloudflare-adapter.ts`) so a self-hosted relay is wire-compatible:
 *
 * - v1: single server/client socket pair per role
 * - v2: one server control socket per serverId, one server data socket per
 *   connectionId, many client sockets per connectionId
 * - frames from a client arriving before the matching server data socket
 *   connects are buffered (max 200) and flushed on connect
 * - when the last client socket for a connectionId closes, the matching server
 *   data socket is closed (1001) and controls are notified
 * - when a server data socket closes, matching client sockets are closed (1012)
 * - same-identity reconnects replace existing sockets (1008)
 *
 * Unlike the Durable Object, socket registries live in memory in a single Node
 * process. Run one replica per relay endpoint; scale-out is not supported.
 */

import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

export type RelayProtocolVersion = "1" | "2";

export const LEGACY_RELAY_VERSION: RelayProtocolVersion = "1";
export const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";

const MAX_BUFFERED_FRAMES = 200;

/** Minimal socket surface the session logic needs. */
export interface RelaySocket {
  send(data: unknown, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export function resolveRelayVersion(rawValue: string | null): RelayProtocolVersion | null {
  if (rawValue == null) return LEGACY_RELAY_VERSION;
  const value = rawValue.trim();
  if (!value) return LEGACY_RELAY_VERSION;
  if (value === LEGACY_RELAY_VERSION || value === CURRENT_RELAY_VERSION) {
    return value;
  }
  return null;
}

interface TaggedSocket<S extends RelaySocket> {
  socket: S;
  attachment: RelaySessionAttachment;
}

/**
 * Tracks all sockets for one serverId (the unit the DO isolates on).
 * Tags mirror the DO tagging scheme:
 * "server-control" | "server" | "server:{connectionId}" | "client" | "client:{connectionId}"
 */
export class RelaySession<S extends RelaySocket> {
  private sockets = new Map<string, TaggedSocket<S>[]>();
  private pendingFrames = new Map<string, Array<string | ArrayBufferLike>>();

  add(socket: S, tags: string[], attachment: RelaySessionAttachment): void {
    const entry: TaggedSocket<S> = { socket, attachment };
    for (const tag of tags) {
      const list = this.sockets.get(tag) ?? [];
      list.push(entry);
      this.sockets.set(tag, list);
    }
  }

  get(tag: string): S[] {
    return (this.sockets.get(tag) ?? []).map((entry) => entry.socket);
  }

  remove(socket: S): void {
    for (const [tag, list] of this.sockets) {
      const next = list.filter((entry) => entry.socket !== socket);
      if (next.length === 0) {
        this.sockets.delete(tag);
      } else {
        this.sockets.set(tag, next);
      }
    }
  }

  closeTagged(tag: string, code: number, reason: string): void {
    for (const { socket } of this.sockets.get(tag) ?? []) {
      try {
        socket.close(code, reason);
      } catch {
        // ignore
      }
    }
  }

  /** Sockets carrying a given role tag ("server" | "client"), any version. */
  byRole(role: ConnectionRole): S[] {
    return this.get(role);
  }

  listConnectedConnectionIds(): string[] {
    const out = new Set<string>();
    for (const { attachment } of this.sockets.get("client") ?? []) {
      if (attachment.role === "client" && attachment.connectionId) {
        out.add(attachment.connectionId);
      }
    }
    return Array.from(out);
  }

  notifyControls(message: unknown): void {
    const text = JSON.stringify(message);
    for (const socket of this.get("server-control")) {
      try {
        socket.send(text);
      } catch {
        try {
          socket.close(1011, "Control send failed");
        } catch {
          // ignore
        }
      }
    }
  }

  bufferFrame(connectionId: string, message: string | ArrayBufferLike): void {
    const existing = this.pendingFrames.get(connectionId) ?? [];
    existing.push(message);
    // Prevent unbounded memory growth if a daemon never connects.
    if (existing.length > MAX_BUFFERED_FRAMES) {
      existing.splice(0, existing.length - MAX_BUFFERED_FRAMES);
    }
    this.pendingFrames.set(connectionId, existing);
  }

  flushFrames(connectionId: string, serverSocket: S): void {
    const frames = this.pendingFrames.get(connectionId);
    if (!frames || frames.length === 0) return;
    this.pendingFrames.delete(connectionId);
    for (const frame of frames) {
      try {
        serverSocket.send(frame);
      } catch {
        // If we can't flush, re-buffer and let the daemon re-establish.
        this.bufferFrame(connectionId, frame);
        break;
      }
    }
  }

  dropBufferedFrames(connectionId: string): void {
    this.pendingFrames.delete(connectionId);
  }

  hasClientSocket(connectionId: string): boolean {
    return this.get(`client:${connectionId}`).length > 0;
  }

  hasServerDataSocket(connectionId: string): boolean {
    return this.get(`server:${connectionId}`).length > 0;
  }

  /**
   * If the daemon's control socket is half-open, nudging it with a sync list
   * and, failing that, force-closing it lets the daemon reconnect. Mirrors the
   * DO adapter's nudgeOrResetControlForConnection.
   */
  nudgeOrResetControlForConnection(connectionId: string): void {
    const initialDelayMs = 10_000;
    const secondDelayMs = 5_000;

    setTimeout(() => {
      if (!this.hasClientSocket(connectionId)) return;
      if (this.hasServerDataSocket(connectionId)) return;

      // First nudge: send a full sync list.
      this.notifyControls({ type: "sync", connectionIds: this.listConnectedConnectionIds() });

      setTimeout(() => {
        if (!this.hasClientSocket(connectionId)) return;
        if (this.hasServerDataSocket(connectionId)) return;

        // Still nothing: assume control is stuck and force a reconnect.
        for (const socket of this.get("server-control")) {
          try {
            socket.close(1011, "Control unresponsive");
          } catch {
            // ignore
          }
        }
      }, secondDelayMs);
    }, initialDelayMs);
  }

  // COMPAT(relay-json-ping): Old daemons (< v0.1.76) send JSON {type:"ping"} on the control
  // socket and rely on a JSON {type:"pong"} reply to keep controlLastSeenAt fresh. New daemons
  // use WebSocket protocol pings. Remove this handler once the supported-daemon floor is
  // >= v0.1.76 (target: 2026-11-13).
  handleControlKeepalive(socket: S, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
      const parsedRecord = typeof parsed === "object" && parsed !== null ? parsed : null;
      if (!parsedRecord || (parsedRecord as { type?: unknown }).type !== "ping") return;
      try {
        socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      } catch {
        // ignore
      }
    } catch {
      // ignore non-JSON control payloads
    }
  }
}
