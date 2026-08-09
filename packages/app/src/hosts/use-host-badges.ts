import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { selectHostBadges, type HostBadgeModel } from "@/hosts/appearance";

export function useHostBadges({
  enabled,
}: {
  enabled: boolean;
}): ReadonlyMap<string, HostBadgeModel> {
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  return useMemo(
    () => selectHostBadges({ hosts, localServerId, enabled }),
    [enabled, hosts, localServerId],
  );
}
