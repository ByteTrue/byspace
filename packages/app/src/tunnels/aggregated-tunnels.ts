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
  // Read each host's view once. The runtime publishes the connection status and
  // the client separately, so two reads in one pass can disagree.
  const views = input.hosts.map((host) => ({
    host,
    snapshot: input.runtime.getSnapshot(host.serverId),
    client: input.runtime.getClient(host.serverId),
  }));

  const hasAskableHost = views.some(
    (view) => view.snapshot?.connectionStatus === "online" && view.client,
  );
  const hasSettlingHost = views.some((view) => isTunnelHostSettling(view.snapshot, view.client));

  if (!hasAskableHost && hasSettlingHost) {
    return { status: "connecting" };
  }

  const results = await Promise.all(
    views.map(async (view) => {
      if (!view.client) return null;
      if (view.snapshot?.connectionStatus !== "online") {
        return null;
      }
      try {
        const response = await view.client.listTunnels();
        return response.entries.map((entry) =>
          Object.assign(entry, {
            serverId: view.host.serverId,
            serverName: view.host.serverName,
          }),
        );
      } catch {
        return null;
      }
    }),
  );

  const data = results.flatMap((entries) => entries ?? []);

  // Nothing to show and a host has not answered yet: that is not an empty
  // answer, it is an unfinished one. Without this the aggregate reports
  // "loaded, no tunnels" whenever one host answers empty while another is
  // still settling, and the caller caches it (issue 076). Schedules carries
  // the same guard for the same reason.
  if (data.length === 0 && hasSettlingHost) {
    return { status: "connecting" };
  }

  return { status: "loaded", data };
}

/**
 * A host whose answer is still coming, so the aggregate must not treat its
 * silence as "no tunnels".
 *
 * The runtime publishes a host's connection status and its client in separate
 * ticks: the status can already read "online" while the client has not been
 * attached to the snapshot yet. Reading that window as an answer caches an
 * empty list, and because the query key is built from the connection statuses,
 * the settled key never changes again — the list stays empty until a reload
 * (issue 076). A missing snapshot means the runtime has no controller for the
 * host yet, which is the same kind of not-yet.
 */
function isTunnelHostSettling(
  snapshot: { connectionStatus: string } | null | undefined,
  client: unknown,
): boolean {
  if (!snapshot) {
    return true;
  }
  if (snapshot.connectionStatus === "connecting" || snapshot.connectionStatus === "idle") {
    return true;
  }
  return snapshot.connectionStatus === "online" && !client;
}
