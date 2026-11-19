// Port of archive/expo-app:packages/app/src/constants/layout.ts. The compact breakpoint itself
// lives in @/platform/use-compact-form-factor and is re-exported here for the app's callers.

export const FOOTER_HEIGHT = 75;

// Shared header inner height (excluding safe area insets and border)
// Used by both agent header (ScreenHeader) and explorer sidebar header
// This ensures both headers have the same visual height
export const HEADER_INNER_HEIGHT = 36;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
export const HEADER_TOP_PADDING_MOBILE = 8;

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 820;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

// Settings uses the canonical desktop list + detail layout. Its sidebar and
// detail target must fit together before it can share width with app navigation.
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 320;
export const SETTINGS_DESKTOP_DETAIL_MIN_WIDTH = 400;
export const SETTINGS_DESKTOP_SPLIT_MIN_WIDTH =
  SETTINGS_DESKTOP_SIDEBAR_WIDTH + SETTINGS_DESKTOP_DETAIL_MIN_WIDTH;

/**
 * Reactive hook — re-renders the component when the breakpoint changes.
 */
export { useIsCompactFormFactor } from "@/platform/use-compact-form-factor";

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
// shortcut: always true now that every build is a browser; the no-split fallbacks behind it
// (workspace-screen's shouldRenderDesktopPaneFallback, the explorer dock presentation) are
// unreachable. Delete them with this the next time pane splits change.
export function supportsDesktopPaneSplits(): boolean {
  return true;
}
