/**
 * Node adapter for the self-hosted BySpace relay.
 *
 * Wire-compatible with the Cloudflare Worker deployment (see
 * `cloudflare-adapter.ts`). Serves:
 * - GET /health -> { "status": "ok" }
 * - GET /ws?serverId&role&v[&connectionId] -> WebSocket upgrade
 *
 * Sessions (one per serverId per protocol version) live in memory. Run one
 * replica per endpoint; the relay is a single-process service.
 */

import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CURRENT_RELAY_VERSION,
  LEGACY_RELAY_VERSION,
  RelaySession,
  resolveRelayVersion,
  type RelayProtocolVersion,
} from "./relay-session.js";
import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

interface AttachArgs {
  serverId: string;
  role: ConnectionRole;
  version: RelayProtocolVersion;
  connectionId: string;
}

export interface NodeRelayServerOptions {
  port?: number;
  host?: string;
  onLog?: (line: string) => void;
}

export interface NodeRelayServer {
  server: http.Server;
  close(): Promise<void>;
}

export function createNodeRelayServer(options: NodeRelayServerOptions = {}): NodeRelayServer {
  const log = options.onLog ?? (() => {});

  // relay-v{version}:{serverId} -> session, mirroring the DO naming scheme.
  const sessions = new Map<string, RelaySession<WebSocket>>();
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const serverId = url.searchParams.get("serverId");
    const roleRaw = url.searchParams.get("role");
    const connectionIdRaw = url.searchParams.get("connectionId");
    const connectionId = typeof connectionIdRaw === "string" ? connectionIdRaw.trim() : "";
    const version = resolveRelayVersion(url.searchParams.get("v"));

    if (roleRaw !== "server" && roleRaw !== "client") {
      rejectUpgrade(socket, "Missing or invalid role parameter");
      return;
    }
    if (!serverId) {
      rejectUpgrade(socket, "Missing serverId parameter");
      return;
    }
    if (!version) {
      rejectUpgrade(socket, "Invalid v parameter (expected 1 or 2)");
      return;
    }

    const sessionKey = `relay-v${version}:${serverId}`;
    const session = acquireSession(sessionKey);

    wss.handleUpgrade(req, socket, head, (ws) => {
      attach(session, ws, { serverId, role: roleRaw, version, connectionId });
    });
  });

  function acquireSession(key: string): RelaySession<WebSocket> {
    let session = sessions.get(key);
    if (!session) {
      session = new RelaySession<WebSocket>();
      sessions.set(key, session);
    }
    return session;
  }

  function attach(session: RelaySession<WebSocket>, ws: WebSocket, args: AttachArgs): void {
    if (args.version === LEGACY_RELAY_VERSION) {
      attachV1(session, ws, args);
    } else {
      attachV2(session, ws, args);
    }
  }

  function attachV1(session: RelaySession<WebSocket>, ws: WebSocket, args: AttachArgs): void {
    const role = args.role;
    // Close any existing socket with the same role.
    session.closeTagged(role, 1008, "Replaced by new connection");

    const attachment: RelaySessionAttachment = {
      serverId: args.serverId,
      role,
      version: LEGACY_RELAY_VERSION,
      connectionId: null,
      createdAt: Date.now(),
    };
    session.add(ws, [role], attachment);
    log(`[relay] v1:${role} connected to session ${args.serverId}`);

    ws.on("message", (message, isBinary) => {
      const targetRole: ConnectionRole = role === "server" ? "client" : "server";
      const payload = normalizeIncoming(message, isBinary);
      for (const target of session.byRole(targetRole)) {
        try {
          target.send(payload);
        } catch (error) {
          log(`[relay] Failed to forward to ${targetRole}: ${String(error)}`);
        }
      }
    });

    ws.on("close", () => {
      session.remove(ws);
    });
    ws.on("error", () => {
      session.remove(ws);
    });
  }

  function attachV2(session: RelaySession<WebSocket>, ws: WebSocket, args: AttachArgs): void {
    const role = args.role;
    // If a client didn't provide a connectionId, the relay assigns one for routing.
    const resolvedConnectionId =
      role === "client" && !args.connectionId ? `conn_${randomId16()}` : args.connectionId;

    const isServerControl = role === "server" && !resolvedConnectionId;
    const isServerData = role === "server" && !!resolvedConnectionId;

    // Close any existing server-side connection with the same identity.
    // - server-control: single per serverId
    // - server-data: single per connectionId
    // - client: many sockets per connectionId are allowed
    if (isServerControl) {
      session.closeTagged("server-control", 1008, "Replaced by new connection");
    } else if (isServerData) {
      session.closeTagged(`server:${resolvedConnectionId}`, 1008, "Replaced by new connection");
    }

    const tags = v2Tags({
      role,
      isServerControl,
      isServerData,
      connectionId: resolvedConnectionId,
    });
    const attachment: RelaySessionAttachment = {
      serverId: args.serverId,
      role,
      version: CURRENT_RELAY_VERSION,
      connectionId: resolvedConnectionId || null,
      createdAt: Date.now(),
    };
    session.add(ws, tags, attachment);

    let roleSuffix = "";
    if (isServerControl) {
      roleSuffix = "(control)";
    } else if (isServerData) {
      roleSuffix = `(data:${resolvedConnectionId})`;
    } else if (role === "client") {
      roleSuffix = `(${resolvedConnectionId})`;
    }
    log(`[relay] v2:${role}${roleSuffix} connected to session ${args.serverId}`);

    if (role === "client") {
      session.notifyControls({ type: "connected", connectionId: resolvedConnectionId });
      session.nudgeOrResetControlForConnection(resolvedConnectionId);
    }

    if (isServerControl) {
      // Send current connection list so the daemon can attach existing connections.
      try {
        ws.send(
          JSON.stringify({ type: "sync", connectionIds: session.listConnectedConnectionIds() }),
        );
      } catch {
        // ignore
      }
    }

    if (isServerData && resolvedConnectionId) {
      session.flushFrames(resolvedConnectionId, ws);
    }

    ws.on("message", (message, isBinary) => {
      const roleFromAttachment = attachment.role;
      const cid = attachment.connectionId;
      const payload = normalizeIncoming(message, isBinary);

      if (!cid) {
        // Control channel: support simple app-level keepalive.
        if (typeof payload === "string") {
          session.handleControlKeepalive(ws, payload);
        }
        return;
      }

      if (roleFromAttachment === "client") {
        const servers = session.get(`server:${cid}`);
        if (servers.length === 0) {
          session.bufferFrame(cid, payload);
          return;
        }
        for (const target of servers) {
          try {
            target.send(payload);
          } catch (error) {
            log(`[relay] Failed to forward client->server(${cid}): ${String(error)}`);
          }
        }
        return;
      }

      // server data socket -> client
      const targets = session.get(`client:${cid}`);
      for (const target of targets) {
        try {
          target.send(payload);
        } catch (error) {
          log(`[relay] Failed to forward server->client(${cid}): ${String(error)}`);
        }
      }
    });

    ws.on("close", () => {
      session.remove(ws);
      handleV2Close(session, attachment, ws);
    });
    ws.on("error", () => {
      session.remove(ws);
    });
  }

  function handleV2Close(
    session: RelaySession<WebSocket>,
    attachment: RelaySessionAttachment,
    closedWs: WebSocket,
  ): void {
    const role = attachment.role;
    const connectionId = attachment.connectionId;
    if (!connectionId) return;

    if (role === "client") {
      const remainingClientSockets = session
        .get(`client:${connectionId}`)
        .some((socket) => socket !== closedWs);
      if (remainingClientSockets) return;

      session.dropBufferedFrames(connectionId);
      // Last socket for this session closed: clean up matching server-data socket.
      for (const serverWs of session.get(`server:${connectionId}`)) {
        try {
          serverWs.close(1001, "Client disconnected");
        } catch {
          // ignore
        }
      }
      session.notifyControls({ type: "disconnected", connectionId });
      return;
    }

    if (role === "server") {
      // Force the client to reconnect and re-handshake when the daemon side drops.
      for (const clientWs of session.get(`client:${connectionId}`)) {
        try {
          clientWs.close(1012, "Server disconnected");
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Terminate live sockets so server.close() is not blocked by them.
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close(() => {});
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function v2Tags(args: {
  role: ConnectionRole;
  isServerControl: boolean;
  isServerData: boolean;
  connectionId: string;
}): string[] {
  const tags: string[] = [];
  if (args.role === "client") {
    tags.push("client", `client:${args.connectionId}`);
  } else if (args.isServerControl) {
    tags.push("server-control");
  } else {
    tags.push("server", `server:${args.connectionId}`);
  }
  return tags;
}

function rejectUpgrade(socket: import("node:stream").Duplex, reason: string): void {
  socket.write(`HTTP/1.1 400 ${reason}\r\n\r\n`);
  socket.destroy();
}

function randomId16(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * `ws` hands over every frame as a Buffer and reports text-vs-binary separately,
 * while the Cloudflare runtime hands text frames over as strings. Preserve that
 * distinction: the daemon rejects a hello that arrives as a binary frame.
 */
function normalizeIncoming(
  message: WebSocket.RawData,
  isBinary: boolean,
): string | ArrayBufferLike {
  if (typeof message === "string") return message;
  if (message instanceof ArrayBuffer) {
    return isBinary ? message : Buffer.from(message).toString("utf8");
  }
  const buffer = Array.isArray(message) ? Buffer.concat(message) : (message as Buffer);
  return isBinary ? toArrayBuffer(buffer) : buffer.toString("utf8");
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}
