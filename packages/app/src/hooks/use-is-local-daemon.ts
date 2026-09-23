import { useMemo } from "react";
import {
  normalizeHostPort,
  normalizeLoopbackToLocalhost,
} from "@bytetrue/protocol/daemon-endpoints";
import { useHosts, useHostRegistryLoaded } from "@/runtime/host-runtime";

function normalizeEndpoint(endpoint: string): string {
  return normalizeLoopbackToLocalhost(normalizeHostPort(endpoint));
}

function browserOriginHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location?.host?.trim();
  return host ? normalizeEndpoint(host) : null;
}

/**
 * The daemon that serves this web UI. The daemon injects its own listen
 * address into the page (`__BYSPACE_INITIAL_DAEMON_CONNECTION__`) and the app
 * bootstraps its registry from it, so "local" means the host whose direct-TCP
 * endpoint is the browser's own origin — the LAN same-origin model from
 * docs/architecture.md.
 */
export function useLocalDaemonServerId(): string | null {
  const hosts = useHosts();
  return useMemo(() => {
    const origin = browserOriginHost();
    if (!origin) return null;
    const match = hosts.find((host) =>
      host.connections.some(
        (connection) =>
          connection.type === "directTcp" && normalizeEndpoint(connection.endpoint) === origin,
      ),
    );
    return match?.serverId ?? null;
  }, [hosts]);
}

export type LocalDaemonServerIdState =
  | { status: "loading" }
  | { status: "resolved"; serverId: string | null };

export function useLocalDaemonServerIdState(): LocalDaemonServerIdState {
  const loaded = useHostRegistryLoaded();
  const serverId = useLocalDaemonServerId();
  if (!loaded) return { status: "loading" };
  return { status: "resolved", serverId };
}

export function useIsLocalDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const localServerId = useLocalDaemonServerId();

  if (localServerId === null || normalizedServerId.length === 0) {
    return false;
  }

  return localServerId === normalizedServerId;
}
