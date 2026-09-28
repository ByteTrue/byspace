import { useMemo } from "react";
import {
  normalizeHostPort,
  normalizeLoopbackToLocalhost,
} from "@bytetrue/protocol/daemon-endpoints";
import { useHosts, useHostRegistryLoaded } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";

function normalizeEndpoint(endpoint: string): string {
  return normalizeLoopbackToLocalhost(normalizeHostPort(endpoint));
}

export function browserOriginHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location?.host?.trim();
  if (!host) return null;
  // Default ports (https :443, http :80) are omitted from location.host, but
  // parseHostPort requires an explicit host:port and throws otherwise. Re-attach
  // the implied port so a default-port origin stays comparable instead of
  // crashing the render tree.
  const port = window.location?.port;
  if (port) return normalizeEndpoint(host);
  const defaultPort = window.location?.protocol === "https:" ? 443 : 80;
  return normalizeEndpoint(`${host}:${defaultPort}`);
}

/**
 * Whether a directTcp endpoint addresses the machine the app device runs on:
 * loopback literals only (localhost, 127.0.0.1, 0.0.0.0, ::1, ::) via the
 * shared protocol normalizer. Host names are case-insensitive in DNS, so the
 * comparison is too. An ssh tunnel mapping a remote daemon to a local loopback
 * port also matches here; the consumers are ordering/badge/redirect
 * presentation, and the web platform has no stronger local-machine proof.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    return normalizeEndpoint(endpoint).toLowerCase().startsWith("localhost:");
  } catch {
    // Socket/pipe and other non host:port endpoints are never loopback.
    return false;
  }
}

/** First host whose directTcp endpoint addresses this machine. */
export function resolveLocalDaemonServerId(hosts: HostProfile[]): string | null {
  const match = hosts.find((host) =>
    host.connections.some(
      (connection) => connection.type === "directTcp" && isLoopbackEndpoint(connection.endpoint),
    ),
  );
  return match?.serverId ?? null;
}

/**
 * "The daemon on this machine" — the host with a loopback directTcp endpoint.
 * Deliberately independent of where the web app is open: from cloud web the
 * home daemon still counts as local (issue 058).
 */
export function useLocalDaemonServerId(): string | null {
  const hosts = useHosts();
  return useMemo(() => resolveLocalDaemonServerId(hosts), [hosts]);
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

/**
 * "The daemon serving this page" — the host whose directTcp endpoint equals the
 * browser origin. Only for decisions about the page itself (updating that
 * daemon restarts it and kills the page); never for machine-capability gating
 * (issue 057/058).
 */
function useServingDaemonServerId(): string | null {
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

export function useIsServingDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const servingServerId = useServingDaemonServerId();

  if (servingServerId === null || normalizedServerId.length === 0) {
    return false;
  }

  return servingServerId === normalizedServerId;
}
