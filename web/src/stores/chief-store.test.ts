import type {
  ChiefMissionListPayload,
  DaemonEventHandler,
} from "@bytetrue/client/internal/daemon-client";
import type { ChiefMissionSnapshot, ChiefThreadSnapshot } from "@bytetrue/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireChiefMissionSubscription,
  classifyThreadOutcomeGroup,
  groupThreadsByOutcome,
  selectMissionForAgent,
  selectMissionsForChiefAgent,
  useChiefStore,
  type ChiefDaemonClient,
  type ChiefMissionUpdatePayload,
} from "./chief-store";

function makeThread(overrides: Partial<ChiefThreadSnapshot> = {}): ChiefThreadSnapshot {
  return {
    id: "thr-1",
    missionId: "msn-1",
    title: "Thread 1",
    goal: "Implement backend route",
    acceptanceCriteria: ["Tests pass"],
    ownedPaths: ["internal/server/chief.go"],
    cwd: "/repo/byspace",
    isolation: "worktree",
    status: "authoring",
    verifyRejectCount: 0,
    rebaseAttempts: 0,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T10:05:00.000Z",
    ...overrides,
  };
}

function makeMission(overrides: Partial<ChiefMissionSnapshot> = {}): ChiefMissionSnapshot {
  return {
    id: "msn-1",
    title: "Ship Phase 1",
    goal: "Coordinate protocol, server, and UI",
    chiefAgentId: "agt-chief",
    chiefAgentStatus: "idle",
    baseCwd: "/repo/byspace",
    tier: "L2",
    status: "active",
    threads: [makeThread()],
    headSeq: 1,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T10:05:00.000Z",
    ...overrides,
  };
}

function createMockClient(overrides: Partial<ChiefDaemonClient> = {}) {
  const listeners = new Set<DaemonEventHandler>();
  const client: ChiefDaemonClient = {
    listChiefMissions: vi.fn<ChiefDaemonClient["listChiefMissions"]>(async () => ({
      requestId: "r1",
      missions: [],
      error: null,
    })),
    getChiefMission: vi.fn<ChiefDaemonClient["getChiefMission"]>(async () => ({
      requestId: "r2",
      mission: null,
      events: [],
      error: null,
    })),
    resolveChiefDecision: vi.fn<ChiefDaemonClient["resolveChiefDecision"]>(async () => ({
      requestId: "r3",
      mission: null,
      error: null,
    })),
    upgradeChiefMission: vi.fn<ChiefDaemonClient["upgradeChiefMission"]>(async () => ({
      requestId: "r4",
      mission: null,
      createdThreadId: null,
      error: null,
    })),
    mergeCheckChiefThread: vi.fn<ChiefDaemonClient["mergeCheckChiefThread"]>(async () => ({
      requestId: "r5",
      accepted: true,
      mergeCheck: null,
      mission: null,
      error: null,
    })),
    landChiefThread: vi.fn<ChiefDaemonClient["landChiefThread"]>(async () => ({
      requestId: "r6",
      accepted: true,
      approvalRequired: false,
      mission: null,
      error: null,
    })),
    cancelChiefThread: vi.fn<ChiefDaemonClient["cancelChiefThread"]>(async () => ({
      requestId: "r7",
      accepted: true,
      mission: null,
      error: null,
    })),
    subscribe: vi.fn<ChiefDaemonClient["subscribe"]>((handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    }),
    ...overrides,
  };

  return {
    client,
    emitMissionUpdate(payload: ChiefMissionUpdatePayload) {
      for (const listener of listeners) {
        listener({ type: "chief.mission.update", payload });
      }
    },
    listenerCount: () => listeners.size,
  };
}

describe("chief-store", () => {
  beforeEach(() => {
    useChiefStore.getState().resetAll();
  });

  afterEach(() => {
    useChiefStore.getState().resetAll();
  });

  it("loads missions and sorts waiting_human ahead of active and completed", async () => {
    const completed = makeMission({
      id: "msn-done",
      status: "completed",
      updatedAt: "2026-11-25T12:00:00.000Z",
    });
    const active = makeMission({
      id: "msn-active",
      status: "active",
      updatedAt: "2026-11-25T11:00:00.000Z",
    });
    const waiting = makeMission({
      id: "msn-wait",
      status: "waiting_human",
      updatedAt: "2026-11-25T09:00:00.000Z",
    });

    const { client } = createMockClient({
      listChiefMissions: vi.fn(async () => ({
        requestId: "req-list",
        missions: [completed, active, waiting],
        error: null,
      })),
    });

    await useChiefStore.getState().loadMissions({ serverId: "srv-1", client });
    const serverState = useChiefStore.getState().servers["srv-1"];
    expect(serverState?.status).toBe("loaded");

    const ordered = selectMissionsForChiefAgent(serverState?.missions, "agt-chief");
    expect(ordered.map((m) => m.id)).toEqual(["msn-wait", "msn-active", "msn-done"]);
  });

  it("preserves newer live headSeq updates over an older listChiefMissions response", async () => {
    let resolveList: ((value: ChiefMissionListPayload) => void) | null = null;
    const { client, emitMissionUpdate } = createMockClient({
      listChiefMissions: vi.fn<ChiefDaemonClient["listChiefMissions"]>(
        () =>
          new Promise<ChiefMissionListPayload>((resolve) => {
            resolveList = resolve;
          }),
      ),
    });

    const release = acquireChiefMissionSubscription("srv-1", client);
    const loadPromise = useChiefStore.getState().loadMissions({ serverId: "srv-1", client });

    const liveMission = makeMission({ id: "msn-1", headSeq: 5, goal: "Updated via push" });
    emitMissionUpdate({ kind: "upsert", mission: liveMission });

    if (!resolveList) {
      throw new Error("Expected listChiefMissions resolver to be captured");
    }
    const completeList: (value: ChiefMissionListPayload) => void = resolveList;
    completeList({
      requestId: "r1",
      missions: [makeMission({ id: "msn-1", headSeq: 2, goal: "Stale snapshot" })],
      error: null,
    });
    await loadPromise;

    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.goal).toBe(
      "Updated via push",
    );
    release();
  });

  it("ref-counts chief.mission.update subscriptions and appends deduped events", async () => {
    const { client, emitMissionUpdate, listenerCount } = createMockClient({
      getChiefMission: vi.fn<ChiefDaemonClient["getChiefMission"]>(async () => ({
        requestId: "req-get",
        mission: makeMission({ id: "msn-1", headSeq: 2 }),
        events: [
          {
            seq: 1,
            ts: "2026-11-25T10:00:00.000Z",
            missionId: "msn-1",
            kind: "mission_created",
            summary: "Created mission",
          },
          {
            seq: 2,
            ts: "2026-11-25T10:01:00.000Z",
            missionId: "msn-1",
            kind: "thread_created",
            summary: "Created thread 1",
          },
        ],
        error: null,
      })),
    });

    const releaseA = acquireChiefMissionSubscription("srv-1", client);
    const releaseB = acquireChiefMissionSubscription("srv-1", client);
    expect(listenerCount()).toBe(1);

    await useChiefStore.getState().fetchMissionDetail({
      serverId: "srv-1",
      client,
      options: { missionId: "msn-1", includeEvents: true },
    });

    emitMissionUpdate({
      kind: "upsert",
      mission: makeMission({ id: "msn-1", headSeq: 3 }),
      latestEvent: {
        seq: 3,
        ts: "2026-11-25T10:02:00.000Z",
        missionId: "msn-1",
        kind: "author_submitted",
        summary: "Author submitted work",
      },
    });
    emitMissionUpdate({
      kind: "upsert",
      mission: makeMission({ id: "msn-1", headSeq: 3 }),
      latestEvent: {
        seq: 3,
        ts: "2026-11-25T10:02:00.000Z",
        missionId: "msn-1",
        kind: "author_submitted",
        summary: "Author submitted work",
      },
    });

    const events = useChiefStore.getState().servers["srv-1"]?.eventsByMissionId.get("msn-1");
    expect(events?.map((e) => e.seq)).toEqual([1, 2, 3]);

    releaseA();
    expect(listenerCount()).toBe(1);
    releaseB();
    expect(listenerCount()).toBe(0);
  });

  it("handles resolveDecision, upgradeMission, and mission removal", async () => {
    const resolvedMission = makeMission({
      id: "msn-1",
      status: "active",
      headSeq: 4,
      pendingDecision: null,
    });
    const upgradedMission = makeMission({
      id: "msn-1",
      tier: "L2",
      headSeq: 5,
    });

    const { client, emitMissionUpdate } = createMockClient({
      resolveChiefDecision: vi.fn(async () => ({
        requestId: "r-dec",
        mission: resolvedMission,
        error: null,
      })),
      upgradeChiefMission: vi.fn(async () => ({
        requestId: "r-upg",
        mission: upgradedMission,
        createdThreadId: "thr-new",
        error: null,
      })),
    });

    const release = acquireChiefMissionSubscription("srv-1", client);
    await useChiefStore.getState().resolveDecision({
      serverId: "srv-1",
      client,
      options: { missionId: "msn-1", decisionId: "dec-1", optionId: "approve" },
    });
    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.headSeq).toBe(4);

    const upgradeRes = await useChiefStore.getState().upgradeMission({
      serverId: "srv-1",
      client,
      options: { missionId: "msn-1", targetTier: "L2" },
    });
    expect(upgradeRes.createdThreadId).toBe("thr-new");
    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.tier).toBe("L2");

    emitMissionUpdate({ kind: "remove", missionId: "msn-1" });
    expect(useChiefStore.getState().servers["srv-1"]?.missions.has("msn-1")).toBe(false);
    release();
  });

  it("merges a resolved mission before rejecting with its landing error", async () => {
    const landingError =
      "PostLandError: landed SHA 1111111111111111111111111111111111111111 does not match expected SHA 2222222222222222222222222222222222222222; reconciliation required before retry.";
    const resolvedMission = makeMission({
      headSeq: 5,
      pendingDecision: {
        id: "dec-land",
        kind: "landing_approval",
        title: "Approve landing",
        summary: "Human approval is required.",
        createdAt: "2026-11-25T10:06:00.000Z",
        resolvedAt: "2026-11-25T10:07:00.000Z",
        selectedOptionId: "approve",
        landingStrategy: "squash",
        landingCommitMessage: "Thread 1",
        landingError,
      },
    });
    const { client } = createMockClient({
      resolveChiefDecision: vi.fn(async () => ({
        requestId: "r-dec-error",
        mission: resolvedMission,
        error: landingError,
      })),
    });
    useChiefStore.getState().applyMissionUpdate("srv-1", {
      kind: "upsert",
      mission: makeMission(),
    });

    await expect(
      useChiefStore.getState().resolveDecision({
        serverId: "srv-1",
        client,
        options: { missionId: "msn-1", decisionId: "dec-land", optionId: "approve" },
      }),
    ).rejects.toThrow(landingError);

    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")).toEqual(
      resolvedMission,
    );
  });

  it("runs thread actions with exact requests and synchronously merges returned missions", async () => {
    useChiefStore.getState().applyMissionUpdate("srv-1", {
      kind: "upsert",
      mission: makeMission(),
    });
    const mergeCheckedMission = makeMission({
      headSeq: 2,
      threads: [makeThread({ status: "ready_to_land" })],
    });
    const approvalPendingMission = makeMission({
      headSeq: 3,
      status: "waiting_human",
      pendingDecision: {
        id: "dec-land",
        kind: "landing_approval",
        title: "Approve landing",
        summary: "Human approval is required.",
        threadId: "thr-1",
        options: [{ id: "approve", label: "Land", style: "primary" }],
        createdAt: "2026-11-25T10:06:00.000Z",
      },
    });
    const canceledMission = makeMission({
      headSeq: 4,
      threads: [makeThread({ status: "canceled" })],
    });
    const { client } = createMockClient({
      mergeCheckChiefThread: vi.fn(async () => ({
        requestId: "r-merge",
        accepted: true,
        mergeCheck: null,
        mission: mergeCheckedMission,
        error: null,
      })),
      landChiefThread: vi.fn(async () => ({
        requestId: "r-land",
        accepted: false,
        approvalRequired: true,
        mission: approvalPendingMission,
        error: null,
      })),
      cancelChiefThread: vi.fn(async () => ({
        requestId: "r-cancel",
        accepted: true,
        mission: canceledMission,
        error: null,
      })),
    });

    await useChiefStore.getState().mergeCheckThread({
      serverId: "srv-1",
      client,
      options: { threadId: "thr-1", missionId: "msn-1" },
    });
    expect(client.mergeCheckChiefThread).toHaveBeenCalledWith({
      threadId: "thr-1",
      missionId: "msn-1",
    });
    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.headSeq).toBe(2);

    const landResult = await useChiefStore.getState().landThread({
      serverId: "srv-1",
      client,
      options: {
        threadId: "thr-1",
        missionId: "msn-1",
        strategy: "squash",
        commitMessage: "Thread 1",
      },
    });
    expect(landResult).toMatchObject({ accepted: false, approvalRequired: true, error: null });
    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.status).toBe(
      "waiting_human",
    );

    await useChiefStore.getState().cancelThread({
      serverId: "srv-1",
      client,
      options: { threadId: "thr-1", missionId: "msn-1", reason: "Canceled by user" },
    });
    expect(client.cancelChiefThread).toHaveBeenCalledWith({
      threadId: "thr-1",
      missionId: "msn-1",
      reason: "Canceled by user",
    });
    expect(
      useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.threads[0]?.status,
    ).toBe("canceled");
  });

  it("groups threads accurately by outcome and active systemAttention", () => {
    const blocked = makeThread({ id: "t-blocked", status: "blocked" });
    const failed = makeThread({ id: "t-failed", status: "failed" });
    const rebase = makeThread({ id: "t-rebase", status: "needs_rebase" });
    const attention = makeThread({
      id: "t-att",
      status: "authoring",
      systemAttention: {
        kind: "quota_exhausted",
        severity: "fatal",
        summary: "Provider quota exhausted",
        since: "2026-11-25T10:10:00.000Z",
      },
    });
    const ready = makeThread({ id: "t-ready", status: "ready_to_land" });
    const verifying = makeThread({ id: "t-verify", status: "verifying" });
    const queued = makeThread({ id: "t-queued", status: "queued" });
    const landed = makeThread({ id: "t-landed", status: "landed" });
    const canceled = makeThread({ id: "t-canceled", status: "canceled" });

    expect(classifyThreadOutcomeGroup(attention)).toBe("needsAttention");
    const grouped = groupThreadsByOutcome([
      landed,
      verifying,
      ready,
      blocked,
      attention,
      rebase,
      failed,
      queued,
      canceled,
    ]);
    expect(grouped.needsAttention.map((t) => t.id)).toEqual([
      "t-blocked",
      "t-att",
      "t-rebase",
      "t-failed",
    ]);
    expect(grouped.readyToLand.map((t) => t.id)).toEqual(["t-ready"]);
    expect(grouped.inProgress.map((t) => t.id)).toEqual(["t-verify", "t-queued"]);
    expect(grouped.completed.map((t) => t.id)).toEqual(["t-landed", "t-canceled"]);
  });

  it("finds a mission matching chief or worker agent id", () => {
    const msn = makeMission({
      id: "msn-1",
      chiefAgentId: "agt-chief",
      threads: [makeThread({ authorAgentId: "agt-author", verifierAgentId: "agt-verifier" })],
    });
    const map = new Map([[msn.id, msn]]);
    expect(selectMissionForAgent(map, "agt-verifier")?.id).toBe("msn-1");
    expect(selectMissionForAgent(map, "agt-unknown")).toBeNull();
  });
});
