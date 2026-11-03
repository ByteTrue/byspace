// Port of archive/expo-app:packages/app/src/provider-usage/window-bar.tsx: a usage window's label, percent and
// reset (or run-out) time over a 4px bar in its tone.
import { createContext, useContext } from "react";
import { clampPct, formatPct, formatResetLabel } from "@/provider-usage/format";
import { deriveTone } from "@/provider-usage/tone";
import type { ProviderUsageTone, ProviderUsageWindow } from "@/provider-usage/types";
import { cn } from "cn";
import { Progress } from "~/components/ui/progress";

/** shadcn Progress's indicator in the usage tone. */
export const FILL_TONE: Record<ProviderUsageTone, string> = {
  default: "*:data-[slot=progress-indicator]:bg-muted-foreground",
  ok: "*:data-[slot=progress-indicator]:bg-status-success",
  warning: "*:data-[slot=progress-indicator]:bg-status-warning",
  danger: "*:data-[slot=progress-indicator]:bg-status-danger",
};

/** True inside a tooltip, whose surface is the inverted foreground. */
export const OnTooltipSurface = createContext(false);

/** Text colours on a page, and on the inverted tooltip surface. */
export function useUsageTextTones() {
  const onTooltip = useContext(OnTooltipSurface);
  return onTooltip
    ? { strong: "text-background", muted: "text-background/65", track: "bg-background/20" }
    : { strong: "text-foreground", muted: "text-muted-foreground", track: "bg-accent" };
}

function resolveUsedPct(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
}

export function ProviderUsageWindowBar({ window }: { window: ProviderUsageWindow }) {
  const tones = useUsageTextTones();
  const usedPct = resolveUsedPct(window);
  const tone = window.tone ?? deriveTone(usedPct);
  const fillWidth = clampPct(usedPct ?? 0);
  const isAtRisk = window.runsOutAt != null && window.shortfallPct != null;
  const trailing = isAtRisk
    ? `runs out ${formatResetLabel(window.runsOutAt)?.replace("resets ", "") ?? ""}`.trim()
    : formatResetLabel(window.resetsAt);
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("min-w-0 shrink truncate", tones.muted)}>{window.label}</span>
        <span className={cn("font-medium", tones.strong)}>
          {usedPct != null ? formatPct(usedPct) : "—"}
          {trailing ? (
            <span
              className={cn("font-normal", isAtRisk ? "text-status-danger" : tones.muted)}
            >{` · ${trailing}`}</span>
          ) : null}
        </span>
      </div>
      <Progress value={fillWidth} className={cn(tones.track, FILL_TONE[tone])} />
    </div>
  );
}
