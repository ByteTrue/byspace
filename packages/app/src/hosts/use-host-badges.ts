import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { selectHostBadges, type HostBadgeModel } from "@/hosts/appearance";

export function useHostBadges({
  enabled,
}: {
  enabled: boolean;
}): ReadonlyMap<string, HostBadgeModel> {
  const hosts = useHosts();
  return useMemo(() => selectHostBadges({ hosts, enabled }), [enabled, hosts]);
}
