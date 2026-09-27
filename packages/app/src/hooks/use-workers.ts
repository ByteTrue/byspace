import { useMemo, useRef, useSyncExternalStore } from "react";
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

export function workersQueryKey(serverIds: readonly string[], statuses?: readonly string[]) {
  return [
    ...workersQueryBaseKey,
    [...serverIds].sort().join("|"),
    // The status digest is what makes a host coming online re-key the query.
    // Without it the key is only the host list, which does not change on a
    // reconnect, and the roster serves its cached "still connecting" answer
    // until something else happens to invalidate it.
    ...(statuses ? [[...statuses].sort().join("|")] : []),
  ] as const;
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
/**
 * The connection status of each host, in the order of the ids given.
 *
 * One subscription over all hosts rather than one hook per host: hooks cannot
 * run in a loop over a dynamic list, and the store already has a global
 * listener for exactly this shape. The snapshot is recomputed on any host's
 * change, so a host coming online is seen the moment the store sees it.
 */
function useHostStatuses(serverIds: readonly string[]): string[] {
  const store = getHostRuntimeStore();
  const statuses = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    () =>
      serverIds
        .map((serverId) => store.getSnapshot(serverId)?.connectionStatus ?? "unknown")
        .join("|"),
    () =>
      serverIds
        .map((serverId) => store.getSnapshot(serverId)?.connectionStatus ?? "unknown")
        .join("|"),
  );
  return useMemo(() => statuses.split("|"), [statuses]);
}

export function useWorkers(): UseWorkersResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<WorkerHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);

  // One reactive read per host. getSnapshot(serverId) without this hook is a
  // plain function call: nothing subscribes, and a status change never
  // re-renders — which is exactly how the roster ended up on a 2-second
  // self-healing poll instead of reacting to a host coming back.
  const statuses = useHostStatuses(serverIds);
  const statusDigest = useMemo(() => statuses.join("|"), [statuses]);

  const query = useFetchQuery({
    queryKey: workersQueryKey(serverIds, statusDigest ? [statusDigest] : undefined),
    queryFn: () => fetchAggregatedWorkers({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
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
