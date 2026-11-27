import type {
  ChiefMissionUpgradeOptions,
  ChiefMissionResolveDecisionOptions,
  ChiefThreadCancelOptions,
  ChiefThreadCancelPayload,
  ChiefThreadLandOptions,
  ChiefThreadLandPayload,
  ChiefThreadMergeCheckOptions,
  ChiefThreadMergeCheckPayload,
} from "@bytetrue/client/internal/daemon-client";
import type { ChiefEvent, ChiefMissionSnapshot } from "@bytetrue/protocol/messages";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionEpoch,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import {
  acquireChiefMissionSubscription,
  selectMissionsForChiefAgent,
  sortMissionsForDisplay,
  useChiefStore,
  type ChiefLoadStatus,
} from "@/stores/chief-store";

const EMPTY_MISSION_MAP = new Map<string, ChiefMissionSnapshot>();
const EMPTY_EVENT_MAP = new Map<string, ChiefEvent[]>();
const EMPTY_LATEST_EVENT_MAP = new Map<string, ChiefEvent>();

export interface UseChiefMissionsOptions {
  serverId: string;
  chiefAgentId?: string | null;
  enabled?: boolean;
}

export interface UseChiefMissionsResult {
  missions: ChiefMissionSnapshot[];
  allMissions: ChiefMissionSnapshot[];
  status: ChiefLoadStatus;
  error: string | null;
  eventsByMissionId: Map<string, ChiefEvent[]>;
  latestEventByMissionId: Map<string, ChiefEvent>;
  refresh: () => Promise<void>;
  loadMissionEvents: (missionId: string) => Promise<void>;
  resolveDecision: (
    options: ChiefMissionResolveDecisionOptions,
  ) => Promise<ChiefMissionSnapshot | null>;
  upgradeMission: (
    options: ChiefMissionUpgradeOptions,
  ) => Promise<{ mission: ChiefMissionSnapshot | null; createdThreadId: string | null }>;
  mergeCheckThread: (
    options: ChiefThreadMergeCheckOptions,
  ) => Promise<ChiefThreadMergeCheckPayload>;
  landThread: (options: ChiefThreadLandOptions) => Promise<ChiefThreadLandPayload>;
  cancelThread: (options: ChiefThreadCancelOptions) => Promise<ChiefThreadCancelPayload>;
}

export function useChiefMissions({
  serverId,
  chiefAgentId,
  enabled = true,
}: UseChiefMissionsOptions): UseChiefMissionsResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const connectionEpoch = useHostRuntimeConnectionEpoch(serverId);

  const serverState = useChiefStore((state) => state.servers[serverId]);
  const loadMissionsAction = useChiefStore((state) => state.loadMissions);
  const fetchMissionDetailAction = useChiefStore((state) => state.fetchMissionDetail);
  const resolveDecisionAction = useChiefStore((state) => state.resolveDecision);
  const upgradeMissionAction = useChiefStore((state) => state.upgradeMission);
  const mergeCheckThreadAction = useChiefStore((state) => state.mergeCheckThread);
  const landThreadAction = useChiefStore((state) => state.landThread);
  const cancelThreadAction = useChiefStore((state) => state.cancelThread);

  useEffect(() => {
    if (!enabled || !client || !serverId) {
      return;
    }
    return acquireChiefMissionSubscription(serverId, client);
  }, [client, enabled, serverId]);

  useEffect(() => {
    if (!enabled || !client || !isConnected || !serverId) {
      return;
    }
    void loadMissionsAction({
      serverId,
      client,
      options: { includeCompleted: true },
    });
  }, [client, connectionEpoch, enabled, isConnected, loadMissionsAction, serverId]);

  const missionMap = serverState?.missions ?? EMPTY_MISSION_MAP;
  const missions = useMemo(
    () => selectMissionsForChiefAgent(missionMap, chiefAgentId),
    [chiefAgentId, missionMap],
  );
  const allMissions = useMemo(() => sortMissionsForDisplay(missionMap.values()), [missionMap]);

  const refresh = useCallback(async () => {
    if (!client || !isConnected || !serverId) {
      return;
    }
    await loadMissionsAction({
      serverId,
      client,
      options: { includeCompleted: true },
    });
  }, [client, isConnected, loadMissionsAction, serverId]);

  const loadMissionEvents = useCallback(
    async (missionId: string) => {
      if (!client || !isConnected || !serverId) {
        return;
      }
      await fetchMissionDetailAction({
        serverId,
        client,
        options: { missionId, includeEvents: true, eventsLimit: 50 },
      });
    },
    [client, fetchMissionDetailAction, isConnected, serverId],
  );

  const resolveDecision = useCallback(
    async (options: ChiefMissionResolveDecisionOptions) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return resolveDecisionAction({ serverId, client, options });
    },
    [client, resolveDecisionAction, serverId, t],
  );

  const upgradeMission = useCallback(
    async (options: ChiefMissionUpgradeOptions) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return upgradeMissionAction({ serverId, client, options });
    },
    [client, serverId, t, upgradeMissionAction],
  );

  const mergeCheckThread = useCallback(
    async (options: ChiefThreadMergeCheckOptions) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return mergeCheckThreadAction({ serverId, client, options });
    },
    [client, mergeCheckThreadAction, serverId, t],
  );

  const landThread = useCallback(
    async (options: ChiefThreadLandOptions) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return landThreadAction({ serverId, client, options });
    },
    [client, landThreadAction, serverId, t],
  );

  const cancelThread = useCallback(
    async (options: ChiefThreadCancelOptions) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return cancelThreadAction({ serverId, client, options });
    },
    [cancelThreadAction, client, serverId, t],
  );

  return {
    missions,
    allMissions,
    status: serverState?.status ?? "idle",
    error: serverState?.error ?? null,
    eventsByMissionId: serverState?.eventsByMissionId ?? EMPTY_EVENT_MAP,
    latestEventByMissionId: serverState?.latestEventByMissionId ?? EMPTY_LATEST_EVENT_MAP,
    refresh,
    loadMissionEvents,
    resolveDecision,
    upgradeMission,
    mergeCheckThread,
    landThread,
    cancelThread,
  };
}
