import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

type WebSocketMessage = string | Buffer;

interface CreatedAgentTimelineGate {
  release(): void;
  waitForCreatedAgent(): Promise<string>;
  waitForDelayedResponse(): Promise<void>;
  waitForForwardedResponse(): Promise<void>;
}

export interface AgentTimelineResponseGate {
  release(): void;
  waitForDelayedResponse(): Promise<void>;
}

export interface TimelineRequestTracker {
  nextRequest(): Promise<{
    direction: string | null;
    cursor: { epoch: string; seq: number } | null;
  }>;
  requests(): Array<{
    direction: string | null;
    cursor: { epoch: string; seq: number } | null;
  }>;
  waitForResponse(): Promise<void>;
}

export async function trackAgentTimelineRequests(
  page: Page,
  agentId: string,
): Promise<TimelineRequestTracker> {
  type Request = ReturnType<TimelineRequestTracker["requests"]>[number];
  const seen: Request[] = [];
  const waiters: Array<(request: Request) => void> = [];
  let responseSeen = false;
  let resolveResponse: (() => void) | null = null;
  const response = new Promise<void>((resolve) => {
    resolveResponse = resolve;
  });
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (
        sessionMessage?.type === "fetch_agent_timeline_request" &&
        sessionMessage.agentId === agentId
      ) {
        const rawCursor = sessionMessage.cursor;
        const cursor =
          rawCursor &&
          typeof rawCursor === "object" &&
          typeof (rawCursor as { epoch?: unknown }).epoch === "string" &&
          typeof (rawCursor as { seq?: unknown }).seq === "number"
            ? {
                epoch: (rawCursor as { epoch: string }).epoch,
                seq: (rawCursor as { seq: number }).seq,
              }
            : null;
        const request = {
          direction: typeof sessionMessage.direction === "string" ? sessionMessage.direction : null,
          cursor,
        };
        seen.push(request);
        waiters.shift()?.(request);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      const payload = sessionMessage ? getPayload(sessionMessage) : null;
      if (
        sessionMessage?.type === "fetch_agent_timeline_response" &&
        payload?.agentId === agentId
      ) {
        responseSeen = true;
        resolveResponse?.();
      }
      ws.send(message);
    });
  });
  return {
    nextRequest() {
      const request = seen[0];
      if (request) return Promise.resolve(request);
      return new Promise((resolve) => waiters.push(resolve));
    },
    requests: () => [...seen],
    waitForResponse: () => (responseSeen ? Promise.resolve() : response),
  };
}

function parseWebSocketJson(message: WebSocketMessage): unknown {
  const rawMessage = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseWebSocketJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || !maybeEnvelope.message) {
    return null;
  }
  if (typeof maybeEnvelope.message !== "object") {
    return null;
  }
  return maybeEnvelope.message as Record<string, unknown>;
}

function getPayload(message: Record<string, unknown>): Record<string, unknown> | null {
  return message.payload && typeof message.payload === "object"
    ? (message.payload as Record<string, unknown>)
    : null;
}

export async function delayCreatedAgentInitialTailResponse(
  page: Page,
): Promise<CreatedAgentTimelineGate> {
  let createdAgentId: string | null = null;
  let releaseRequested = false;
  let delayedResponseSeen = false;
  const delayedForwards: Array<() => void> = [];
  let resolveCreatedAgent: ((agentId: string) => void) | null = null;
  let resolveDelayedResponse: (() => void) | null = null;
  let resolveForwardedResponse: (() => void) | null = null;
  const createdAgentSeen = new Promise<string>((resolve) => {
    resolveCreatedAgent = resolve;
  });
  const delayedResponse = new Promise<void>((resolve) => {
    resolveDelayedResponse = resolve;
  });
  const forwardedResponse = new Promise<void>((resolve) => {
    resolveForwardedResponse = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    const forwardToClient = (message: WebSocketMessage) => {
      ws.send(message);
      resolveForwardedResponse?.();
    };

    ws.onMessage((message) => {
      server.send(message);
    });

    server.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      const payload = sessionMessage ? getPayload(sessionMessage) : null;
      if (sessionMessage?.type === "status" && payload?.status === "agent_created") {
        const agentId = payload.agentId;
        if (typeof agentId === "string") {
          createdAgentId = agentId;
          resolveCreatedAgent?.(agentId);
        }
      }

      if (sessionMessage?.type === "fetch_agent_timeline_response") {
        const agentId = payload?.agentId;
        const direction = payload?.direction;
        if (
          !delayedResponseSeen &&
          typeof agentId === "string" &&
          agentId === createdAgentId &&
          direction === "tail"
        ) {
          delayedResponseSeen = true;
          resolveDelayedResponse?.();
          if (releaseRequested) {
            forwardToClient(message);
            return;
          }
          delayedForwards.push(() => forwardToClient(message));
          return;
        }
      }

      ws.send(message);
    });
  });

  return {
    release() {
      releaseRequested = true;
      for (const forward of delayedForwards.splice(0)) {
        forward();
      }
    },
    waitForCreatedAgent: () => createdAgentSeen,
    waitForDelayedResponse: () => delayedResponse,
    waitForForwardedResponse: () => forwardedResponse,
  };
}

export async function delayAgentOlderTimelineResponse(
  page: Page,
  agentId: string,
): Promise<AgentTimelineResponseGate> {
  let releaseRequested = false;
  let delayedResponseSeen = false;
  const delayedForwards: Array<() => void> = [];
  let resolveDelayedResponse: (() => void) | null = null;
  const delayedResponse = new Promise<void>((resolve) => {
    resolveDelayedResponse = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      const payload = sessionMessage ? getPayload(sessionMessage) : null;
      if (
        !delayedResponseSeen &&
        sessionMessage?.type === "fetch_agent_timeline_response" &&
        payload?.agentId === agentId &&
        payload.direction === "before"
      ) {
        delayedResponseSeen = true;
        resolveDelayedResponse?.();
        if (releaseRequested) {
          ws.send(message);
          return;
        }
        delayedForwards.push(() => ws.send(message));
        return;
      }
      ws.send(message);
    });
  });

  return {
    release() {
      releaseRequested = true;
      for (const forward of delayedForwards.splice(0)) {
        forward();
      }
    },
    waitForDelayedResponse: () => delayedResponse,
  };
}
