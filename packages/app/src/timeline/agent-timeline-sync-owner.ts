import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { useSessionStore, type AgentTimelineCursorState } from "@/stores/session-store";
import {
  createInitDeferred,
  getInitDeferred,
  getInitKey,
  INIT_TIMEOUT_MS,
  rejectInitDeferred,
  refreshInitTimeout,
} from "@/utils/agent-initialization";
import {
  createViewedTimelineSync,
  type TimelineDeliveryMode,
  type ViewedTimelineSync,
  type ViewedTimelineUiBridge,
} from "./viewed-timeline-sync";
import {
  AgentTimelineReplica,
  type AgentTimelineResponsePayload,
  type AgentStreamPayload,
} from "./agent-timeline-replica";
import {
  planInitialAgentTimelineSync,
  planResumeTimelineSync,
  planTimelineCatchUpAfter,
  type ProjectedTimelineFetchPlan,
} from "./timeline-sync-plan";

export type AgentTimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;
export type AgentTimelineRequest = NonNullable<Parameters<DaemonClient["fetchAgentTimeline"]>[1]>;

interface AgentTimelineSyncOwnerOptions {
  serverId: string;
  requestPage(agentId: string, request: AgentTimelineRequest): Promise<AgentTimelinePage>;
  setSubscription(agentIds: string[]): Promise<void>;
  drainQueuedAgentMessage(agentId: string): void;
  reportError(error: unknown): void;
  schedule(task: () => void, delayMs: number): () => void;
}

interface InFlightRequest {
  promise: Promise<AgentTimelinePage>;
  serial: number;
}

interface RequestContext {
  connectionGeneration: number;
  epochVersionAtIssue: number;
  lane: "forward" | "older";
  requestSerial: number;
  forwardIntentSerial: number;
  cursor?: { epoch: string; seq: number };
}

class TimelineResponseSupersededError extends Error {}

let nextOwnerScope = 0;

function requestKey(agentId: string, lane: RequestContext["lane"], request: AgentTimelineRequest) {
  const { requestId: _requestId, ...semanticRequest } = request;
  return `${lane}:${agentId}:${JSON.stringify(semanticRequest)}`;
}

export class AgentTimelineSyncOwner {
  private readonly scope = `${++nextOwnerScope}`;
  private readonly viewed: ViewedTimelineSync;
  private readonly replica: AgentTimelineReplica;
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly latestForwardIntent = new Map<string, number>();
  private readonly viewedForwardIntents = new Map<
    string,
    { generation: number; intentSerial: number }
  >();
  private readonly epochVersions = new Map<string, number>();
  private readonly observedEpochs = new Map<string, string>();
  private readonly initializationAgentIds = new Set<string>();
  private requestSerial = 0;
  private forwardIntentSerial = 0;
  private connectionGeneration = 0;
  private connectionId: string | undefined;
  private connected = false;
  private disposed = false;

  constructor(private readonly options: AgentTimelineSyncOwnerOptions) {
    this.viewed = createViewedTimelineSync({
      initialDeliveryMode: "legacy",
      setSubscription: options.setSubscription,
      readCursor: (agentId) => this.readCursor(agentId),
      hasAuthoritativeHistory: (agentId) => this.hasAuthoritativeHistory(agentId),
      fetchPage: (agentId, request, fetchOptions) =>
        this.fetchTimeline(agentId, request, {
          force: fetchOptions.dedupe === false,
          lane: "forward",
          intentSerial: this.getViewedForwardIntent(agentId, fetchOptions.intentGeneration),
        }),
      reportError: options.reportError,
      schedule: options.schedule,
    });
    this.replica = new AgentTimelineReplica({
      serverId: options.serverId,
      recoverGap: (agentId, cursor) => this.viewed.recoverGap(agentId, cursor),
      drainQueuedAgentMessage: options.drainQueuedAgentMessage,
    });
  }

  get uiBridge(): ViewedTimelineUiBridge {
    return this.viewed;
  }

  setConnected(connected: boolean, connectionId?: string): void {
    const replaced =
      connected &&
      this.connected &&
      connectionId !== undefined &&
      connectionId !== this.connectionId;
    if (this.connected === connected && !replaced) return;
    if (replaced) this.viewed.setConnected(false);
    this.replica.flushLive();
    this.connected = connected;
    this.connectionId = connected ? connectionId : undefined;
    this.connectionGeneration += 1;
    this.inFlight.clear();
    this.latestForwardIntent.clear();
    this.viewedForwardIntents.clear();
    this.epochVersions.clear();
    this.observedEpochs.clear();
    this.viewed.setConnected(connected);
  }

  setDeliveryMode(mode: TimelineDeliveryMode): void {
    this.viewed.setDeliveryMode(mode);
  }

  setActive(active: boolean): void {
    this.viewed.setActive(active);
  }

  refreshVisibleTimelines(): void {
    this.viewed.refreshVisibleTimelines();
  }

  enqueueLive(payload: AgentStreamPayload): void {
    if (!this.connected || this.disposed) return;
    const cursor = this.readCursor(payload.agentId);
    if (
      payload.event.type === "timeline" &&
      payload.epoch &&
      (!cursor || cursor.epoch !== payload.epoch)
    ) {
      this.observedEpochs.set(payload.agentId, payload.epoch);
      this.epochVersions.set(payload.agentId, (this.epochVersions.get(payload.agentId) ?? 0) + 1);
    }
    this.replica.enqueueLive(payload);
  }

  ensureCurrent(agentId: string): Promise<void> {
    if (this.hasAuthoritativeHistory(agentId)) return Promise.resolve();
    const cursor = this.readCursor(agentId);
    const request = planInitialAgentTimelineSync({
      cursor,
      hasAuthoritativeHistory: false,
    });
    const initialization = this.beginInitialization(agentId, request.direction);
    const intentSerial = this.createForwardIntent();
    void this.fetchForwardUntilCurrent(agentId, request, false, intentSerial).catch(
      () => undefined,
    );
    return initialization;
  }

  refreshAgent(agentId: string): Promise<AgentTimelinePage> {
    return this.fetchForwardUntilCurrent(
      agentId,
      planResumeTimelineSync({ cursor: this.readCursor(agentId) }),
      true,
      this.createForwardIntent(),
    );
  }

  fetchTimeline(
    agentId: string,
    request: ProjectedTimelineFetchPlan,
    options: {
      force?: boolean;
      lane?: "forward" | "older";
      intentSerial?: number;
    } = {},
  ): Promise<AgentTimelinePage> {
    if (this.disposed || !this.connected) {
      return Promise.reject(new Error(`Timeline owner for ${this.options.serverId} is offline`));
    }
    const lane = options.lane ?? (request.direction === "before" ? "older" : "forward");
    if (
      lane === "forward" &&
      request.direction !== "before" &&
      !this.hasAuthoritativeHistory(agentId)
    ) {
      const initialization = this.beginInitialization(agentId, request.direction);
      void initialization.catch(() => undefined);
    }
    const key = requestKey(agentId, lane, request);
    if (!options.force) {
      const existing = this.inFlight.get(key);
      if (existing) return existing.promise;
    }

    const requestSerial = ++this.requestSerial;
    const forwardIntentSerial =
      lane === "forward" ? (options.intentSerial ?? this.createForwardIntent()) : 0;
    if (lane === "forward") {
      this.latestForwardIntent.set(
        agentId,
        Math.max(forwardIntentSerial, this.latestForwardIntent.get(agentId) ?? 0),
      );
    }
    const context: RequestContext = {
      connectionGeneration: this.connectionGeneration,
      epochVersionAtIssue: this.epochVersions.get(agentId) ?? 0,
      lane,
      requestSerial,
      forwardIntentSerial,
      ...("cursor" in request ? { cursor: request.cursor } : {}),
    };
    const wireRequest: AgentTimelineRequest = {
      ...request,
      requestId: `agent-timeline:${this.scope}:${requestSerial}`,
    };
    const promise = this.options
      .requestPage(agentId, wireRequest)
      .then((page) => {
        if (page.error) throw new Error(page.error);
        const applied = this.applyPage(agentId, page, context);
        if (!applied) {
          throw new TimelineResponseSupersededError(
            `Timeline response for ${agentId} was superseded before it could be applied`,
          );
        }
        return page;
      })
      .catch((error) => {
        if (
          !(error instanceof TimelineResponseSupersededError) &&
          this.isCurrent(context) &&
          this.isCurrentForward(agentId, context)
        ) {
          this.failInitialization(agentId, error);
        }
        throw error;
      });
    this.inFlight.set(key, { promise, serial: requestSerial });
    const clear = () => {
      if (this.inFlight.get(key)?.serial === requestSerial) this.inFlight.delete(key);
    };
    void promise.then(clear, clear);
    return promise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connected = false;
    this.connectionGeneration += 1;
    this.inFlight.clear();
    for (const agentId of this.initializationAgentIds) {
      const key = getInitKey(this.options.serverId, agentId);
      if (getInitDeferred(key)) {
        rejectInitDeferred(
          key,
          new Error(`Timeline owner for ${this.options.serverId} was disposed`),
        );
      }
    }
    this.initializationAgentIds.clear();
    this.viewed.dispose();
    this.replica.dispose();
  }

  private async fetchForwardUntilCurrent(
    agentId: string,
    initialRequest: Exclude<ProjectedTimelineFetchPlan, { direction: "before" }>,
    force: boolean,
    intentSerial: number,
  ): Promise<AgentTimelinePage> {
    let request = initialRequest;
    let forceRequest = force;
    while (true) {
      let page: AgentTimelinePage;
      try {
        page = await this.fetchTimeline(agentId, request, {
          force: forceRequest,
          lane: "forward",
          intentSerial,
        });
      } catch (error) {
        if (
          !(error instanceof TimelineResponseSupersededError) ||
          this.disposed ||
          !this.connected ||
          this.latestForwardIntent.get(agentId) !== intentSerial
        ) {
          throw error;
        }
        request = planResumeTimelineSync({ cursor: this.readCursor(agentId) });
        forceRequest = true;
        continue;
      }
      if (!page.hasNewer) return page;
      if (!page.endCursor) {
        throw new Error(`Timeline page for ${agentId} hasNewer without an end cursor`);
      }
      request = planTimelineCatchUpAfter(page.endCursor);
    }
  }

  private applyPage(agentId: string, page: AgentTimelinePage, context: RequestContext): boolean {
    if (!this.isCurrent(context)) return false;
    this.replica.flushAgent(agentId);
    const currentCursor = this.readCursor(agentId);
    const payload = this.resolvePagePayload(agentId, page, context, currentCursor);
    if (!payload) return false;

    const maySettleInitialization = this.isCurrentForward(agentId, context);
    const mayUpdatePagination =
      context.lane !== "older" || this.requestStillTargetsReplica(context, currentCursor);
    const epochBefore = currentCursor?.epoch;
    this.replica.applyTimelineResponse(payload, maySettleInitialization, mayUpdatePagination);
    if (this.hasAuthoritativeHistory(agentId)) this.initializationAgentIds.delete(agentId);
    const epochAfter = this.readCursor(agentId)?.epoch;
    if (epochAfter) this.observedEpochs.set(agentId, epochAfter);
    if (epochAfter && epochAfter !== epochBefore) {
      this.epochVersions.set(agentId, (this.epochVersions.get(agentId) ?? 0) + 1);
    }
    return true;
  }

  private resolvePagePayload(
    agentId: string,
    page: AgentTimelinePage,
    context: RequestContext,
    currentCursor: AgentTimelineCursorState | undefined,
  ): AgentTimelineResponsePayload | null {
    const epochAdvancedSinceIssue =
      context.epochVersionAtIssue < (this.epochVersions.get(agentId) ?? 0);
    const observedEpoch = this.observedEpochs.get(agentId);
    if (
      page.epoch &&
      epochAdvancedSinceIssue &&
      (observedEpoch ? page.epoch !== observedEpoch : currentCursor?.epoch !== page.epoch)
    ) {
      return null;
    }
    if (
      page.reset &&
      currentCursor?.epoch === page.epoch &&
      !this.requestStillTargetsReplica(context, currentCursor)
    ) {
      return { ...page, reset: false };
    }
    return page;
  }

  private requestStillTargetsReplica(
    context: RequestContext,
    cursor: AgentTimelineCursorState | undefined,
  ): boolean {
    if (!context.cursor || !cursor || context.cursor.epoch !== cursor.epoch) return false;
    const boundary = context.lane === "older" ? cursor.startSeq : cursor.endSeq;
    return context.cursor.seq === boundary;
  }

  private isCurrent(context: RequestContext): boolean {
    return !this.disposed && context.connectionGeneration === this.connectionGeneration;
  }

  private isCurrentForward(agentId: string, context: RequestContext): boolean {
    return (
      context.lane === "forward" &&
      this.latestForwardIntent.get(agentId) === context.forwardIntentSerial
    );
  }

  private createForwardIntent(): number {
    this.forwardIntentSerial += 1;
    return this.forwardIntentSerial;
  }

  private getViewedForwardIntent(agentId: string, generation: number): number {
    const current = this.viewedForwardIntents.get(agentId);
    if (current?.generation === generation) return current.intentSerial;
    const intentSerial = this.createForwardIntent();
    this.viewedForwardIntents.set(agentId, { generation, intentSerial });
    return intentSerial;
  }

  private readCursor(agentId: string): AgentTimelineCursorState | undefined {
    return useSessionStore
      .getState()
      .sessions[this.options.serverId]?.agentTimelineCursor.get(agentId);
  }

  private hasAuthoritativeHistory(agentId: string): boolean {
    return (
      useSessionStore
        .getState()
        .sessions[this.options.serverId]?.agentAuthoritativeHistoryApplied.get(agentId) === true
    );
  }

  private beginInitialization(agentId: string, direction: "tail" | "after"): Promise<void> {
    this.initializationAgentIds.add(agentId);
    const key = getInitKey(this.options.serverId, agentId);
    let deferred = getInitDeferred(key);
    if (!deferred) {
      deferred = createInitDeferred(key, direction);
    }
    const store = useSessionStore.getState();
    store.setInitializingAgents(this.options.serverId, (prev) => {
      if (prev.get(agentId) === true) return prev;
      const next = new Map(prev);
      next.set(agentId, true);
      return next;
    });
    refreshInitTimeout({
      key,
      onTimeout: () => {
        this.failInitialization(
          agentId,
          new Error(`History sync timed out after ${Math.round(INIT_TIMEOUT_MS / 1_000)}s`),
        );
      },
    });
    return deferred.promise;
  }

  private failInitialization(agentId: string, error: unknown): void {
    this.initializationAgentIds.delete(agentId);
    const key = getInitKey(this.options.serverId, agentId);
    if (!getInitDeferred(key)) return;
    useSessionStore.getState().setInitializingAgents(this.options.serverId, (prev) => {
      if (prev.get(agentId) !== true) return prev;
      const next = new Map(prev);
      next.set(agentId, false);
      return next;
    });
    rejectInitDeferred(key, error instanceof Error ? error : new Error(String(error)));
  }
}
