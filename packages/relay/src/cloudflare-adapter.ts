/**
 * Cloudflare Durable Objects adapter for the relay.
 *
 * This module provides a Durable Object class that can be deployed to
 * Cloudflare Workers. It uses WebSocket hibernation for cost efficiency.
 *
 * Each session gets its own Durable Object instance, identified by session ID.
 *
 * Wrangler config:
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "RELAY", "class_name": "RelayDurableObject" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["RelayDurableObject"] }]
 * }
 * ```
 */

import { createCutoverProxy } from "./cutover-proxy.js";
import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

type RelayProtocolVersion = "1" | "2";

const LEGACY_RELAY_VERSION: RelayProtocolVersion = "1";
const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";
const RELAY_CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RELAY_V2_SERVER_ID_PATTERN = /^srv_[A-Za-z0-9_-]{12}$/;
const MAX_RELAY_FRAME_BYTES = 2 << 20;
const MAX_PENDING_FRAMES_PER_CONNECTION = 200;
const MAX_PENDING_BYTES_PER_CONNECTION = 2 << 20;
const MAX_PENDING_CONNECTIONS = 64;
const MAX_PENDING_BYTES_TOTAL = 16 << 20;
const MAX_CLIENT_SOCKETS = 256;

function resolveRelayVersion(rawValue: string | null): RelayProtocolVersion | null {
  if (rawValue == null) return LEGACY_RELAY_VERSION;
  const value = rawValue.trim();
  if (!value) return LEGACY_RELAY_VERSION;
  if (value === LEGACY_RELAY_VERSION || value === CURRENT_RELAY_VERSION) {
    return value;
  }
  return null;
}

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

interface WebSocketWithAttachment extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

function hasAttachmentMethods(ws: WebSocket): ws is WebSocketWithAttachment {
  // Type-safe check for attachment methods - required for Cloudflare WebSocket hibernation API
  // Use Reflect to check for methods without type assertions
  return (
    "serializeAttachment" in ws &&
    "deserializeAttachment" in ws &&
    typeof Reflect.get(ws, "serializeAttachment") === "function" &&
    typeof Reflect.get(ws, "deserializeAttachment") === "function"
  );
}

function deserializeAttachment(ws: WebSocket): unknown {
  if (!hasAttachmentMethods(ws)) return null;
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

function serializeAttachment(ws: WebSocket, value: unknown): void {
  if (!hasAttachmentMethods(ws)) {
    throw new Error("WebSocket does not support attachments");
  }
  ws.serializeAttachment(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getGlobalWebSocketPair(): (new () => WebSocketPair) | undefined {
  // Access WebSocketPair from global scope (Cloudflare Workers runtime)
  // Use Reflect to access global property without type assertions
  const WebSocketPair = Reflect.get(globalThis, "WebSocketPair") as unknown;
  if (typeof WebSocketPair === "function") {
    return WebSocketPair as new () => WebSocketPair;
  }
  return undefined;
}

interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_RATE_LIMITER: RateLimitBinding;
  PASEO_RELAY_UPSTREAM?: string;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

/**
 * Durable Object that handles WebSocket relay for a single session.
 *
 * v1 WebSockets connect in two shapes:
 * - role=server: daemon socket
 * - role=client: app/client socket
 *
 * v2 WebSockets connect in three shapes:
 * - role=server (no connectionId): daemon control socket (one per serverId)
 * - role=server&connectionId=...: daemon per-connection data socket (one per connectionId)
 * - role=client: app/client socket; Relay assigns a fresh connectionId
 */
interface CFResponseInit extends ResponseInit {
  webSocket?: WebSocket;
}

export class RelayDurableObject {
  private state: DurableObjectState;
  private pendingFrames = new Map<string, Array<string | ArrayBuffer>>();
  private pendingFrameBytes = new Map<string, number>();
  private pendingBytesTotal = 0;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private createWebSocketPair(): [WebSocket, WebSocket] {
    const WebSocketPairCtor = getGlobalWebSocketPair();
    if (!WebSocketPairCtor) {
      throw new Error("WebSocketPair not available in global scope");
    }
    const pair: WebSocketPair = new WebSocketPairCtor();
    return [pair[0], pair[1]];
  }

  private requireWebSocketUpgrade(request: Request): Response | null {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return null;
  }

  private asSwitchingProtocolsResponse(client: WebSocket): Response {
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as CFResponseInit);
  }

  private hasServerDataSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`server:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  private hasClientSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`client:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  // COMPAT(relay-json-ping): Old daemons (< v0.1.76) send JSON {type:"ping"} on the control
  // socket and rely on a JSON {type:"pong"} reply to keep controlLastSeenAt fresh. New daemons
  // use WebSocket protocol pings (auto-answered at the edge, DO stays hibernated). Remove this
  // handler once the supported-daemon floor is >= v0.1.76 (target: 2026-11-13).
  private handleControlKeepalive(ws: WebSocket, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
      const parsedRecord = isRecord(parsed) ? parsed : null;
      if (parsedRecord?.type !== "ping") return;
      // Logged so the daemon-side e2e idle test can assert no JSON ping reached the DO
      // (which would indicate a regression to app-level pings that wake the DO).
      console.log("[Relay DO] legacy_json_ping_received");
      try {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      } catch {
        // ignore
      }
    } catch {
      // ignore non-JSON control payloads
    }
  }

  private nudgeOrResetControlForConnection(connectionId: string): void {
    // If the daemon's control WS becomes half-open, the DO can't reliably detect it via ws.send errors
    // (Cloudflare may accept writes even if the other side is no longer reading).
    //
    // Instead, observe whether the daemon reacts by opening the per-connection server-data socket.
    // If it doesn't, nudge with a sync message; if still no reaction, force-close the control
    // socket(s) so the daemon reconnects.
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
        for (const ws of this.state.getWebSockets("server-control")) {
          try {
            ws.close(1011, "Control unresponsive");
          } catch {
            // ignore
          }
        }
      }, secondDelayMs);
    }, initialDelayMs);
  }

  private frameBytes(message: string | ArrayBuffer): number {
    return typeof message === "string"
      ? new TextEncoder().encode(message).byteLength
      : message.byteLength;
  }

  private deletePendingFrames(connectionId: string): void {
    this.pendingFrames.delete(connectionId);
    const bytes = this.pendingFrameBytes.get(connectionId) ?? 0;
    this.pendingFrameBytes.delete(connectionId);
    this.pendingBytesTotal -= bytes;
  }

  private bufferFrame(connectionId: string, message: string | ArrayBuffer): boolean {
    const messageBytes = this.frameBytes(message);
    const existing = this.pendingFrames.get(connectionId);
    const existingBytes = this.pendingFrameBytes.get(connectionId) ?? 0;
    if (
      messageBytes > MAX_RELAY_FRAME_BYTES ||
      (existing?.length ?? 0) >= MAX_PENDING_FRAMES_PER_CONNECTION ||
      existingBytes + messageBytes > MAX_PENDING_BYTES_PER_CONNECTION ||
      (!existing && this.pendingFrames.size >= MAX_PENDING_CONNECTIONS) ||
      this.pendingBytesTotal + messageBytes > MAX_PENDING_BYTES_TOTAL
    ) {
      return false;
    }

    const frames = existing ?? [];
    frames.push(message);
    this.pendingFrames.set(connectionId, frames);
    this.pendingFrameBytes.set(connectionId, existingBytes + messageBytes);
    this.pendingBytesTotal += messageBytes;
    return true;
  }

  private flushFrames(connectionId: string, serverWs: WebSocket): void {
    const frames = this.pendingFrames.get(connectionId);
    if (!frames || frames.length === 0) return;
    this.deletePendingFrames(connectionId);
    for (let index = 0; index < frames.length; index++) {
      try {
        serverWs.send(frames[index]!);
      } catch {
        // If we can't flush, re-buffer the unsent suffix and let the daemon re-establish.
        for (const frame of frames.slice(index)) {
          if (!this.bufferFrame(connectionId, frame)) break;
        }
        break;
      }
    }
  }

  private listConnectedConnectionIds(): string[] {
    const out = new Set<string>();
    for (const ws of this.state.getWebSockets("client")) {
      try {
        const attachmentRaw = deserializeAttachment(ws);
        const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
        if (
          attachment?.role === "client" &&
          typeof attachment.connectionId === "string" &&
          attachment.connectionId
        ) {
          out.add(attachment.connectionId);
        }
      } catch {
        // ignore
      }
    }
    return Array.from(out);
  }

  private notifyControls(message: unknown): void {
    const text = JSON.stringify(message);
    for (const ws of this.state.getWebSockets("server-control")) {
      try {
        ws.send(text);
      } catch {
        // If the control socket is dead, close it so the daemon can reconnect.
        try {
          ws.close(1011, "Control send failed");
        } catch {
          // ignore
        }
      }
    }
  }

  private fetchV1(request: Request, role: ConnectionRole, serverId: string): Response {
    const upgradeError = this.requireWebSocketUpgrade(request);
    if (upgradeError) return upgradeError;

    for (const ws of this.state.getWebSockets(role)) {
      ws.close(1008, "Replaced by new connection");
    }

    const [client, server] = this.createWebSocketPair();
    this.state.acceptWebSocket(server, [role]);

    const attachment: RelaySessionAttachment = {
      serverId,
      role,
      version: LEGACY_RELAY_VERSION,
      connectionId: null,
      createdAt: Date.now(),
    };
    serializeAttachment(server, attachment);

    console.log(`[Relay DO] v1:${role} connected to session ${serverId}`);

    return this.asSwitchingProtocolsResponse(client);
  }

  private fetchV2(
    request: Request,
    role: ConnectionRole,
    serverId: string,
    connectionId: string,
  ): Response {
    const upgradeError = this.requireWebSocketUpgrade(request);
    if (upgradeError) return upgradeError;

    // Relay v2 connection IDs are always assigned by the Relay. Accepting a
    // client-selected ID would let one client interfere with another socket.
    const resolvedConnectionId =
      role === "client"
        ? `conn_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
        : connectionId;

    const isServerControl = role === "server" && !resolvedConnectionId;
    const isServerData = role === "server" && !!resolvedConnectionId;

    // Capture replacements before accepting the new socket. Closing an old
    // server-data socket only after registration lets its close callback see
    // the replacement and preserve the paired client.
    const replacedServerSockets = isServerControl
      ? this.state.getWebSockets("server-control")
      : isServerData
        ? this.state.getWebSockets(`server:${resolvedConnectionId}`)
        : [];

    const [client, server] = this.createWebSocketPair();

    const tags: string[] = [];
    if (role === "client") {
      tags.push("client", `client:${resolvedConnectionId}`);
    } else if (isServerControl) {
      tags.push("server-control");
    } else {
      tags.push("server", `server:${resolvedConnectionId}`);
    }

    this.state.acceptWebSocket(server, tags);
    for (const replaced of replacedServerSockets) {
      replaced.close(1008, "Replaced by new connection");
    }

    const attachment: RelaySessionAttachment = {
      serverId,
      role,
      version: CURRENT_RELAY_VERSION,
      connectionId: resolvedConnectionId || null,
      createdAt: Date.now(),
    };
    serializeAttachment(server, attachment);

    let roleSuffix = "";
    if (isServerControl) {
      roleSuffix = "(control)";
    } else if (isServerData) {
      roleSuffix = `(data:${resolvedConnectionId})`;
    } else if (role === "client") {
      roleSuffix = `(${resolvedConnectionId})`;
    }
    console.log(`[Relay DO] v2:${role}${roleSuffix} connected to session ${serverId}`);

    if (role === "client") {
      this.notifyControls({ type: "connected", connectionId: resolvedConnectionId });
      this.nudgeOrResetControlForConnection(resolvedConnectionId);
    }

    if (isServerControl) {
      // Send current connection list so the daemon can attach existing connections.
      try {
        server.send(
          JSON.stringify({ type: "sync", connectionIds: this.listConnectedConnectionIds() }),
        );
      } catch {
        // ignore
      }
    }

    if (isServerData && resolvedConnectionId) {
      this.flushFrames(resolvedConnectionId, server);
    }

    return this.asSwitchingProtocolsResponse(client);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roleRaw = url.searchParams.get("role");
    const role = roleRaw === "server" || roleRaw === "client" ? roleRaw : null;
    const serverId = url.searchParams.get("serverId");
    const connectionIdRaw = url.searchParams.get("connectionId");
    const connectionId = connectionIdRaw ?? "";
    const version = resolveRelayVersion(url.searchParams.get("v"));

    if (!role || (role !== "server" && role !== "client")) {
      return new Response("Missing or invalid role parameter", { status: 400 });
    }

    if (!serverId) {
      return new Response("Missing serverId parameter", { status: 400 });
    }

    if (!version) {
      return new Response("Invalid v parameter (expected 1 or 2)", { status: 400 });
    }

    if (version === LEGACY_RELAY_VERSION) {
      return this.fetchV1(request, role, serverId);
    }

    if (role === "client" && connectionIdRaw !== null) {
      return new Response("Relay v2 client connectionId must be assigned by the Relay", {
        status: 400,
      });
    }
    if (role === "client" && this.state.getWebSockets("client").length >= MAX_CLIENT_SOCKETS) {
      return new Response("Relay client capacity reached", { status: 503 });
    }
    if (
      role === "server" &&
      connectionIdRaw !== null &&
      !RELAY_CONNECTION_ID_PATTERN.test(connectionId)
    ) {
      return new Response("Invalid connectionId parameter", { status: 400 });
    }

    return this.fetchV2(request, role, serverId, connectionId);
  }

  /**
   * Called when a WebSocket message is received (wakes from hibernation).
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (this.frameBytes(message) > MAX_RELAY_FRAME_BYTES) {
      ws.close(1009, "Relay frame exceeds size limit");
      return;
    }

    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) {
      console.error("[Relay DO] Message from WebSocket without attachment");
      return;
    }
    const attachment = attachmentRaw;

    const version = getString(attachment, "version") ?? LEGACY_RELAY_VERSION;

    if (version === LEGACY_RELAY_VERSION) {
      const targetRole = attachment.role === "server" ? "client" : "server";
      const targets = this.state.getWebSockets(targetRole);
      for (const target of targets) {
        try {
          target.send(message);
        } catch (error) {
          console.error(`[Relay DO] Failed to forward to ${targetRole}:`, error);
        }
      }
      return;
    }

    const role = getString(attachment, "role");
    const connectionId = getString(attachment, "connectionId");
    if (!connectionId) {
      // Control channel: support simple app-level keepalive.
      if (typeof message === "string") {
        this.handleControlKeepalive(ws, message);
      }
      return;
    }

    if (role === "client") {
      const servers = this.state.getWebSockets(`server:${connectionId}`);
      if (servers.length === 0) {
        if (!this.bufferFrame(connectionId, message)) {
          this.deletePendingFrames(connectionId);
          ws.close(1009, "Pending Relay buffer limit exceeded");
        }
        return;
      }
      for (const target of servers) {
        try {
          target.send(message);
        } catch (error) {
          console.error(`[Relay DO] Failed to forward client->server(${connectionId}):`, error);
        }
      }
      return;
    }

    // server data socket -> client
    const targets = this.state.getWebSockets(`client:${connectionId}`);
    for (const target of targets) {
      try {
        target.send(message);
      } catch (error) {
        console.error(`[Relay DO] Failed to forward server->client(${connectionId}):`, error);
      }
    }
  }

  /**
   * Called when a WebSocket closes (wakes from hibernation).
   */
  webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) return;
    const attachment = attachmentRaw;

    const version = getString(attachment, "version") ?? LEGACY_RELAY_VERSION;
    const role = getString(attachment, "role");
    const connectionId = getString(attachment, "connectionId");
    const serverId = getString(attachment, "serverId");
    console.log(
      `[Relay DO] v${version}:${role ?? "unknown"}${connectionId ? `(${connectionId})` : ""} disconnected from session ${serverId ?? "unknown"} (${code}: ${reason})`,
    );

    if (version === LEGACY_RELAY_VERSION) {
      return;
    }

    if (role === "client" && connectionId) {
      const remainingClientSockets = this.state
        .getWebSockets(`client:${connectionId}`)
        .some((socket) => socket !== ws);
      if (remainingClientSockets) {
        return;
      }

      this.deletePendingFrames(connectionId);
      // Last socket for this session closed: now clean up matching server-data socket.
      for (const serverWs of this.state.getWebSockets(`server:${connectionId}`)) {
        try {
          serverWs.close(1001, "Client disconnected");
        } catch {
          // ignore
        }
      }
      this.notifyControls({ type: "disconnected", connectionId });
      return;
    }

    if (role === "server" && connectionId) {
      const replacementExists = this.state
        .getWebSockets(`server:${connectionId}`)
        .some((socket) => socket !== ws);
      if (replacementExists) return;

      // Force the client to reconnect and re-handshake when the daemon side drops.
      for (const clientWs of this.state.getWebSockets(`client:${connectionId}`)) {
        try {
          clientWs.close(1012, "Server disconnected");
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Called on WebSocket error.
   */
  webSocketError(ws: WebSocket, error: unknown): void {
    const attachmentRaw = deserializeAttachment(ws);
    const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
    const role = attachment ? getString(attachment, "role") : undefined;
    console.error(`[Relay DO] WebSocket error for ${role ?? "unknown"}:`, error);
  }
}

/**
 * Worker entry point that routes requests to the appropriate Durable Object.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.PASEO_RELAY_UPSTREAM) {
      return createCutoverProxy(env.PASEO_RELAY_UPSTREAM).fetch(request);
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Relay endpoint
    if (url.pathname === "/ws") {
      const role = url.searchParams.get("role");
      if (role !== "server" && role !== "client") {
        return new Response("Missing or invalid role parameter", { status: 400 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const serverId = url.searchParams.get("serverId");
      if (!serverId) {
        return new Response("Missing serverId parameter", { status: 400 });
      }

      const version = resolveRelayVersion(url.searchParams.get("v"));
      if (!version) {
        return new Response("Invalid v parameter (expected 1 or 2)", { status: 400 });
      }
      if (version === CURRENT_RELAY_VERSION && !RELAY_V2_SERVER_ID_PATTERN.test(serverId)) {
        return new Response("Invalid v2 serverId parameter", { status: 400 });
      }

      const source = request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
      let admission: { success: boolean };
      try {
        admission = await env.RELAY_RATE_LIMITER.limit({ key: `${role}:${source}` });
      } catch {
        return new Response("Relay admission unavailable", { status: 503 });
      }
      if (!admission.success) {
        return new Response("Relay connection rate limit exceeded", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }

      // Route to a version-isolated Durable Object instance.
      const id = env.RELAY.idFromName(`relay-v${version}:${serverId}`);
      const stub = env.RELAY.get(id);

      const normalizedUrl = new URL(request.url);
      normalizedUrl.searchParams.set("v", version);
      const normalizedRequest = new Request(normalizedUrl.toString(), request);
      return stub.fetch(normalizedRequest);
    }

    return new Response("Not found", { status: 404 });
  },
};
