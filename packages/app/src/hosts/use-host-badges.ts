import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { selectHostBadges, type HostBadgeModel } from "@/hosts/appearance";

/**
 * Every host's badge, resolved from the host registry and each host's own appearance. Automatic
 * visibility is applied later by the project row that owns a workspace. `enabled` is the caller's
 * own "off" — a surface with its own reason to hide badges passes false rather than filtering the
 * result, so explicit per-host choices remain authoritative.
 */
export function useHostBadges({
  enabled,
}: {
  enabled: boolean;
}): ReadonlyMap<string, HostBadgeModel> {
  const hosts = useHosts();
  return useMemo(() => selectHostBadges({ hosts, enabled }), [enabled, hosts]);
}
