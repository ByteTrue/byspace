// The space the pills above the composer (shadcn outline Buttons, 32px) keep around them.
import { SPACING } from "@/styles/theme";

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
