import { buildDaemonWebSocketUrl, buildRelayWebSocketUrl } from "@/utils/daemon-endpoints";
import type { HostProfile } from "@/types/host-connection";

/**
 * A paired host that can be the remote end of a tunnel, with the connection
 * material the daemon needs to dial it.
 *
 * Tunnels dial the peer the same way the app does — an embedded DaemonClient
 * over the relay (or a direct ws://) — so the target comes from the host
 * registry entry instead of a pasted pairing link (issue 062).
 */
export interface TunnelPeerTarget {
  serverId: string;
  label: string;
  url: string;
  /** Present for relay connections; the daemon enables E2EE from it. */
  daemonPublicKeyB64?: string;
  /** Peer password when the registry holds one (directTcp connections do). */
  password?: string;
  /** True when the peer is reached over the relay rather than a direct socket. */
  viaRelay: boolean;
}

/**
 * Resolve the connection a tunnel should dial for one paired host, or null when
 * the host has nothing a tunnel can use.
 *
 * Relay first: a host paired through the relay is reachable from anywhere, and
 * the pairing key it carries is what keeps the daemon-to-daemon connection
 * end-to-end encrypted. Direct TCP is the fallback, useful when the peer is on
 * this machine or the same network.
 */
export function resolveTunnelPeerTarget(host: HostProfile): TunnelPeerTarget | null {
  const relay = host.connections.find((connection) => connection.type === "relay");
  if (relay && relay.type === "relay") {
    return {
      serverId: host.serverId,
      label: host.label,
      url: buildRelayWebSocketUrl({
        endpoint: relay.relayEndpoint,
        useTls: relay.useTls ?? true,
        serverId: host.serverId,
      }),
      daemonPublicKeyB64: relay.daemonPublicKeyB64,
      viaRelay: true,
    };
  }

  const direct = host.connections.find((connection) => connection.type === "directTcp");
  if (direct && direct.type === "directTcp") {
    return {
      serverId: host.serverId,
      label: host.label,
      url: buildDaemonWebSocketUrl(direct.endpoint, { useTls: direct.useTls ?? false }),
      ...(direct.password ? { password: direct.password } : {}),
      viaRelay: false,
    };
  }

  return null;
}

/**
 * Every paired host a tunnel can dial, in the order given. Hosts with no usable
 * connection are dropped rather than listed and then rejected on submit.
 */
export function resolveTunnelPeerTargets(hosts: readonly HostProfile[]): TunnelPeerTarget[] {
  return hosts
    .map((host) => resolveTunnelPeerTarget(host))
    .filter((target): target is TunnelPeerTarget => target !== null);
}
