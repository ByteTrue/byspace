import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import {
  fetchAggregatedWorkers,
  workersQueryBaseKey,
  type AggregatedWorker,
  type WorkerHostError,
  type WorkerHostInput,
  type WorkerLoadState,
  type WorkerTemplateOption,
} from "@/workers/aggregated-workers";

export function workersQueryKey(serverIds: readonly string[]) {
  return [...workersQueryBaseKey, [...serverIds].sort().join("|")] as const;
}

export interface UseWorkersResult {
  loadState: WorkerLoadState;
  hostErrors: WorkerHostError[];
  refetch: () => void;
  isRefetching: boolean;
}

export function useWorkers(): UseWorkersResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<WorkerHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  // Part of the query key so a reconnect refetches instead of serving a stale
  // "this host has no workers" answer.
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [...workersQueryKey(serverIds), connectionStatusKey],
    queryFn: () => fetchAggregatedWorkers({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  if (query.data?.status === "connecting") {
    return {
      loadState: { status: "connecting" },
      hostErrors: [],
      refetch: () => {
        void query.refetch();
      },
      isRefetching: query.isRefetching,
    };
  }

  if (query.data?.status === "loaded") {
    return {
      loadState: query.data,
      hostErrors: query.data.hostErrors,
      refetch: () => {
        void query.refetch();
      },
      isRefetching: query.isRefetching,
    };
  }

  return {
    loadState: { status: "loading" },
    hostErrors: [],
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}

export type { AggregatedWorker, WorkerHostError, WorkerTemplateOption };
