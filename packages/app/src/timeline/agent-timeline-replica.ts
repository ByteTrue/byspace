import type { SessionOutboundMessage } from "@bytetrue/byspace-protocol/messages";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import {
  getInitDeferred,
  getInitKey,
  rejectInitDeferred,
  resolveInitDeferred,
} from "@/utils/agent-initialization";
import {
  createSessionAgentStreamReducerQueue,
  processTimelineResponse,
  type AgentStreamReducerQueue,
  type ProcessTimelineResponseOutput,
} from "./session-stream-reducers";
import { isTimelineCatchUpComplete } from "./timeline-sync-plan";

export type AgentTimelineResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agent_timeline_response" }
>["payload"];

export type AgentStreamPayload = Extract<
  SessionOutboundMessage,
  { type: "agent_stream" }
>["payload"];

interface AgentTimelineReplicaOptions {
  serverId: string;
  recoverGap(agentId: string, cursor: { epoch: string; endSeq: number }): void;
  drainQueuedAgentMessage(agentId: string): void;
}

function clearInitializing(serverId: string, agentId: string): void {
  useSessionStore.getState().setInitializingAgents(serverId, (prev) => {
    if (prev.get(agentId) !== true) return prev;
    const next = new Map(prev);
    next.set(agentId, false);
    return next;
  });
}

function applyStreamPatches(input: {
  serverId: string;
  agentId: string;
  result: ProcessTimelineResponseOutput;
  currentTail: StreamItem[];
  currentHead: StreamItem[];
}): void {
  const { serverId, agentId, result, currentTail, currentHead } = input;
  const store = useSessionStore.getState();
  if (result.tail !== currentTail) {
    store.setAgentStreamTail(serverId, (prev) => {
      const next = new Map(prev);
      next.set(agentId, result.tail);
      return next;
    });
  }
  if (result.head !== currentHead) {
    if (result.head.length === 0) {
      store.clearAgentStreamHead(serverId, agentId);
    } else {
      store.setAgentStreamHead(serverId, (prev) => {
        const next = new Map(prev);
        next.set(agentId, result.head);
        return next;
      });
    }
  }
  if (!result.cursorChanged) return;
  store.setAgentTimelineCursor(serverId, (prev) => {
    const current = prev.get(agentId);
    if (!result.cursor) {
      if (!current) return prev;
      const next = new Map(prev);
      next.delete(agentId);
      return next;
    }
    if (
      current?.epoch === result.cursor.epoch &&
      current.startSeq === result.cursor.startSeq &&
      current.endSeq === result.cursor.endSeq
    ) {
      return prev;
    }
    const next = new Map(prev);
    next.set(agentId, result.cursor);
    return next;
  });
}

export class AgentTimelineReplica {
  private readonly queue: AgentStreamReducerQueue;

  constructor(private readonly options: AgentTimelineReplicaOptions) {
    const store = useSessionStore.getState();
    this.queue = createSessionAgentStreamReducerQueue({
      serverId: options.serverId,
      setAgentStreamState: store.setAgentStreamState,
      setAgentTimelineCursor: store.setAgentTimelineCursor,
      setAgents: store.setAgents,
      recoverTimelineGap: options.recoverGap,
    });
  }

  enqueueLive(payload: AgentStreamPayload): void {
    this.queue.enqueue(payload.agentId, {
      event: payload.event,
      seq: payload.seq,
      epoch: payload.epoch,
      timestamp: new Date(payload.timestamp),
    });
  }

  flushLive(): void {
    this.queue.flush();
  }

  flushAgent(agentId: string): void {
    this.queue.flushAgent(agentId);
  }

  applyTimelineResponse(
    payload: AgentTimelineResponsePayload,
    maySettleInitialization: boolean,
    mayUpdatePagination: boolean,
  ): void {
    const { serverId } = this.options;
    const agentId = payload.agentId;

    const session = useSessionStore.getState().sessions[serverId];
    const initKey = getInitKey(serverId, agentId);
    const activeInitDeferred = maySettleInitialization ? getInitDeferred(initKey) : undefined;
    const isInitializing =
      maySettleInitialization && session?.initializingAgents.get(agentId) === true;
    const currentCursor = session?.agentTimelineCursor.get(agentId);
    const currentTail = session?.agentStreamTail.get(agentId) ?? [];
    const currentHead = session?.agentStreamHead.get(agentId) ?? [];
    const replace =
      payload.reset ||
      (payload.direction === "tail" &&
        ((isInitializing && Boolean(activeInitDeferred)) || !currentCursor));

    const result = processTimelineResponse({
      payload,
      currentTail,
      currentHead,
      currentCursor,
      isInitializing,
      hasActiveInitDeferred: Boolean(activeInitDeferred),
      initRequestDirection: activeInitDeferred?.requestDirection ?? "tail",
    });

    if (result.error) {
      if (result.clearInitializing) clearInitializing(serverId, agentId);
      if (result.initResolution === "reject") rejectInitDeferred(initKey, new Error(result.error));
      return;
    }

    applyStreamPatches({ serverId, agentId, result, currentTail, currentHead });
    this.updatePagination(agentId, payload, result, replace, mayUpdatePagination);
    this.finalizeAppliedPage(agentId, payload, result, initKey, maySettleInitialization);
  }

  private updatePagination(
    agentId: string,
    payload: AgentTimelineResponsePayload,
    result: ProcessTimelineResponseOutput,
    replace: boolean,
    mayUpdatePagination: boolean,
  ): void {
    if (
      !mayUpdatePagination ||
      (!replace &&
        (payload.direction !== "before" || (!result.cursorChanged && payload.entries.length > 0)))
    ) {
      return;
    }
    const { serverId } = this.options;
    useSessionStore.getState().setAgentTimelineHasOlder(serverId, (prev) => {
      if (prev.get(agentId) === payload.hasOlder) return prev;
      const next = new Map(prev);
      next.set(agentId, payload.hasOlder);
      return next;
    });
  }

  private finalizeAppliedPage(
    agentId: string,
    payload: AgentTimelineResponsePayload,
    result: ProcessTimelineResponseOutput,
    initKey: string,
    maySettleInitialization: boolean,
  ): void {
    const { serverId } = this.options;
    for (const effect of result.sideEffects) {
      if (effect.type === "catch_up") this.options.recoverGap(agentId, effect.cursor);
    }
    if (result.clearInitializing) clearInitializing(serverId, agentId);
    const catchUpComplete = isTimelineCatchUpComplete({
      direction: payload.direction,
      hasNewer: payload.hasNewer,
      error: payload.error,
    });
    const shouldCompleteForward =
      maySettleInitialization && catchUpComplete && this.isResponseCovered(agentId, payload);
    if (shouldCompleteForward) {
      const store = useSessionStore.getState();
      store.setAgentAuthoritativeHistoryApplied(serverId, agentId, true);
      useCreateFlowStore.getState().clearByAgent({ serverId, agentId });
      store.markAgentHistorySynchronized(serverId, agentId);
      const latestSession = useSessionStore.getState().sessions[serverId];
      const agent = latestSession?.agents.get(agentId) ?? latestSession?.agentDetails.get(agentId);
      if (agent && agent.status !== "running") this.options.drainQueuedAgentMessage(agentId);
    }
    if (result.initResolution === "resolve" || shouldCompleteForward) {
      resolveInitDeferred(initKey);
    }
  }

  private isResponseCovered(agentId: string, payload: AgentTimelineResponsePayload): boolean {
    if (!payload.endCursor) return payload.entries.length === 0 && !payload.hasNewer;
    const cursor = useSessionStore
      .getState()
      .sessions[this.options.serverId]?.agentTimelineCursor.get(agentId);
    return cursor?.epoch === payload.endCursor.epoch && cursor.endSeq >= payload.endCursor.seq;
  }

  dispose(): void {
    this.queue.dispose({ flush: true });
  }
}
