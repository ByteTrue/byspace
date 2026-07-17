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

export interface TimelineTrafficMeasurement {
  timelineFrames: number;
  timelineBytes: number;
  attentionFrames: number;
  attentionBytes: number;
  agentIds: string[];
}

interface ClientRequest {
  type?: unknown;
  subscribe?: unknown;
  page?: { cursor?: unknown };
  agentIds?: unknown;
  capabilities?: Record<string, unknown>;
}

function readClientRequest(message: string | Buffer): ClientRequest | null {
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

function directoryForRequest(request: ClientRequest): keyof DirectoryBootstrapCounts | null {
  if (request.page?.cursor) return null;
  if (request.type === "fetch_agents_request") return "agents";
  if (request.type === "fetch_workspaces_request") return "workspaces";
  return null;
}

type TimelineClientKind = "capable" | "legacy";

function createTimelineTrafficState() {
  return {
    timelineFrames: 0,
    timelineBytes: 0,
    attentionFrames: 0,
    attentionBytes: 0,
    agentIds: new Set<string>(),
  };
}

function recordTimelineTraffic(
  state: ReturnType<typeof createTimelineTrafficState>,
  message: string | Buffer,
): void {
  const serialized = typeof message === "string" ? message : message.toString("utf8");
  let envelope: { type?: unknown; message?: Record<string, unknown> };
  try {
    envelope = JSON.parse(serialized);
  } catch {
    return;
  }
  const sessionMessage = envelope.type === "session" ? envelope.message : undefined;
  const payload = sessionMessage?.payload as
    | { agentId?: unknown; event?: { type?: unknown } }
    | undefined;
  const agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
  if (!agentId) return;
  const bytes = Buffer.byteLength(serialized, "utf8");
  const isDedicatedAttention = sessionMessage?.type === "agent_attention_required";
  const isLegacyAttention =
    sessionMessage?.type === "agent_stream" && payload?.event?.type === "attention_required";
  if (isDedicatedAttention || isLegacyAttention) {
    state.attentionFrames += 1;
    state.attentionBytes += bytes;
    return;
  }
  if (sessionMessage?.type !== "agent_stream") return;
  state.timelineFrames += 1;
  state.timelineBytes += bytes;
  state.agentIds.add(agentId);
}

function snapshotTimelineTraffic(
  state: ReturnType<typeof createTimelineTrafficState>,
): TimelineTrafficMeasurement {
  return {
    timelineFrames: state.timelineFrames,
    timelineBytes: state.timelineBytes,
    attentionFrames: state.attentionFrames,
    attentionBytes: state.attentionBytes,
    agentIds: Array.from(state.agentIds).sort(),
  };
}

function resetTimelineTraffic(state: ReturnType<typeof createTimelineTrafficState>): void {
  state.timelineFrames = 0;
  state.timelineBytes = 0;
  state.attentionFrames = 0;
  state.attentionBytes = 0;
  state.agentIds.clear();
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
  const timelineTraffic = {
    capable: createTimelineTrafficState(),
    legacy: createTimelineTrafficState(),
  };
  let lastTimelineSubscriptionAgentIds: string[] = [];

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    if (!acceptingConnections) {
      void ws.close({ code: 1008, reason: "Blocked by reconnect test." });
      return;
    }

    activeSockets.add(ws);
    const server = ws.connectToServer();
    let timelineClientKind: TimelineClientKind | null = null;

    ws.onMessage((message) => {
      if (!acceptingConnections) return;
      const request = readClientRequest(message);
      if (request?.type === "hello") {
        timelineClientKind =
          request.capabilities?.selective_agent_timeline === true ? "capable" : "legacy";
      }
      if (
        request?.type === "agent.timeline.set_subscription.request" &&
        Array.isArray(request.agentIds)
      ) {
        lastTimelineSubscriptionAgentIds = request.agentIds
          .filter((agentId): agentId is string => typeof agentId === "string")
          .sort();
      }
      if (typeof request?.type === "string") {
        clientRequestCounts.set(request.type, (clientRequestCounts.get(request.type) ?? 0) + 1);
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
      if (timelineClientKind) recordTimelineTraffic(timelineTraffic[timelineClientKind], message);
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
    getLastTimelineSubscriptionAgentIds(): string[] {
      return [...lastTimelineSubscriptionAgentIds];
    },
    resetTimelineTraffic(): void {
      resetTimelineTraffic(timelineTraffic.capable);
      resetTimelineTraffic(timelineTraffic.legacy);
    },
    getTimelineTraffic(): Record<TimelineClientKind, TimelineTrafficMeasurement> {
      return {
        capable: snapshotTimelineTraffic(timelineTraffic.capable),
        legacy: snapshotTimelineTraffic(timelineTraffic.legacy),
      };
    },
  };
}
