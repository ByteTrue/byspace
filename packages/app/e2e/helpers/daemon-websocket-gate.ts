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
  direction?: unknown;
  subscribe?: unknown;
  page?: { cursor?: unknown };
  payload?: {
    requestId?: unknown;
    direction?: unknown;
    agentId?: unknown;
    event?: { type?: unknown; item?: { type?: unknown } };
  };
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

function readAgentStreamItemType(message: ClientRequest | null): string | null {
  const event = message?.type === "agent_stream" ? message.payload?.event : undefined;
  return event?.type === "timeline" && typeof event.item?.type === "string"
    ? event.item.type
    : null;
}

const DUPLICATE_TIMELINE_RESPONSE_WINDOW_MS = 100;

function recordTimelineResponse(
  response: ClientRequest,
  message: string | Buffer,
  counts: Map<string, number>,
  seenResponses: Map<string, { at: number; message: string }>,
): void {
  if (response.type !== "fetch_agent_timeline_response") return;
  const requestId = getRequestId(response);
  const direction = response.payload?.direction;
  const agentId = response.payload?.agentId;
  if (typeof requestId !== "string" || typeof direction !== "string") return;

  const key = `${typeof agentId === "string" ? agentId : "unknown"}:${requestId}:${direction}`;
  const serialized = typeof message === "string" ? message : message.toString("base64");
  const now = Date.now();
  const seen = seenResponses.get(key);
  // Reconnects can briefly route the same daemon response through overlapping sockets.
  if (
    !seen ||
    seen.message !== serialized ||
    now - seen.at > DUPLICATE_TIMELINE_RESPONSE_WINDOW_MS
  ) {
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
  }
  seenResponses.set(key, { at: now, message: serialized });
}

export async function installDaemonWebSocketGate(page: Page) {
  let acceptingConnections = true;
  let suppressAgentStream = false;
  let heldClientRequestType: string | null = null;
  let heldClientRequest: { server: WebSocketRoute; message: string | Buffer } | null = null;
  let resolveHeldClientRequest: (() => void) | null = null;
  const activeSockets = new Set<WebSocketRoute>();
  const directoryStarts: DirectoryRequestStartCounts = {
    subscribed: { agents: 0, workspaces: 0 },
    unsubscribed: { agents: 0, workspaces: 0 },
    total: { agents: 0, workspaces: 0 },
  };
  const clientRequestCounts = new Map<string, number>();
  const serverMessageCounts = new Map<string, number>();
  const timelineRequestCounts = new Map<string, number>();
  const seenTimelineResponses = new Map<string, { at: number; message: string }>();
  const agentStreamItemCounts = new Map<string, number>();
  const agentStreamItemWaiters = new Set<() => void>();
  const blockedServerMessageTypes = new Set<string>();
  const pendingServerMessageHolds = new Set<string>();
  const heldServerMessageWaiters = new Set<() => void>();
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
    let server: WebSocketRoute;
    ws.onMessage((message) => {
      if (!acceptingConnections) return;
      const request = readSessionMessage(message);
      if (request?.type === heldClientRequestType) {
        heldClientRequest = { server, message };
        resolveHeldClientRequest?.();
        resolveHeldClientRequest = null;
        return;
      }
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
    server = ws.connectToServer();

    server.onMessage((message) => {
      if (!acceptingConnections) return;
      const response = readSessionMessage(message);
      if (typeof response?.type === "string") {
        serverMessageCounts.set(response.type, (serverMessageCounts.get(response.type) ?? 0) + 1);
        const requestId = getRequestId(response);
        recordTimelineResponse(response, message, timelineRequestCounts, seenTimelineResponses);
        const itemType = readAgentStreamItemType(response);
        if (itemType) {
          agentStreamItemCounts.set(itemType, (agentStreamItemCounts.get(itemType) ?? 0) + 1);
          for (const waiter of agentStreamItemWaiters) waiter();
          agentStreamItemWaiters.clear();
        }
        if (suppressAgentStream && response.type === "agent_stream") return;
        if (pendingServerMessageHolds.delete(response.type)) {
          const held = heldServerMessages.get(response.type) ?? [];
          held.push({ socket: ws, message });
          heldServerMessages.set(response.type, held);
          for (const waiter of heldServerMessageWaiters) waiter();
          heldServerMessageWaiters.clear();
          return;
        }
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
    getTimelineRequestCount(direction: "tail" | "before" | "after"): number {
      return timelineRequestCounts.get(direction) ?? 0;
    },
    getAgentStreamItemCount(type: string): number {
      return agentStreamItemCounts.get(type) ?? 0;
    },
    setAgentStreamSuppressed(suppressed: boolean): void {
      suppressAgentStream = suppressed;
    },
    async waitForAgentStreamItem(type: string, count: number): Promise<void> {
      while ((agentStreamItemCounts.get(type) ?? 0) < count) {
        await new Promise<void>((resolve) => agentStreamItemWaiters.add(resolve));
      }
    },
    blockServerMessageType(type: string): void {
      blockedServerMessageTypes.add(type);
    },
    holdNextServerMessage(type: string): void {
      pendingServerMessageHolds.add(type);
    },
    async waitForHeldServerMessage(type?: string): Promise<void> {
      const hasMatchingMessage = () =>
        type === undefined
          ? Array.from(heldServerMessages.values()).some((messages) => messages.length > 0)
          : (heldServerMessages.get(type)?.length ?? 0) > 0;
      while (!hasMatchingMessage()) {
        await new Promise<void>((resolve) => heldServerMessageWaiters.add(resolve));
      }
    },
    releaseHeldServerMessage(type?: string): void {
      const resolvedType =
        type ??
        Array.from(heldServerMessages.entries()).find(([, messages]) => messages.length > 0)?.[0];
      if (!resolvedType) throw new Error("No held server message to release");
      const held = heldServerMessages.get(resolvedType) ?? [];
      const next = held.shift();
      if (!next) throw new Error("No held server message to release");
      if (held.length === 0) heldServerMessages.delete(resolvedType);
      try {
        next.socket.send(next.message);
      } catch {
        activeSockets.delete(next.socket);
      }
    },
    holdNextClientRequest(type: string): void {
      heldClientRequestType = type;
      heldClientRequest = null;
    },
    waitForHeldClientRequest(): Promise<void> {
      if (heldClientRequest) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveHeldClientRequest = resolve;
      });
    },
    releaseHeldClientRequest(): void {
      if (!heldClientRequest) throw new Error("No held client request to release");
      heldClientRequest.server.send(heldClientRequest.message);
      heldClientRequest = null;
      heldClientRequestType = null;
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
