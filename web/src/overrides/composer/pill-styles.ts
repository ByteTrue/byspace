// Override of packages/app/src/composer/pill-styles.ts: the clearances are the Expo file's; the
// pill look (32px, md radius, hairline, card fill; muted fill when active) is a class.
import { SPACING } from "@/styles/theme";
import { cn } from "cn";

export const COMPOSER_PILL_CLEARANCE = {
  compact: SPACING[2],
  wide: 10,
} as const;
export const COMPOSER_PILL_MIN_HEIGHT = 32;

export function resolveComposerPillClearance(isCompact: boolean): number {
  return isCompact ? COMPOSER_PILL_CLEARANCE.compact : COMPOSER_PILL_CLEARANCE.wide;
}

export function resolveComposerTrackTailClearance(isCompact: boolean): number {
  const composerClearance = resolveComposerPillClearance(isCompact);
  const transcriptClearance = isCompact ? SPACING[6] : 20;
  return transcriptClearance + COMPOSER_PILL_MIN_HEIGHT + composerClearance;
}

export function resolveComposerTrackControlClearance(isCompact: boolean): number {
  const clearance = resolveComposerPillClearance(isCompact);
  return clearance + COMPOSER_PILL_MIN_HEIGHT + clearance;
}

/**
 * Shared look for the compact pills immediately above the composer. The 32px floor keeps short
 * labels from clamping the radius and pulling the curve's tangent point inward.
 */
export function composerPillClassName(active: boolean, className?: string): string {
  return cn(
    "flex min-h-8 items-center gap-2 rounded-md border px-3 py-1",
    active ? "bg-muted" : "bg-card",
    className,
  );
}

export function composerPillLabelClassName(active: boolean): string {
  return cn("truncate text-xs", active ? "text-foreground" : "text-muted-foreground");
}
