import { useMemo, useRef } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
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

/**
 * Workers across connected hosts.
 *
 * The connection status is part of the query key so a host coming online re-runs
 * the fetch instead of serving a cached "nothing yet" answer.
 *
 * That key changes on every reconnect, and a reconnect is not instantaneous: the
 * status reports `connecting` before `online` again. A fetch taken during that
 * window legitimately answers "still connecting", and letting that answer
 * replace a roster that is already correct would blank the screen on every
 * blip. So the last successful payload is held and preferred until a newer
 * successful one arrives.
 */
export function useWorkers(): UseWorkersResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<WorkerHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);

  const query = useFetchQuery({
    queryKey: workersQueryKey(serverIds),
    queryFn: () => fetchAggregatedWorkers({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
    // A screen opened while a host is still handshaking would otherwise cache
    // that answer and never ask again: the connection status in the query key
    // did not re-key reliably, so the roster stayed on the transient state.
    // Polling until something loads is the self-healing version and it stops as
    // soon as it succeeds.
    refetchInterval: (state) => (state.state.data?.status === "loaded" ? false : 2_000),
  });

  // Written during render on purpose: the ref only ever holds the most recent
  // successful payload, and an effect would leave one render showing the
  // transient state it is meant to suppress.
  const lastLoadedRef = useRef<Extract<WorkerLoadState, { status: "loaded" }> | null>(null);
  if (query.data?.status === "loaded") {
    lastLoadedRef.current = query.data;
  }

  const loadState = useMemo<WorkerLoadState>(() => {
    if (query.data?.status === "loaded") return query.data;
    const lastLoaded = lastLoadedRef.current;
    if (lastLoaded) return lastLoaded;
    // Nothing has ever loaded, so the transient state is all there is to show.
    return query.data?.status === "connecting" ? { status: "connecting" } : { status: "loading" };
  }, [query.data]);

  const refetch = useMemo(
    () => () => {
      void query.refetch();
    },
    [query],
  );

  return {
    loadState,
    // Errors describe the latest attempt; a reconnect must not resurrect the
    // errors of an attempt that has since been superseded.
    hostErrors:
      query.data?.status === "loaded"
        ? query.data.hostErrors
        : (lastLoadedRef.current?.hostErrors ?? []),
    refetch,
    isRefetching: query.isRefetching,
  };
}

export type { AggregatedWorker, WorkerHostError, WorkerTemplateOption };
