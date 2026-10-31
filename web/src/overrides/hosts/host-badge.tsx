// Override of packages/app/src/hosts/host-badge.tsx: a server glyph in the host's colour, with the
// host name beside it when the badge shows a label.
import { useMemo } from "react";
import { Server } from "lucide-react";
import type { HostBadgeModel } from "@/hosts/appearance";
import { identityForeground } from "@/styles/identity-colors";
import { useResolvedColorScheme } from "~/app/color-scheme";

export const HOST_BADGE_ICON_SIZE = 12;

export function HostBadge({ badge }: { badge: HostBadgeModel }) {
  const scheme = useResolvedColorScheme();
  const color = badge.color === "none" ? undefined : identityForeground(badge.color, scheme);
  const style = useMemo(() => (color ? { color } : undefined), [color]);
  return (
    <span
      className="flex min-w-3 shrink-[100] items-center gap-[3px] text-muted-foreground"
      data-testid={`host-badge-${badge.serverId}`}
      aria-label={badge.label}
      style={style}
    >
      <Server size={HOST_BADGE_ICON_SIZE} className="shrink-0" />
      {badge.showLabel ? (
        <span className="min-w-0 shrink truncate text-xs leading-4">{badge.label}</span>
      ) : null}
    </span>
  );
}
