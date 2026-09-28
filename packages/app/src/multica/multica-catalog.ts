import { useMemo } from "react";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

/**
 * The two slow-changing directories the multica surfaces share: agent names
 * (so ids render as people) and the status catalog (so statuses render with
 * their names and colors). One query each, long stale time.
 */
export function useMulticaCatalog(serverId: string): {
  agentNameById: ReadonlyMap<string, string>;
  /** The roster the assignee filter chips render from. */
  agents: readonly { id: string; name: string }[];
  statuses: readonly import("@bytetrue/protocol/multica/rpc-schemas").MulticaStatusSummary[];
} {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";

  const agentsQuery = useFetchQuery({
    queryKey: ["multicaAgents", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAgentList({ includeSystem: true });
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const agents = useMemo(
    () =>
      (agentsQuery.data?.agents ?? [])
        .filter((agent) => agent.kind !== "system")
        .map((agent) => ({ id: agent.id, name: agent.name })),
    [agentsQuery.data],
  );

  const statusesQuery = useFetchQuery({
    queryKey: ["multicaStatuses", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaStatusList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 60_000,
  });

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data?.agents ?? []) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agentsQuery.data]);

  return { agentNameById, agents, statuses: statusesQuery.data?.statuses ?? [] };
}
