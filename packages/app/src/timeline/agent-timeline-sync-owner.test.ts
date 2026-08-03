import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { getInitDeferred, getInitKey } from "@/utils/agent-initialization";
import type { ProjectedTimelineFetchPlan } from "./timeline-sync-plan";
import {
  AgentTimelineSyncOwner,
  type AgentTimelinePage,
  type AgentTimelineRequest,
} from "./agent-timeline-sync-owner";

const serverId = "timeline-owner-test";
const agentId = "agent-a";

interface PendingPage {
  request: AgentTimelineRequest;
  resolve(page: AgentTimelinePage): void;
  reject(error: Error): void;
}

function deferredPage(request: AgentTimelineRequest): {
  pending: PendingPage;
  promise: Promise<AgentTimelinePage>;
} {
  let resolve!: (page: AgentTimelinePage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AgentTimelinePage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { pending: { request, resolve, reject }, promise };
}

function page(input: {
  request: AgentTimelineRequest;
  epoch?: string;
  reset?: boolean;
  gap?: boolean;
  startSeq?: number;
  endSeq?: number;
  hasOlder?: boolean;
  hasNewer?: boolean;
  text?: string;
  error?: string | null;
}): AgentTimelinePage {
  const epoch = input.epoch ?? "epoch-a";
  const startSeq = input.startSeq;
  const endSeq = input.endSeq ?? startSeq;
  return {
    requestId: input.request.requestId ?? "missing-request-id",
    agentId,
    agent: null,
    direction: input.request.direction ?? "tail",
    projection: "projected",
    epoch,
    reset: input.reset ?? false,
    staleCursor: false,
    gap: input.gap ?? false,
    window: {
      minSeq: startSeq ?? 0,
      maxSeq: endSeq ?? 0,
      nextSeq: (endSeq ?? 0) + 1,
    },
    startCursor: startSeq === undefined ? null : { epoch, seq: startSeq },
    endCursor: endSeq === undefined ? null : { epoch, seq: endSeq },
    hasOlder: input.hasOlder ?? false,
    hasNewer: input.hasNewer ?? false,
    entries:
      startSeq === undefined || endSeq === undefined
        ? []
        : [
            {
              provider: "claude",
              item: { type: "assistant_message", text: input.text ?? `rows-${startSeq}-${endSeq}` },
              timestamp: new Date(1_000 + endSeq).toISOString(),
              seqStart: startSeq,
              seqEnd: endSeq,
              sourceSeqRanges: [{ startSeq, endSeq }],
              collapsed: [],
            },
          ],
    error: input.error ?? null,
  } as AgentTimelinePage;
}

class TimelineOwnerWorld {
  readonly pending: PendingPage[] = [];
  readonly owner = new AgentTimelineSyncOwner({
    serverId,
    requestPage: (requestedAgentId, request) => {
      expect(requestedAgentId).toBe(agentId);
      const requestPage = deferredPage(request);
      this.pending.push(requestPage.pending);
      return requestPage.promise;
    },
    setSubscription: async () => {},
    drainQueuedAgentMessage: () => {},
    reportError: () => {},
    schedule: () => () => {},
  });

  constructor() {
    this.owner.setConnected(true);
  }

  take(): PendingPage {
    const next = this.pending.shift();
    if (!next) throw new Error("Expected a pending timeline request");
    return next;
  }

  setCursor(epoch: string, startSeq: number, endSeq: number): void {
    this.setLiveCursor(epoch, startSeq, endSeq);
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);
  }

  setLiveCursor(epoch: string, startSeq: number, endSeq: number): void {
    const store = useSessionStore.getState();
    store.setAgentTimelineCursor(serverId, new Map([[agentId, { epoch, startSeq, endSeq }]]));
  }
}

beforeEach(() => {
  useSessionStore.getState().initializeSession(serverId, null);
});

afterEach(() => {
  useSessionStore.getState().clearSession(serverId);
});

describe("AgentTimelineSyncOwner", () => {
  test("deduplicates identical initialization reads inside the host owner", async () => {
    const world = new TimelineOwnerWorld();
    const initialization = world.owner.ensureCurrent(agentId);
    const duplicate = world.owner.fetchTimeline(agentId, {
      direction: "tail",
      limit: 40,
      projection: "projected",
    });

    expect(world.pending).toHaveLength(1);
    const request = world.take();
    request.resolve(page({ request: request.request, startSeq: 1, endSeq: 1 }));

    await duplicate;
    await initialization;
    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 1,
      },
    );
    world.owner.dispose();
  });

  test("pages an explicit refresh until the authoritative tail", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 1, 1);
    const refresh = world.owner.refreshAgent(agentId);
    const firstRequest = world.take();

    firstRequest.resolve(
      page({
        request: firstRequest.request,
        startSeq: 2,
        endSeq: 2,
        hasOlder: true,
        hasNewer: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondRequest = world.take();
    expect(secondRequest.request).toMatchObject({
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 2 },
    });
    secondRequest.resolve(
      page({ request: secondRequest.request, startSeq: 3, endSeq: 3, hasOlder: true }),
    );
    await refresh;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 3,
      },
    );
    world.owner.dispose();
  });

  test("keeps one control intent across pages of a superseded catch-up", async () => {
    const world = new TimelineOwnerWorld();
    world.setLiveCursor("epoch-a", 1, 1);
    let initializationSettled = false;
    const initialization = world.owner.ensureCurrent(agentId).then(() => {
      initializationSettled = true;
      return undefined;
    });
    const olderFirstRequest = world.take();
    const currentRefresh = world.owner.refreshAgent(agentId);
    const currentRequest = world.take();

    olderFirstRequest.resolve(
      page({
        request: olderFirstRequest.request,
        startSeq: 2,
        endSeq: 2,
        hasNewer: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const olderContinuation = world.take();
    currentRequest.resolve(page({ request: currentRequest.request, startSeq: 2, endSeq: 2 }));
    await currentRefresh;
    await Promise.resolve();
    expect(initializationSettled).toBe(true);
    await initialization;

    olderContinuation.reject(new Error("superseded continuation failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      useSessionStore.getState().sessions[serverId]?.agentAuthoritativeHistoryApplied.get(agentId),
    ).toBe(true);
    world.owner.dispose();
  });

  test("preserves a same-epoch retention gap reset", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 1, 5);
    const fetch = world.owner.fetchTimeline(agentId, {
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 5 },
      limit: 40,
      projection: "projected",
    });
    const request = world.take();

    request.resolve(
      page({
        request: request.request,
        reset: true,
        gap: true,
        startSeq: 10,
        endSeq: 12,
      }),
    );
    await fetch;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 10,
        endSeq: 12,
      },
    );
    world.owner.dispose();
  });

  test("flushes a queued new epoch before arbitrating a response without a cursor", async () => {
    const world = new TimelineOwnerWorld();
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);
    const fetch = world.owner.fetchTimeline(agentId, {
      direction: "tail",
      limit: 40,
      projection: "projected",
    });
    const request = world.take();
    world.owner.enqueueLive({
      agentId,
      event: {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "new epoch live" },
      },
      timestamp: new Date(2_000).toISOString(),
      seq: 7,
      epoch: "epoch-b",
    });

    request.resolve(
      page({
        request: request.request,
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 1,
        text: "old epoch page",
      }),
    );
    await expect(fetch).rejects.toThrow("superseded");

    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch,
    ).toBe("epoch-b");
    world.owner.dispose();
  });

  test("flushes a queued rollover before arbitrating a response with a cursor", async () => {
    const world = new TimelineOwnerWorld();
    world.setLiveCursor("epoch-a", 1, 1);
    const stale = world.owner.fetchTimeline(agentId, {
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 1 },
      limit: 40,
      projection: "projected",
    });
    const staleRequest = world.take();
    world.owner.enqueueLive({
      agentId,
      event: {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "new epoch live" },
      },
      timestamp: new Date(2_000).toISOString(),
      seq: 7,
      epoch: "epoch-b",
    });
    staleRequest.resolve(
      page({ request: staleRequest.request, epoch: "epoch-a", startSeq: 2, endSeq: 2 }),
    );
    await expect(stale).rejects.toThrow("superseded");
    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch,
    ).toBe("epoch-a");

    const current = world.owner.refreshAgent(agentId);
    const currentRequest = world.take();
    currentRequest.resolve(
      page({
        request: currentRequest.request,
        epoch: "epoch-b",
        startSeq: 2,
        endSeq: 2,
        reset: true,
      }),
    );
    await current;
    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch,
    ).toBe("epoch-b");
    expect(
      useSessionStore.getState().sessions[serverId]?.agentAuthoritativeHistoryApplied.get(agentId),
    ).toBe(true);
    world.owner.dispose();
  });

  test("starts a fresh visibility request while initial history is still in flight", async () => {
    const world = new TimelineOwnerWorld();
    world.owner.setActive(true);
    world.owner.uiBridge.replaceVisibleAgentIds("pane", [agentId]);
    const initialRequest = world.take();

    world.owner.refreshVisibleTimelines();
    const resumedRequest = world.take();
    expect(resumedRequest.request.requestId).not.toBe(initialRequest.request.requestId);

    resumedRequest.resolve(
      page({
        request: resumedRequest.request,
        startSeq: 1,
        endSeq: 1,
        text: "current",
        hasNewer: true,
      }),
    );
    await Promise.resolve();
    const resumedContinuation = world.take();
    expect(resumedContinuation.request).toMatchObject({
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 1 },
    });
    expect(resumedContinuation.request.requestId).not.toBe(resumedRequest.request.requestId);
    resumedContinuation.resolve(
      page({
        request: resumedContinuation.request,
        startSeq: 2,
        endSeq: 2,
        text: "current continuation",
      }),
    );
    await Promise.resolve();
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeUndefined();

    initialRequest.resolve(
      page({ request: initialRequest.request, startSeq: 1, endSeq: 3, text: "current plus late" }),
    );
    await Promise.resolve();

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 3,
      },
    );
    world.owner.dispose();
  });

  test("applies useful rows from an earlier request that snapshots later", async () => {
    const world = new TimelineOwnerWorld();
    const plan: ProjectedTimelineFetchPlan = {
      direction: "tail",
      limit: 40,
      projection: "projected",
    };
    const earlier = world.owner.fetchTimeline(agentId, plan);
    const earlierRequest = world.take();
    const fresh = world.owner.fetchTimeline(agentId, plan, { force: true });
    const freshRequest = world.take();

    freshRequest.resolve(
      page({ request: freshRequest.request, startSeq: 1, endSeq: 1, text: "first" }),
    );
    await fresh;
    earlierRequest.resolve(
      page({ request: earlierRequest.request, startSeq: 1, endSeq: 2, text: "first then second" }),
    );
    await earlier;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 2,
      },
    );
    world.owner.dispose();
  });

  test("keeps older pagination independent from forward catch-up", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 10, 20);
    const older = world.owner.fetchTimeline(agentId, {
      direction: "before",
      cursor: { epoch: "epoch-a", seq: 10 },
      limit: 40,
      projection: "projected",
    });
    const olderRequest = world.take();
    const forward = world.owner.fetchTimeline(agentId, {
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 20 },
      limit: 40,
      projection: "projected",
    });
    const forwardRequest = world.take();

    forwardRequest.resolve(
      page({ request: forwardRequest.request, startSeq: 21, endSeq: 21, hasOlder: true }),
    );
    await forward;
    olderRequest.resolve(
      page({ request: olderRequest.request, startSeq: 5, endSeq: 9, hasOlder: false }),
    );
    await older;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 5,
        endSeq: 21,
      },
    );
    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineHasOlder.get(agentId)).toBe(
      false,
    );
    world.owner.dispose();
  });

  test("flushes queued live events before reconciling their canonical page", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 1, 1);
    world.owner.enqueueLive({
      agentId,
      event: {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "live draft" },
      },
      timestamp: new Date(2_000).toISOString(),
      seq: 2,
      epoch: "epoch-a",
    });
    const fetch = world.owner.fetchTimeline(agentId, {
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 1 },
      limit: 40,
      projection: "projected",
    });
    const request = world.take();

    request.resolve(page({ request: request.request, startSeq: 2, endSeq: 2, text: "canonical" }));
    await fetch;

    const session = useSessionStore.getState().sessions[serverId];
    expect(session?.agentTimelineCursor.get(agentId)?.endSeq).toBe(2);
    const stream = [
      ...(session?.agentStreamTail.get(agentId) ?? []),
      ...(session?.agentStreamHead.get(agentId) ?? []),
    ];
    expect(stream).toHaveLength(1);
    expect(stream[0]).toMatchObject({ kind: "assistant_message" });
    world.owner.dispose();
  });

  test("does not let a stale empty older page overwrite pagination metadata", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 10, 20);
    const plan: ProjectedTimelineFetchPlan = {
      direction: "before",
      cursor: { epoch: "epoch-a", seq: 10 },
      limit: 40,
      projection: "projected",
    };
    const stale = world.owner.fetchTimeline(agentId, plan, { force: true });
    const staleRequest = world.take();
    const current = world.owner.fetchTimeline(agentId, plan, { force: true });
    const currentRequest = world.take();

    currentRequest.resolve(
      page({ request: currentRequest.request, startSeq: 5, endSeq: 9, hasOlder: true }),
    );
    await current;
    staleRequest.resolve(page({ request: staleRequest.request, hasOlder: false }));
    await stale;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineHasOlder.get(agentId)).toBe(
      true,
    );
    world.owner.dispose();
  });

  test("does not replace an accepted epoch with another request issued before rollover", async () => {
    const world = new TimelineOwnerWorld();
    world.setCursor("epoch-a", 1, 5);
    const plan: ProjectedTimelineFetchPlan = {
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 5 },
      limit: 40,
      projection: "projected",
    };
    const stale = world.owner.fetchTimeline(agentId, plan, { force: true });
    const staleRequest = world.take();
    const current = world.owner.fetchTimeline(agentId, plan, { force: true });
    const currentRequest = world.take();

    staleRequest.resolve(
      page({
        request: staleRequest.request,
        epoch: "epoch-b",
        reset: true,
        startSeq: 1,
        endSeq: 1,
      }),
    );
    await stale;
    currentRequest.resolve(
      page({
        request: currentRequest.request,
        epoch: "epoch-c",
        reset: true,
        startSeq: 1,
        endSeq: 1,
      }),
    );
    await expect(current).rejects.toThrow("superseded");

    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch,
    ).toBe("epoch-b");
    world.owner.dispose();
  });

  test("ignores a page from a previous host connection", async () => {
    const world = new TimelineOwnerWorld();
    const requestPromise = world.owner.fetchTimeline(agentId, {
      direction: "tail",
      limit: 40,
      projection: "projected",
    });
    const request = world.take();

    world.owner.setConnected(false);
    world.owner.setConnected(true);
    request.resolve(page({ request: request.request, startSeq: 1, endSeq: 1 }));
    await expect(requestPromise).rejects.toThrow("superseded");

    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId),
    ).toBeUndefined();
    world.owner.dispose();
  });

  test("propagates a protocol error instead of marking initialization ready", async () => {
    const world = new TimelineOwnerWorld();
    const initialization = world.owner.ensureCurrent(agentId);
    const request = world.take();
    request.resolve(page({ request: request.request, error: "timeline unavailable" }));

    await expect(initialization).rejects.toThrow("timeline unavailable");
    expect(
      useSessionStore.getState().sessions[serverId]?.agentAuthoritativeHistoryApplied.get(agentId),
    ).not.toBe(true);
    expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get(agentId)).toBe(
      false,
    );
    world.owner.dispose();
  });

  test("retries current initialization immediately after an epoch supersedes its page", async () => {
    const world = new TimelineOwnerWorld();
    world.setLiveCursor("epoch-a", 1, 1);
    const initialization = world.owner.ensureCurrent(agentId);
    const staleRequest = world.take();

    world.owner.enqueueLive({
      agentId,
      event: {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "new epoch live" },
      },
      timestamp: new Date(2_000).toISOString(),
      seq: 7,
      epoch: "epoch-b",
    });
    staleRequest.resolve(
      page({ request: staleRequest.request, epoch: "epoch-a", startSeq: 2, endSeq: 2 }),
    );

    await vi.waitFor(() => expect(world.pending).toHaveLength(1));
    const retry = world.take();
    expect(retry.request).toMatchObject({
      direction: "after",
      cursor: { epoch: "epoch-a", seq: 1 },
    });
    retry.resolve(
      page({
        request: retry.request,
        epoch: "epoch-b",
        startSeq: 1,
        endSeq: 7,
        reset: true,
      }),
    );

    await initialization;
    expect(
      useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch,
    ).toBe("epoch-b");
    expect(
      useSessionStore.getState().sessions[serverId]?.agentAuthoritativeHistoryApplied.get(agentId),
    ).toBe(true);
    world.owner.dispose();
  });

  test("expires initialization that makes no authoritative progress", async () => {
    vi.useFakeTimers();
    try {
      const world = new TimelineOwnerWorld();
      const initialization = world.owner.ensureCurrent(agentId);
      world.take();
      const rejected = expect(initialization).rejects.toThrow("History sync timed out after 65s");

      await vi.advanceTimersByTimeAsync(65_000);
      await rejected;
      expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get(agentId)).toBe(
        false,
      );
      world.owner.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects pending initialization when its host owner is disposed", async () => {
    const world = new TimelineOwnerWorld();
    const initialization = world.owner.ensureCurrent(agentId);
    world.take();

    world.owner.dispose();

    await expect(initialization).rejects.toThrow("was disposed");
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeUndefined();

    const replacement = new TimelineOwnerWorld();
    const replacementInitialization = replacement.owner.ensureCurrent(agentId);
    const request = replacement.take();
    request.resolve(page({ request: request.request, startSeq: 1, endSeq: 1 }));
    await replacementInitialization;
    replacement.owner.dispose();
  });

  test("keeps data from an older request when the newer request fails", async () => {
    const world = new TimelineOwnerWorld();
    const plan: ProjectedTimelineFetchPlan = {
      direction: "tail",
      limit: 40,
      projection: "projected",
    };
    const older = world.owner.fetchTimeline(agentId, plan);
    const olderRequest = world.take();
    const newer = world.owner.fetchTimeline(agentId, plan, { force: true });
    const newerRequest = world.take();

    newerRequest.reject(new Error("newer request failed"));
    await expect(newer).rejects.toThrow("newer request failed");
    olderRequest.resolve(page({ request: olderRequest.request, startSeq: 1, endSeq: 1 }));
    await older;

    expect(useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId)).toEqual(
      {
        epoch: "epoch-a",
        startSeq: 1,
        endSeq: 1,
      },
    );
    world.owner.dispose();
  });
});
