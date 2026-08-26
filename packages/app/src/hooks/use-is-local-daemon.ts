import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useHosts } from "@/runtime/host-runtime";

const DESKTOP_DAEMON_SERVER_ID_QUERY_KEY = ["desktop-daemon-server-id"] as const;

function isLoopbackEndpoint(endpoint: string): boolean {
  const host = endpoint
    .trim()
    .replace(/^wss?:\/\//, "")
    .split(/[/:]/, 1)[0]
    ?.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function useLoopbackDaemonServerId(): string | null {
  const hosts = useHosts();
  return useMemo(
    () =>
      hosts.find((host) =>
        host.connections.some(
          (connection) =>
            connection.type === "directTcp" && isLoopbackEndpoint(connection.endpoint),
        ),
      )?.serverId ?? null,
    [hosts],
  );
}

function useLocalDaemonServerIdQuery() {
  const isDesktopApp = shouldUseDesktopDaemon();
  return useQuery({
    queryKey: DESKTOP_DAEMON_SERVER_ID_QUERY_KEY,
    queryFn: async () => {
      const status = await getDesktopDaemonStatus();
      const serverId = status.serverId.trim();
      return { serverId: serverId.length > 0 ? serverId : null };
    },
    enabled: isDesktopApp,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: (query) => (query.state.data?.serverId ? false : 1000),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLocalDaemonServerId(): string | null {
  const isDesktopApp = shouldUseDesktopDaemon();
  const loopbackServerId = useLoopbackDaemonServerId();
  const query = useLocalDaemonServerIdQuery();
  return isDesktopApp ? (query.data?.serverId ?? null) : loopbackServerId;
}

export type LocalDaemonServerIdState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "resolved"; serverId: string | null };

export function useLocalDaemonServerIdState(): LocalDaemonServerIdState {
  const isDesktopApp = shouldUseDesktopDaemon();
  const loopbackServerId = useLoopbackDaemonServerId();
  const query = useLocalDaemonServerIdQuery();

  if (!isDesktopApp) {
    return { status: "resolved", serverId: loopbackServerId };
  }
  if (query.isError) {
    return { status: "error" };
  }
  if (query.isSuccess) {
    return { status: "resolved", serverId: query.data.serverId };
  }
  return { status: "loading" };
}

export function useIsLocalDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const localServerId = useLocalDaemonServerId();
  return (
    localServerId !== null && normalizedServerId.length > 0 && localServerId === normalizedServerId
  );
}
