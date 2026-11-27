import type {
  ChiefMissionGetOptions,
  ChiefMissionListOptions,
  ChiefMissionResolveDecisionOptions,
  ChiefMissionUpgradeOptions,
  ChiefThreadCancelOptions,
  ChiefThreadCancelPayload,
  ChiefThreadLandOptions,
  ChiefThreadLandPayload,
  ChiefThreadMergeCheckOptions,
  ChiefThreadMergeCheckPayload,
  DaemonClient,
} from "@bytetrue/client/internal/daemon-client";
import type {
  ChiefEvent,
  ChiefMissionSnapshot,
  ChiefMissionUpdateMessage,
  ChiefSystemAttention,
  ChiefThreadSnapshot,
} from "@bytetrue/protocol/messages";
import equal from "fast-deep-equal";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { toErrorMessage } from "@/lib/error-messages";

export interface ChiefDaemonClient {
  listChiefMissions: DaemonClient["listChiefMissions"];
  getChiefMission: DaemonClient["getChiefMission"];
  resolveChiefDecision: DaemonClient["resolveChiefDecision"];
  upgradeChiefMission: DaemonClient["upgradeChiefMission"];
  mergeCheckChiefThread: DaemonClient["mergeCheckChiefThread"];
  landChiefThread: DaemonClient["landChiefThread"];
  cancelChiefThread: DaemonClient["cancelChiefThread"];
  subscribe: DaemonClient["subscribe"];
}

export type ChiefMissionUpdatePayload = ChiefMissionUpdateMessage["payload"];

export type ChiefLoadStatus = "idle" | "loading" | "loaded" | "error";

export interface ChiefServerState {
  missions: Map<string, ChiefMissionSnapshot>;
  status: ChiefLoadStatus;
  error: string | null;
  eventsByMissionId: Map<string, ChiefEvent[]>;
  latestEventByMissionId: Map<string, ChiefEvent>;
  listRequestSeq: number;
}

export type ChiefThreadOutcomeGroup = "needsAttention" | "readyToLand" | "inProgress" | "completed";

export interface GroupedChiefThreads {
  needsAttention: ChiefThreadSnapshot[];
  readyToLand: ChiefThreadSnapshot[];
  inProgress: ChiefThreadSnapshot[];
  completed: ChiefThreadSnapshot[];
}

export interface ChiefStoreState {
  servers: Record<string, ChiefServerState>;
  loadMissions: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options?: ChiefMissionListOptions;
  }) => Promise<ChiefMissionSnapshot[]>;
  fetchMissionDetail: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefMissionGetOptions;
  }) => Promise<ChiefMissionSnapshot | null>;
  applyMissionUpdate: (serverId: string, payload: ChiefMissionUpdatePayload) => void;
  resolveDecision: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefMissionResolveDecisionOptions;
  }) => Promise<ChiefMissionSnapshot | null>;
  upgradeMission: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefMissionUpgradeOptions;
  }) => Promise<{ mission: ChiefMissionSnapshot | null; createdThreadId: string | null }>;
  mergeCheckThread: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefThreadMergeCheckOptions;
  }) => Promise<ChiefThreadMergeCheckPayload>;
  landThread: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefThreadLandOptions;
  }) => Promise<ChiefThreadLandPayload>;
  cancelThread: (input: {
    serverId: string;
    client: ChiefDaemonClient;
    options: ChiefThreadCancelOptions;
  }) => Promise<ChiefThreadCancelPayload>;
  clearServer: (serverId: string) => void;
  resetAll: () => void;
}

const MAX_CACHED_EVENTS_PER_MISSION = 200;

function emptyServerState(): ChiefServerState {
  return {
    missions: new Map(),
    status: "idle",
    error: null,
    eventsByMissionId: new Map(),
    latestEventByMissionId: new Map(),
    listRequestSeq: 0,
  };
}

function mergeEvents(
  existing: readonly ChiefEvent[] | undefined,
  incoming: readonly ChiefEvent[],
): ChiefEvent[] {
  const bySeq = new Map<number, ChiefEvent>();
  for (const event of existing ?? []) {
    bySeq.set(event.seq, event);
  }
  for (const event of incoming) {
    bySeq.set(event.seq, event);
  }
  const sorted = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
  if (sorted.length <= MAX_CACHED_EVENTS_PER_MISSION) {
    return sorted;
  }
  return sorted.slice(sorted.length - MAX_CACHED_EVENTS_PER_MISSION);
}

function preserveMissionIfEqual(
  existing: ChiefMissionSnapshot | undefined,
  incoming: ChiefMissionSnapshot,
): ChiefMissionSnapshot {
  if (existing && equal(existing, incoming)) {
    return existing;
  }
  return incoming;
}

function shouldAcceptMission(
  existing: ChiefMissionSnapshot | undefined,
  incoming: ChiefMissionSnapshot,
): boolean {
  if (!existing) {
    return true;
  }
  const existingSeq = existing.headSeq ?? 0;
  const incomingSeq = incoming.headSeq ?? 0;
  return incomingSeq >= existingSeq;
}

function isUnfilteredListOptions(options?: ChiefMissionListOptions): boolean {
  if (!options) {
    return true;
  }
  return (
    options.chiefAgentId === undefined &&
    options.projectId === undefined &&
    options.baseWorkspaceId === undefined &&
    (options.statuses === undefined || options.statuses.length === 0)
  );
}

function upsertMissionIntoMap(
  currentMap: Map<string, ChiefMissionSnapshot>,
  mission: ChiefMissionSnapshot,
): Map<string, ChiefMissionSnapshot> {
  const existing = currentMap.get(mission.id);
  if (!shouldAcceptMission(existing, mission)) {
    return currentMap;
  }
  const resolved = preserveMissionIfEqual(existing, mission);
  if (existing === resolved) {
    return currentMap;
  }
  const next = new Map(currentMap);
  next.set(mission.id, resolved);
  return next;
}

export const useChiefStore = create<ChiefStoreState>()(
  subscribeWithSelector((set, get) => ({
    servers: {},

    loadMissions: async ({ serverId, client, options }) => {
      const current = get().servers[serverId] ?? emptyServerState();
      const requestSeq = current.listRequestSeq + 1;

      set((state) => ({
        servers: {
          ...state.servers,
          [serverId]: {
            ...(state.servers[serverId] ?? emptyServerState()),
            status: "loading",
            error: null,
            listRequestSeq: requestSeq,
          },
        },
      }));

      try {
        const result = await client.listChiefMissions(options);
        if (result.error) {
          throw new Error(result.error);
        }

        set((state) => {
          const latestServer = state.servers[serverId];
          if (!latestServer || latestServer.listRequestSeq !== requestSeq) {
            return state;
          }

          const baseMissions = isUnfilteredListOptions(options)
            ? new Map<string, ChiefMissionSnapshot>()
            : new Map(latestServer.missions);

          for (const mission of result.missions) {
            const liveExisting = latestServer.missions.get(mission.id);
            const chosen = shouldAcceptMission(liveExisting, mission)
              ? preserveMissionIfEqual(liveExisting, mission)
              : liveExisting;
            if (chosen) {
              baseMissions.set(mission.id, chosen);
            }
          }

          return {
            servers: {
              ...state.servers,
              [serverId]: {
                ...latestServer,
                missions: baseMissions,
                status: "loaded",
                error: null,
              },
            },
          };
        });

        return result.missions;
      } catch (error) {
        const message = toErrorMessage(error);
        set((state) => {
          const latestServer = state.servers[serverId];
          if (!latestServer || latestServer.listRequestSeq !== requestSeq) {
            return state;
          }
          return {
            servers: {
              ...state.servers,
              [serverId]: {
                ...latestServer,
                status: "error",
                error: message,
              },
            },
          };
        });
        return [];
      }
    },

    fetchMissionDetail: async ({ serverId, client, options }) => {
      const result = await client.getChiefMission(options);
      if (result.error) {
        throw new Error(result.error);
      }

      set((state) => {
        const currentServer = state.servers[serverId] ?? emptyServerState();
        let nextMissions = currentServer.missions;
        if (result.mission) {
          nextMissions = upsertMissionIntoMap(currentServer.missions, result.mission);
        }

        let nextEvents = currentServer.eventsByMissionId;
        if (result.events) {
          nextEvents = new Map(currentServer.eventsByMissionId);
          nextEvents.set(
            options.missionId,
            mergeEvents(currentServer.eventsByMissionId.get(options.missionId), result.events),
          );
        }

        return {
          servers: {
            ...state.servers,
            [serverId]: {
              ...currentServer,
              missions: nextMissions,
              eventsByMissionId: nextEvents,
              status:
                currentServer.status === "idle" && result.mission ? "loaded" : currentServer.status,
            },
          },
        };
      });

      return result.mission;
    },

    applyMissionUpdate: (serverId, payload) => {
      set((state) => {
        const currentServer = state.servers[serverId] ?? emptyServerState();

        if (payload.kind === "remove") {
          const hadMission = currentServer.missions.has(payload.missionId);
          const hadEvents = currentServer.eventsByMissionId.has(payload.missionId);
          const hadLatest = currentServer.latestEventByMissionId.has(payload.missionId);
          if (!hadMission && !hadEvents && !hadLatest) {
            return state;
          }
          const nextMissions = new Map(currentServer.missions);
          nextMissions.delete(payload.missionId);
          const nextEvents = new Map(currentServer.eventsByMissionId);
          nextEvents.delete(payload.missionId);
          const nextLatest = new Map(currentServer.latestEventByMissionId);
          nextLatest.delete(payload.missionId);
          return {
            servers: {
              ...state.servers,
              [serverId]: {
                ...currentServer,
                missions: nextMissions,
                eventsByMissionId: nextEvents,
                latestEventByMissionId: nextLatest,
              },
            },
          };
        }

        const nextMissions = upsertMissionIntoMap(currentServer.missions, payload.mission);
        let nextEvents = currentServer.eventsByMissionId;
        let nextLatest = currentServer.latestEventByMissionId;

        if (payload.latestEvent) {
          const missionId = payload.mission.id;
          nextLatest = new Map(currentServer.latestEventByMissionId);
          nextLatest.set(missionId, payload.latestEvent);

          if (currentServer.eventsByMissionId.has(missionId)) {
            nextEvents = new Map(currentServer.eventsByMissionId);
            nextEvents.set(
              missionId,
              mergeEvents(currentServer.eventsByMissionId.get(missionId), [payload.latestEvent]),
            );
          }
        }

        if (
          nextMissions === currentServer.missions &&
          nextEvents === currentServer.eventsByMissionId &&
          nextLatest === currentServer.latestEventByMissionId
        ) {
          return state;
        }

        return {
          servers: {
            ...state.servers,
            [serverId]: {
              ...currentServer,
              missions: nextMissions,
              eventsByMissionId: nextEvents,
              latestEventByMissionId: nextLatest,
              status: currentServer.status === "idle" ? "loaded" : currentServer.status,
            },
          },
        };
      });
    },

    resolveDecision: async ({ serverId, client, options }) => {
      const result = await client.resolveChiefDecision(options);
      if (result.mission) {
        get().applyMissionUpdate(serverId, { kind: "upsert", mission: result.mission });
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result.mission;
    },

    upgradeMission: async ({ serverId, client, options }) => {
      const result = await client.upgradeChiefMission(options);
      if (result.error) {
        throw new Error(result.error);
      }
      if (result.mission) {
        get().applyMissionUpdate(serverId, { kind: "upsert", mission: result.mission });
      }
      return {
        mission: result.mission,
        createdThreadId: result.createdThreadId ?? null,
      };
    },

    mergeCheckThread: async ({ serverId, client, options }) => {
      const result = await client.mergeCheckChiefThread(options);
      if (result.mission) {
        get().applyMissionUpdate(serverId, { kind: "upsert", mission: result.mission });
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },

    landThread: async ({ serverId, client, options }) => {
      const result = await client.landChiefThread(options);
      if (result.mission) {
        get().applyMissionUpdate(serverId, { kind: "upsert", mission: result.mission });
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },

    cancelThread: async ({ serverId, client, options }) => {
      const result = await client.cancelChiefThread(options);
      if (result.mission) {
        get().applyMissionUpdate(serverId, { kind: "upsert", mission: result.mission });
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },

    clearServer: (serverId) => {
      set((state) => {
        if (!(serverId in state.servers)) {
          return state;
        }
        const nextServers = { ...state.servers };
        delete nextServers[serverId];
        return { servers: nextServers };
      });
    },

    resetAll: () => {
      set({ servers: {} });
    },
  })),
);

interface ActiveSubscriptionEntry {
  count: number;
  unsubscribe: () => void;
}

const activeClientSubscriptions = new WeakMap<
  ChiefDaemonClient,
  Map<string, ActiveSubscriptionEntry>
>();

/**
 * Reference-counts a single `chief.mission.update` listener per `(serverId, client)` pair
 * so split Chief panes share one subscription without duplicating store updates.
 */
export function acquireChiefMissionSubscription(
  serverId: string,
  client: ChiefDaemonClient,
): () => void {
  let byServer = activeClientSubscriptions.get(client);
  if (!byServer) {
    byServer = new Map();
    activeClientSubscriptions.set(client, byServer);
  }

  const existing = byServer.get(serverId);
  if (existing) {
    existing.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseSubscription(client, serverId);
    };
  }

  const unsubscribe = client.subscribe((event) => {
    if (event.type === "chief.mission.update") {
      useChiefStore.getState().applyMissionUpdate(serverId, event.payload);
    }
  });
  byServer.set(serverId, { count: 1, unsubscribe });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseSubscription(client, serverId);
  };
}

function releaseSubscription(client: ChiefDaemonClient, serverId: string): void {
  const byServer = activeClientSubscriptions.get(client);
  const entry = byServer?.get(serverId);
  if (!byServer || !entry) {
    return;
  }
  entry.count -= 1;
  if (entry.count <= 0) {
    byServer.delete(serverId);
    entry.unsubscribe();
  }
}

export function hasActiveSystemAttention(
  attention: ChiefSystemAttention | null | undefined,
): attention is ChiefSystemAttention {
  return Boolean(attention && !attention.resolvedAt);
}

export function hasActivePendingDecision(mission: ChiefMissionSnapshot): boolean {
  return Boolean(mission.pendingDecision && !mission.pendingDecision.resolvedAt);
}

export function missionNeedsHumanAttention(mission: ChiefMissionSnapshot): boolean {
  if (mission.status === "waiting_human" || hasActivePendingDecision(mission)) {
    return true;
  }
  if (hasActiveSystemAttention(mission.systemAttention)) {
    return true;
  }
  return mission.threads.some(
    (thread) =>
      hasActiveSystemAttention(thread.systemAttention) ||
      thread.status === "blocked" ||
      thread.status === "failed" ||
      thread.status === "needs_rebase",
  );
}

function missionSortPriority(mission: ChiefMissionSnapshot): number {
  if (missionNeedsHumanAttention(mission)) {
    return 0;
  }
  if (mission.status === "active") {
    return 1;
  }
  if (mission.status === "completed") {
    return 2;
  }
  return 3;
}

export function sortMissionsForDisplay(
  missions: Iterable<ChiefMissionSnapshot>,
): ChiefMissionSnapshot[] {
  return Array.from(missions).sort((a, b) => {
    const priorityDiff = missionSortPriority(a) - missionSortPriority(b);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function selectMissionsForChiefAgent(
  missions: Map<string, ChiefMissionSnapshot> | undefined,
  chiefAgentId?: string | null,
): ChiefMissionSnapshot[] {
  if (!missions || missions.size === 0) {
    return [];
  }
  const trimmed = chiefAgentId?.trim() ?? "";
  const filtered: ChiefMissionSnapshot[] = [];
  for (const mission of missions.values()) {
    if (!trimmed || mission.chiefAgentId === trimmed) {
      filtered.push(mission);
    }
  }
  return sortMissionsForDisplay(filtered);
}

export function selectMissionForAgent(
  missions: Map<string, ChiefMissionSnapshot> | undefined,
  agentId: string | null | undefined,
): ChiefMissionSnapshot | null {
  const trimmed = agentId?.trim();
  if (!missions || !trimmed) {
    return null;
  }
  for (const mission of sortMissionsForDisplay(missions.values())) {
    if (mission.chiefAgentId === trimmed) {
      return mission;
    }
    const matchesThread = mission.threads.some(
      (thread) =>
        thread.authorAgentId === trimmed ||
        thread.verifierAgentId === trimmed ||
        thread.integratorAgentId === trimmed,
    );
    if (matchesThread) {
      return mission;
    }
  }
  return null;
}

export function classifyThreadOutcomeGroup(thread: ChiefThreadSnapshot): ChiefThreadOutcomeGroup {
  if (
    hasActiveSystemAttention(thread.systemAttention) ||
    thread.status === "blocked" ||
    thread.status === "failed" ||
    thread.status === "needs_rebase"
  ) {
    return "needsAttention";
  }
  if (thread.status === "ready_to_land") {
    return "readyToLand";
  }
  if (thread.status === "landed" || thread.status === "canceled") {
    return "completed";
  }
  return "inProgress";
}

export function groupThreadsByOutcome(
  threads: readonly ChiefThreadSnapshot[],
): GroupedChiefThreads {
  const grouped: GroupedChiefThreads = {
    needsAttention: [],
    readyToLand: [],
    inProgress: [],
    completed: [],
  };
  for (const thread of threads) {
    grouped[classifyThreadOutcomeGroup(thread)].push(thread);
  }
  return grouped;
}
