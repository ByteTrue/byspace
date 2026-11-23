import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { TimelineResponsePayload } from "./viewed-timeline-sync";
import { planTimelineTailFetch } from "./timeline-sync-plan";

interface TimelineReplacementFetch {
  fetchAgentTimeline: DaemonClient["fetchAgentTimeline"];
}

type TimelineFetchRequest = Parameters<DaemonClient["fetchAgentTimeline"]>[1];

export class TimelineReplacementRequests {
  private readonly pending = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private readonly requestGenerations = new Map<string, number>();
  private readonly destructiveRequests = new Set<string>();

  get size(): number {
    return this.pending.size;
  }

  get(agentId: string): string | undefined {
    return this.pending.get(agentId);
  }

  has(agentId: string): boolean {
    return this.pending.has(agentId);
  }

  set(agentId: string, requestId: string, destructive = false): void {
    const previousRequestId = this.pending.get(agentId);
    if (previousRequestId) {
      this.requestGenerations.delete(previousRequestId);
      this.destructiveRequests.delete(previousRequestId);
    }
    if (destructive) this.destructiveRequests.add(requestId);
    const generation = (this.generations.get(agentId) ?? 0) + 1;
    this.generations.set(agentId, generation);
    this.pending.set(agentId, requestId);
    this.requestGenerations.set(requestId, generation);
  }

  generation(agentId: string): number {
    return this.generations.get(agentId) ?? 0;
  }

  delete(agentId: string): void {
    const requestId = this.pending.get(agentId);
    if (!requestId) return;
    this.pending.delete(agentId);
    this.requestGenerations.delete(requestId);
    this.destructiveRequests.delete(requestId);
    // Requests created while this replacement was pending may still hold pre-reset cursors.
    // Settling the replacement invalidates those requests and terminates their catch-up chains.
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
  }

  register(agentId: string, requestId: string): void {
    this.requestGenerations.set(requestId, this.generations.get(agentId) ?? 0);
  }

  forget(requestId: string): void {
    this.requestGenerations.delete(requestId);
    this.destructiveRequests.delete(requestId);
  }

  isDestructive(requestId: string): boolean {
    return this.destructiveRequests.has(requestId);
  }

  accepts(payload: TimelineResponsePayload): boolean {
    const currentGeneration = this.generations.get(payload.agentId) ?? 0;
    if (!payload.requestId) return currentGeneration === 0;
    const requestGeneration = this.requestGenerations.get(payload.requestId);
    this.requestGenerations.delete(payload.requestId);
    if (requestGeneration === undefined) return currentGeneration === 0;
    return requestGeneration === currentGeneration;
  }
}

export function fenceTimelineRequest(
  requests: TimelineReplacementRequests,
  agentId: string,
  request: NonNullable<TimelineFetchRequest>,
): NonNullable<TimelineFetchRequest> {
  const requestId = request.requestId ?? globalThis.crypto.randomUUID();
  requests.register(agentId, requestId);
  return { ...request, requestId };
}

export function requestTimelineReplacement(
  client: TimelineReplacementFetch,
  agentId: string,
  requests: TimelineReplacementRequests,
  options?: { destructive?: boolean },
): ReturnType<DaemonClient["fetchAgentTimeline"]> {
  const requestId = globalThis.crypto.randomUUID();
  requests.set(agentId, requestId, options?.destructive);
  return client
    .fetchAgentTimeline(agentId, { ...planTimelineTailFetch(), requestId })
    .catch((error: unknown) => {
      if (requests.get(agentId) === requestId) requests.delete(agentId);
      else requests.forget(requestId);
      throw error;
    });
}

export function consumeForcedTimelineTailReplacement(
  payload: TimelineResponsePayload,
  requests: TimelineReplacementRequests,
): TimelineResponsePayload | null {
  if (!requests.accepts(payload)) return null;
  const requestId = requests.get(payload.agentId);
  if (!requestId) return payload;
  const destructive = payload.requestId ? requests.isDestructive(payload.requestId) : false;
  // A rewind invalidates every older tail/catch-up response, not just rows after the old cursor.
  if (payload.direction !== "tail" || payload.requestId !== requestId) return null;
  requests.delete(payload.agentId);
  return { ...payload, reset: true, ...(destructive ? { forceReplacement: true } : {}) };
}
