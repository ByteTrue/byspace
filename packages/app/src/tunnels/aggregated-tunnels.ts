import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { TunnelEntry } from "@bytetrue/protocol/messages";

export const tunnelsQueryBaseKey = ["tunnels"] as const;

export interface TunnelRuntime {
  getClient(serverId: string): Pick<DaemonClient, "listTunnels"> | null;
  getSnapshot(serverId: string): { connectionStatus: string } | null | undefined;
}

/** A tunnel entry tagged with the host it came from. */
export interface AggregatedTunnelEntry extends TunnelEntry {
  serverId: string;
  serverName: string;
}

export type TunnelLoadState =
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "loaded"; data: AggregatedTunnelEntry[] };

export interface TunnelHostInput {
  serverId: string;
  serverName: string;
}

/**
 * Fetch tunnel entries across connected hosts. Tunnels are a daemon-level
 * feature (issue 062); the local (loopback) daemon is the natural target but
 * the fetch follows the same per-host aggregation as schedules so remote
 * daemons with inbound tunnels show up too.
 */
export async function fetchAggregatedTunnels(input: {
  hosts: readonly TunnelHostInput[];
  runtime: TunnelRuntime;
}): Promise<TunnelLoadState> {
  const hasSettlingHost = input.hosts.some(
    (host) => input.runtime.getSnapshot(host.serverId)?.connectionStatus === "connecting",
  );
  const hasAskableHost = input.hosts.some(
    (host) =>
      input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online" &&
      input.runtime.getClient(host.serverId),
  );

  if (!hasAskableHost && hasSettlingHost) {
    return { status: "connecting" };
  }

  const results = await Promise.all(
    input.hosts.map(async (host) => {
      const client = input.runtime.getClient(host.serverId);
      if (!client) return null;
      if (input.runtime.getSnapshot(host.serverId)?.connectionStatus !== "online") {
        return null;
      }
      try {
        const response = await client.listTunnels();
        return response.entries.map((entry) =>
          Object.assign(entry, {
            serverId: host.serverId,
            serverName: host.serverName,
          }),
        );
      } catch {
        return null;
      }
    }),
  );

  const data = results.flatMap((entries) => entries ?? []);
  return { status: "loaded", data };
}
