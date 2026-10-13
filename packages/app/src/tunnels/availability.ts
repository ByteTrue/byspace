import { useSessionStore } from "@/stores/session-store";
import { selectHostFeature } from "@/runtime/host-features";

/**
 * Whether daemon tunnels exist anywhere the user is connected.
 *
 * The tunnels feature is the RPC surface (tunnel.list/open/create/remove and the
 * `daemon.tunnel` config field), which a host only has from v0.20.0. Gating on
 * it is what keeps an older host from offering a Tunnels entry whose Enable
 * button patches a config field that daemon drops without an error: the app
 * would report success and the card would never change. See
 * docs/protocol-compatibility.md.
 *
 * The global surfaces (sidebar entry, command center action) have no single host
 * to ask, so this answers "any connected host", which is the union of every host
 * whose own screen would be usable. A per-host surface uses
 * `useHostFeature(serverId, "daemonTunnels")` directly.
 *
 * This is not the experimental switch: a supported host with
 * `daemon.tunnel.enabled === false` still advertises the feature and keeps its
 * Tunnels entry, and the screen reads that config to show its Enable card.
 */
export function useTunnelsAvailable(): boolean {
  return useSessionStore((state) => {
    const serverIds = Object.keys(state.sessions);
    return serverIds.some((serverId) => selectHostFeature(state, serverId, "daemonTunnels"));
  });
}
