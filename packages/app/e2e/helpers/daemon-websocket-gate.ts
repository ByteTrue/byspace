import type { Page, WebSocketRoute } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

export interface DirectoryBootstrapCounts {
  agents: number;
  workspaces: number;
}

export interface DirectoryRequestStartCounts {
  subscribed: DirectoryBootstrapCounts;
  unsubscribed: DirectoryBootstrapCounts;
  total: DirectoryBootstrapCounts;
}

interface ClientRequest {
  type?: unknown;
  requestId?: unknown;
  subscribe?: unknown;
  page?: { cursor?: unknown };
  payload?: { requestId?: unknown };
}

function readSessionMessage(message: string | Buffer): ClientRequest | null {
  if (typeof message !== "string") return null;
  try {
    const envelope = JSON.parse(message) as {
      type?: unknown;
      message?: ClientRequest;
    };
    return envelope.type === "session" ? (envelope.message ?? null) : envelope;
  } catch {
    return null;
  }
}

function getRequestId(message: ClientRequest | null): string | null {
  const requestId = message?.requestId ?? message?.payload?.requestId;
  return typeof requestId === "string" ? requestId : null;
}

function directoryForRequest(request: ClientRequest): keyof DirectoryBootstrapCounts | null {
  if (request.page?.cursor) return null;
  if (request.type === "fetch_agents_request") return "agents";
  if (request.type === "fetch_workspaces_request") return "workspaces";
  return null;
}

export async function installDaemonWebSocketGate(page: Page) {
  let acceptingConnections = true;
  const activeSockets = new Set<WebSocketRoute>();
  const directoryStarts: DirectoryRequestStartCounts = {
    subscribed: { agents: 0, workspaces: 0 },
    unsubscribed: { agents: 0, workspaces: 0 },
    total: { agents: 0, workspaces: 0 },
  };
  const clientRequestCounts = new Map<string, number>();
  const serverMessageCounts = new Map<string, number>();
  const blockedServerMessageTypes = new Set<string>();
  const responseTypeForNextClientRequest = new Map<string, string>();
  const heldResponseRequestIds = new Map<string, Set<string>>();
  const heldServerMessages = new Map<
    string,
    Array<{ socket: WebSocketRoute; message: string | Buffer }>
  >();

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    if (!acceptingConnections) {
      void ws.close({ code: 1008, reason: "Blocked by reconnect test." });
      return;
    }

    activeSockets.add(ws);
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      if (!acceptingConnections) return;
      const request = readSessionMessage(message);
      if (typeof request?.type === "string") {
        clientRequestCounts.set(request.type, (clientRequestCounts.get(request.type) ?? 0) + 1);
        const responseType = responseTypeForNextClientRequest.get(request.type);
        const requestId = getRequestId(request);
        if (responseType && requestId) {
          responseTypeForNextClientRequest.delete(request.type);
          const requestIds = heldResponseRequestIds.get(responseType) ?? new Set<string>();
          requestIds.add(requestId);
          heldResponseRequestIds.set(responseType, requestIds);
        }
        const directory = directoryForRequest(request);
        if (directory) {
          const subscription = request.subscribe === undefined ? "unsubscribed" : "subscribed";
          directoryStarts[subscription][directory] += 1;
          directoryStarts.total[directory] += 1;
        }
      }
      try {
        server.send(message);
      } catch {
        activeSockets.delete(ws);
      }
    });

    server.onMessage((message) => {
      if (!acceptingConnections) return;
      const response = readSessionMessage(message);
      if (typeof response?.type === "string") {
        serverMessageCounts.set(response.type, (serverMessageCounts.get(response.type) ?? 0) + 1);
        const requestId = getRequestId(response);
        const heldRequestIds = heldResponseRequestIds.get(response.type);
        if (requestId && heldRequestIds?.delete(requestId)) {
          if (heldRequestIds.size === 0) heldResponseRequestIds.delete(response.type);
          const held = heldServerMessages.get(response.type) ?? [];
          held.push({ socket: ws, message });
          heldServerMessages.set(response.type, held);
          return;
        }
        if (blockedServerMessageTypes.has(response.type)) return;
      }
      try {
        ws.send(message);
      } catch {
        activeSockets.delete(ws);
      }
    });
  });

  return {
    async drop(): Promise<void> {
      acceptingConnections = false;
      const sockets = Array.from(activeSockets);
      activeSockets.clear();
      await Promise.all(
        sockets.map((ws) =>
          ws.close({ code: 1008, reason: "Dropped by reconnect test." }).catch(() => undefined),
        ),
      );
    },
    restore(): void {
      acceptingConnections = true;
    },
    getDirectoryRequestStartCounts(): DirectoryRequestStartCounts {
      return {
        subscribed: { ...directoryStarts.subscribed },
        unsubscribed: { ...directoryStarts.unsubscribed },
        total: { ...directoryStarts.total },
      };
    },
    getClientRequestCount(type: string): number {
      return clientRequestCounts.get(type) ?? 0;
    },
    getServerMessageCount(type: string): number {
      return serverMessageCounts.get(type) ?? 0;
    },
    blockServerMessageType(type: string): void {
      blockedServerMessageTypes.add(type);
    },
    holdResponseForNextClientRequest(requestType: string, responseType: string): void {
      responseTypeForNextClientRequest.set(requestType, responseType);
    },
    releaseHeldServerMessages(type: string): void {
      const held = heldServerMessages.get(type) ?? [];
      heldServerMessages.delete(type);
      for (const { socket, message } of held) {
        try {
          socket.send(message);
        } catch {
          activeSockets.delete(socket);
        }
      }
    },
  };
}
