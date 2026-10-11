import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeClientReadyKey,
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
  // The status alone is not enough: a host reads "online" a tick before its
  // client is attached, and the aggregate refuses to answer in that window. If
  // the key did not change when the client lands, that non-answer would be
  // cached for good (issue 076).
  const clientReadyKey = useHostRuntimeClientReadyKey(serverIds);
  const query = useFetchQuery({
    queryKey: [
      ...tunnelsQueryBaseKey,
      [...serverIds].sort().join("|"),
      connectionStatusKey,
      clientReadyKey,
    ],
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
