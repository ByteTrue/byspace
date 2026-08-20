import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export interface StandaloneRelayServerOptions {
  host?: string;
  port?: number;
  maxSessions?: number;
  maxConnectionsPerSession?: number;
  maxSockets?: number;
  maxBufferedBytes?: number;
  maxTotalBufferedBytes?: number;
  pairingTimeoutMs?: number;
  accessToken?: string;
}

export interface StandaloneRelayServer {
  host: string;
  port: number;
  httpUrl: string;
  wsUrl: string;
  stop: () => Promise<void>;
}

interface PendingFrame {
  payload: string | Buffer;
  isBinary: boolean;
  byteLength: number;
}

interface RelayConnection {
  id: string;
  client: WebSocket;
  server: WebSocket | null;
  pendingFrames: PendingFrame[];
  pendingBytes: number;
  pairingTimeout: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

interface RelaySession {
  id: string;
  control: WebSocket | null;
  connections: Map<string, RelayConnection>;
}

interface UpgradeTarget {
  role: "client" | "server";
  serverId: string;
  connectionId: string;
}

const DEFAULT_MAX_SESSIONS = 1_000;
const DEFAULT_MAX_CONNECTIONS_PER_SESSION = 128;
const DEFAULT_MAX_SOCKETS = 4_096;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BUFFERED_BYTES = 64 * 1024 * 1024;
const DEFAULT_PAIRING_TIMEOUT_MS = 15_000;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_TRY_AGAIN_LATER = 1013;

function parsePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function rejectUpgrade(
  socket: { end: (data: string) => unknown },
  status: number,
  message: string,
): void {
  const body = `${message}\n`;
  const statusText =
    (
      { 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 503: "Unavailable" } as Record<
        number,
        string
      >
    )[status] ?? "Error";
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function parseRequestUrl(requestUrl: string | undefined): URL | null {
  try {
    return new URL(requestUrl ?? "/", "http://relay.local");
  } catch {
    return null;
  }
}

function parseUpgradeTarget(requestUrl: string | undefined): UpgradeTarget | { error: string } {
  const url = parseRequestUrl(requestUrl);
  if (!url) return { error: "Malformed request target" };
  if (url.pathname !== "/ws") return { error: "Not found" };
  if (url.searchParams.get("v") !== "2") {
    return { error: "Invalid v parameter (expected 2)" };
  }
  const role = url.searchParams.get("role");
  if (role !== "client" && role !== "server") {
    return { error: "Missing or invalid role parameter" };
  }
  const serverId = url.searchParams.get("serverId")?.trim() ?? "";
  if (!serverId || serverId.length > 128) {
    return { error: "Missing or invalid serverId parameter" };
  }
  const connectionId = url.searchParams.get("connectionId")?.trim() ?? "";
  if (connectionId.length > 128) {
    return { error: "Invalid connectionId parameter" };
  }
  return { role, serverId, connectionId };
}

function isAuthorized(header: string | undefined, accessToken: string | undefined): boolean {
  if (!accessToken) return true;
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${accessToken}`);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function normalizeFrame(data: RawData, isBinary: boolean): PendingFrame {
  if (!isBinary) {
    const payload = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Buffer.from(data as ArrayBuffer).toString("utf8");
    return { payload, isBinary: false, byteLength: Buffer.byteLength(payload) };
  }
  let payload: Buffer;
  if (Array.isArray(data)) {
    payload = Buffer.concat(data);
  } else if (Buffer.isBuffer(data)) {
    payload = data;
  } else {
    payload = Buffer.from(data);
  }
  return { payload, isBinary: true, byteLength: payload.byteLength };
}

function sendJson(socket: WebSocket | null, value: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(value));
  } catch {
    socket.close(1011, "Control send failed");
  }
}

export async function startStandaloneRelayServer(
  options: StandaloneRelayServerOptions = {},
): Promise<StandaloneRelayServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const accessToken = options.accessToken?.trim() || undefined;
  const maxSessions = parsePositiveInteger(
    options.maxSessions,
    DEFAULT_MAX_SESSIONS,
    "maxSessions",
  );
  const maxConnectionsPerSession = parsePositiveInteger(
    options.maxConnectionsPerSession,
    DEFAULT_MAX_CONNECTIONS_PER_SESSION,
    "maxConnectionsPerSession",
  );
  const maxSockets = parsePositiveInteger(options.maxSockets, DEFAULT_MAX_SOCKETS, "maxSockets");
  const maxBufferedBytes = parsePositiveInteger(
    options.maxBufferedBytes,
    DEFAULT_MAX_BUFFERED_BYTES,
    "maxBufferedBytes",
  );
  const maxTotalBufferedBytes = parsePositiveInteger(
    options.maxTotalBufferedBytes,
    DEFAULT_MAX_TOTAL_BUFFERED_BYTES,
    "maxTotalBufferedBytes",
  );
  const pairingTimeoutMs = parsePositiveInteger(
    options.pairingTimeoutMs,
    DEFAULT_PAIRING_TIMEOUT_MS,
    "pairingTimeoutMs",
  );

  const sessions = new Map<string, RelaySession>();
  const httpServer: HttpServer = createServer((request, response) => {
    const url = parseRequestUrl(request.url);
    if (!url) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Malformed request target");
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/ws" && url.searchParams.get("v") !== "2") {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid v parameter (expected 2)");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: maxBufferedBytes,
  });
  let stopping = false;
  let totalPendingBytes = 0;

  const getTotalSocketBufferedBytes = (): number => {
    let total = 0;
    for (const socket of webSocketServer.clients) total += socket.bufferedAmount;
    return total;
  };

  const maybeDeleteSession = (session: RelaySession): void => {
    if (!session.control && session.connections.size === 0) sessions.delete(session.id);
  };

  const notifyControl = (session: RelaySession, message: unknown): void => {
    sendJson(session.control, message);
  };

  const closeConnection = (
    session: RelaySession,
    connection: RelayConnection,
    code: number,
    reason: string,
    source?: WebSocket,
  ): void => {
    if (connection.closed) return;
    connection.closed = true;
    if (connection.pairingTimeout) clearTimeout(connection.pairingTimeout);
    connection.pairingTimeout = null;
    session.connections.delete(connection.id);
    totalPendingBytes = Math.max(0, totalPendingBytes - connection.pendingBytes);
    connection.pendingFrames.length = 0;
    connection.pendingBytes = 0;
    for (const socket of [connection.client, connection.server]) {
      if (!socket || socket === source || socket.readyState === WebSocket.CLOSED) continue;
      try {
        socket.close(code, reason);
      } catch {
        socket.terminate();
      }
    }
    notifyControl(session, { type: "disconnected", connectionId: connection.id });
    maybeDeleteSession(session);
  };

  const failBackpressure = (session: RelaySession, connection: RelayConnection): void => {
    closeConnection(
      session,
      connection,
      CLOSE_TRY_AGAIN_LATER,
      "Relay backpressure limit exceeded",
    );
  };

  const forwardFrame = (
    session: RelaySession,
    connection: RelayConnection,
    target: WebSocket,
    frame: PendingFrame,
  ): void => {
    if (
      target.readyState !== WebSocket.OPEN ||
      frame.byteLength > maxBufferedBytes ||
      target.bufferedAmount + frame.byteLength > maxBufferedBytes ||
      totalPendingBytes + getTotalSocketBufferedBytes() + frame.byteLength > maxTotalBufferedBytes
    ) {
      failBackpressure(session, connection);
      return;
    }
    target.send(frame.payload, { binary: frame.isBinary }, (error) => {
      if (error) closeConnection(session, connection, 1011, "Relay forwarding failed");
    });
  };

  const acceptControl = (session: RelaySession, socket: WebSocket): void => {
    if (session.control && session.control.readyState !== WebSocket.CLOSED) {
      socket.close(CLOSE_POLICY_VIOLATION, "Server control connection already exists");
      return;
    }
    session.control = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString("utf8")) as { type?: unknown };
        if (message.type === "ping") sendJson(socket, { type: "pong", ts: Date.now() });
      } catch {
        // Control messages are advisory; malformed input is ignored.
      }
    });
    socket.on("close", () => {
      if (session.control === socket) session.control = null;
      maybeDeleteSession(session);
    });
    sendJson(socket, { type: "sync", connectionIds: [...session.connections.keys()] });
  };

  const acceptClient = (session: RelaySession, socket: WebSocket, requestedId: string): void => {
    if (session.connections.size >= maxConnectionsPerSession) {
      socket.close(CLOSE_TRY_AGAIN_LATER, "Relay connection limit reached");
      return;
    }
    const connectionId = requestedId || `conn_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    if (session.connections.has(connectionId)) {
      socket.close(CLOSE_POLICY_VIOLATION, "Duplicate connectionId");
      return;
    }
    const connection: RelayConnection = {
      id: connectionId,
      client: socket,
      server: null,
      pendingFrames: [],
      pendingBytes: 0,
      pairingTimeout: null,
      closed: false,
    };
    connection.pairingTimeout = setTimeout(() => {
      closeConnection(session, connection, CLOSE_TRY_AGAIN_LATER, "Relay pairing timed out");
    }, pairingTimeoutMs);
    connection.pairingTimeout.unref?.();
    session.connections.set(connectionId, connection);

    socket.on("message", (data, isBinary) => {
      if (connection.closed) return;
      const frame = normalizeFrame(data, isBinary);
      if (connection.server) {
        forwardFrame(session, connection, connection.server, frame);
        return;
      }
      if (
        frame.byteLength > maxBufferedBytes ||
        connection.pendingBytes + frame.byteLength > maxBufferedBytes ||
        totalPendingBytes + frame.byteLength > maxTotalBufferedBytes
      ) {
        failBackpressure(session, connection);
        return;
      }
      connection.pendingFrames.push(frame);
      connection.pendingBytes += frame.byteLength;
      totalPendingBytes += frame.byteLength;
    });
    socket.on("close", () => {
      closeConnection(session, connection, 1001, "Client disconnected", socket);
    });
    socket.on("error", () => {
      closeConnection(session, connection, 1011, "Client socket failed", socket);
    });
    notifyControl(session, { type: "connected", connectionId });
  };

  const acceptServerData = (
    session: RelaySession,
    socket: WebSocket,
    connectionId: string,
  ): void => {
    const connection = session.connections.get(connectionId);
    if (!connection) {
      socket.close(CLOSE_POLICY_VIOLATION, "Unknown connectionId");
      return;
    }
    if (connection.server && connection.server.readyState !== WebSocket.CLOSED) {
      socket.close(CLOSE_POLICY_VIOLATION, "Server data connection already exists");
      return;
    }
    connection.server = socket;
    if (connection.pairingTimeout) clearTimeout(connection.pairingTimeout);
    connection.pairingTimeout = null;
    socket.on("message", (data, isBinary) => {
      if (connection.closed) return;
      forwardFrame(session, connection, connection.client, normalizeFrame(data, isBinary));
    });
    socket.on("close", () => {
      if (connection.server === socket) {
        closeConnection(session, connection, 1012, "Server disconnected", socket);
      }
    });
    socket.on("error", () => {
      if (connection.server === socket) {
        closeConnection(session, connection, 1011, "Server socket failed", socket);
      }
    });
    totalPendingBytes = Math.max(0, totalPendingBytes - connection.pendingBytes);
    connection.pendingBytes = 0;
    for (const frame of connection.pendingFrames) {
      if (connection.closed) break;
      forwardFrame(session, connection, socket, frame);
    }
    connection.pendingFrames.length = 0;
  };

  const acceptSocket = (socket: WebSocket, target: UpgradeTarget): void => {
    let session = sessions.get(target.serverId);
    const isControl = target.role === "server" && !target.connectionId;
    if (!session) {
      if (!isControl || sessions.size >= maxSessions) {
        socket.close(CLOSE_TRY_AGAIN_LATER, "Relay session unavailable");
        return;
      }
      session = { id: target.serverId, control: null, connections: new Map() };
      sessions.set(target.serverId, session);
    }
    if (isControl) {
      acceptControl(session, socket);
    } else if (target.role === "client") {
      if (!session.control || session.control.readyState !== WebSocket.OPEN) {
        socket.close(CLOSE_TRY_AGAIN_LATER, "Target daemon is unavailable");
        return;
      }
      acceptClient(session, socket, target.connectionId);
    } else {
      acceptServerData(session, socket, target.connectionId);
    }
  };

  httpServer.on("upgrade", (request, socket, head) => {
    if (stopping) {
      rejectUpgrade(socket, 404, "Relay is stopping");
      return;
    }
    if (!isAuthorized(request.headers.authorization, accessToken)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (webSocketServer.clients.size >= maxSockets) {
      rejectUpgrade(socket, 503, "Relay socket limit reached");
      return;
    }
    const target = parseUpgradeTarget(request.url);
    if ("error" in target) {
      rejectUpgrade(socket, target.error === "Not found" ? 404 : 400, target.error);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      acceptSocket(webSocket, target);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(requestedPort, host);
  });

  const address = httpServer.address() as AddressInfo;
  const urlHost = formatUrlHost(host);
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = new Promise<void>((resolve, reject) => {
      for (const session of sessions.values()) {
        for (const connection of session.connections.values()) {
          if (connection.pairingTimeout) clearTimeout(connection.pairingTimeout);
          connection.pairingTimeout = null;
          connection.closed = true;
        }
      }
      sessions.clear();
      for (const socket of webSocketServer.clients) socket.terminate();
      webSocketServer.close(() => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
    return stopPromise;
  };

  return {
    host,
    port: address.port,
    httpUrl: `http://${urlHost}:${address.port}`,
    wsUrl: `ws://${urlHost}:${address.port}`,
    stop,
  };
}
