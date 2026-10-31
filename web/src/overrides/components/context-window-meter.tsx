// Override of packages/app/src/components/context-window-meter.tsx: a ring for how full the context
// window is (grey, amber past 70%, red past 90%), a track-only ring while usage is pending, and a
// tooltip with tokens, session cost and the provider's usage.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { cn } from "cn";

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_RADIUS = 5;
const COMPACT_STROKE_WIDTH = 1.75;

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (
    !Number.isFinite(maxTokens) ||
    maxTokens <= 0 ||
    !Number.isFinite(usedTokens) ||
    usedTokens < 0
  )
    return null;
  return (usedTokens / maxTokens) * 100;
}

function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function meterProgressClass(percentage: number): string {
  if (percentage > 90) return "text-destructive";
  if (percentage >= 70) return "text-amber-500";
  return "text-muted-foreground";
}

function getMeterGeometry(showPercentage: boolean, glyphSize?: number) {
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      circumference: 2 * Math.PI * COMPACT_RADIUS,
    };
  }
  const svgSize = glyphSize ?? SVG_SIZE;
  return {
    svgSize,
    radius: (svgSize - 2) / 2,
    strokeWidth: 2,
    circumference: Math.PI * (svgSize - 2),
  };
}

const CONTAINER = "flex h-7 items-center justify-center rounded-full";

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
  showPercentage = false,
  serverId,
  provider,
  pending = false,
  glyphSize,
}: {
  maxTokens: number | null;
  usedTokens: number | null;
  totalCostUsd?: number | null;
  showPercentage?: boolean;
  serverId?: string;
  /** The BySpace provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
  /** Reserve the meter footprint and show a loading ring while usage is pending. */
  pending?: boolean;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
}) {
  const { t } = useTranslation();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    {
      enabled: isTooltipOpen,
    },
  );
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const handleTooltipOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsTooltipOpen(nextOpen);
      if (nextOpen) void refreshProviderUsage().catch(() => {});
    },
    [refreshProviderUsage],
  );
  const { svgSize, radius, strokeWidth, circumference } = getMeterGeometry(
    showPercentage,
    glyphSize,
  );
  const center = svgSize / 2;
  const containerClass = cn(CONTAINER, showPercentage ? "gap-1" : "w-7");
  const track = (
    <circle
      cx={center}
      cy={center}
      r={radius}
      fill="none"
      stroke="var(--surface-3)"
      strokeWidth={strokeWidth}
    />
  );

  // No usage yet: reserve the footprint with a track-only ring while a session is
  // active so the real ring fades in without shifting siblings. Render nothing when
  // no usage is expected.
  if (percentage === null || maxTokens === null || usedTokens === null) {
    if (!pending) return null;
    return (
      <span className={containerClass}>
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          {track}
        </svg>
        {showPercentage ? <span className="h-3.5 w-[22px] rounded-full bg-(--surface-3)" /> : null}
      </span>
    );
  }

  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const roundedPercentage = Math.round(percentage);
  const dashOffset = circumference - (clampedPercentage / 100) * circumference;
  const formattedSessionCost =
    typeof totalCostUsd === "number" ? formatSessionCost(totalCostUsd) : null;
  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          className={containerClass}
          data-testid="context-window-meter"
          role="img"
          aria-label={t("contextWindow.accessibility", { percentage: roundedPercentage })}
        >
          <svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            {track}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              className={meterProgressClass(clampedPercentage)}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          {showPercentage ? (
            <span className="text-sm text-muted-foreground">{`${roundedPercentage}%`}</span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <div className="flex min-w-[200px] flex-col gap-1.5">
          <span>{t("contextWindow.title")}</span>
          <span className="leading-[1.4]">
            {t("contextWindow.used", { percentage: roundedPercentage })}
          </span>
          <span className="text-xs leading-[1.4] text-background/65">
            {t("contextWindow.tokens", {
              used: formatTokenCount(usedTokens),
              max: formatTokenCount(maxTokens),
            })}
          </span>
          {formattedSessionCost ? (
            <span className="text-xs leading-[1.4] text-background/65">
              {t("contextWindow.sessionCost", { cost: formattedSessionCost })}
            </span>
          ) : null}
          <ProviderUsageTooltipSection view={providerUsageView} activeProviderId={provider} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
