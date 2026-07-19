import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";

function isLoopbackEndpoint(endpoint: string): boolean {
  const host = endpoint
    .trim()
    .replace(/^wss?:\/\//, "")
    .split(/[/:]/, 1)[0]
    ?.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function useLocalDaemonServerId(): string | null {
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
