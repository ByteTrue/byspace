import { useEffect, useState } from "react";
import { useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

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

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 72;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 36;

export const WAILS_DRAG_DATA_SET = { wailsDrag: "true" } as const;

function isMacWailsDesktopWindow(): boolean {
  if (!isWeb || typeof window === "undefined") {
    return false;
  }
  const isWailsOrigin =
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window;
  if (!isWailsOrigin) {
    return false;
  }
  return /Mac/i.test(window.navigator?.platform ?? "");
}

function isMacWindowFullscreen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (document.fullscreenElement) {
    return true;
  }
  return (
    window.outerWidth > 0 &&
    window.outerHeight > 0 &&
    window.innerWidth === window.screen?.width &&
    window.innerHeight === window.screen?.height
  );
}

/**
 * Returns the horizontal inset (in px) needed to clear the macOS traffic-light window controls
 * when running inside the Wails macOS desktop app with MacTitleBarHiddenInset.
 * Returns 0 on web browsers, Windows/Linux/Android, and when the macOS window is in full screen.
 */
export function useMacTrafficLightInset(): number {
  const [inset, setInset] = useState<number>(() =>
    isMacWailsDesktopWindow() && !isMacWindowFullscreen() ? DESKTOP_TRAFFIC_LIGHT_WIDTH : 0,
  );

  useEffect(() => {
    if (!isMacWailsDesktopWindow()) {
      return;
    }
    const update = () => {
      setInset(isMacWindowFullscreen() ? 0 : DESKTOP_TRAFFIC_LIGHT_WIDTH);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return inset;
}

// Custom desktop window controls (minimize/maximize/close) — top-right
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = HEADER_INNER_HEIGHT;

/**
 * Reactive hook — re-renders the component when the breakpoint changes.
 * Always use this instead of reading UnistylesRuntime.breakpoint directly.
 */
export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
