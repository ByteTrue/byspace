import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import {
  fetchAggregatedTunnels,
  tunnelsQueryBaseKey,
  type AggregatedTunnelEntry,
  type TunnelLoadState,
} from "@/tunnels/aggregated-tunnels";

export type { AggregatedTunnelEntry, TunnelLoadState } from "@/tunnels/aggregated-tunnels";

export function useTunnels(): {
  loadState: TunnelLoadState;
  refetch: () => void;
} {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // Connection statuses live in the query key (same contract as useSchedules):
  // a cold deep-link would otherwise cache the aggregate's {status:"connecting"}
  // result and nothing would refetch once a host actually connects.
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );
  const query = useFetchQuery({
    queryKey: [...tunnelsQueryBaseKey, [...serverIds].sort().join("|"), connectionStatusKey],
    queryFn: () =>
      fetchAggregatedTunnels({
        hosts: hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
        runtime,
      }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  if (query.data?.status === "connecting") {
    return { loadState: { status: "connecting" }, refetch: query.refetch };
  }
  if (query.data?.status === "loaded") {
    return { loadState: { status: "loaded", data: query.data.data }, refetch: query.refetch };
  }
  return { loadState: { status: "loading" }, refetch: query.refetch };
}
