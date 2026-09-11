import { Platform } from "react-native";

// Electron desktop wrapper retired (issue 025, 2026-09). Web is the only JS
// runtime with a DOM, so the Electron gates below are compile-time dead and
// kept only as named exports to limit churn at call sites.

// ---------------------------------------------------------------------------
// Runtime environment constants
//
// These are the ONLY platform gates in the app. See CLAUDE.md for the
// decision matrix on when to use each one.
//
// Default is cross-platform. Gate only when you must:
//   isWeb      → DOM APIs (document, window, <div>, addEventListener)
//   isNative   → Native-only APIs (Haptics, StatusBar, push tokens, camera)
//   isDev      → Development-only diagnostics and instrumentation
//   isElectron → Retired; always false. Dead branches are being removed over time.
//
// For layout decisions, use useIsCompactFormFactor() from constants/layout.ts.
// For hover-tracking, see docs/hover.md — the short answer is `onPointerEnter`/
// `onPointerLeave` on a plain `View`, with any press behavior on a separate
// inner `Pressable`. No platform gate needed.
// ---------------------------------------------------------------------------

/** Browser or Electron — the JS runtime has access to the DOM. */
export const isWeb = Platform.OS === "web";

/** iOS or Android — the JS runtime is React Native. */
export const isNative = Platform.OS !== "web";

/** Development build/runtime — true in Metro dev bundles, false in production. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

// ---------------------------------------------------------------------------
// Electron detection (retired — always false)
// ---------------------------------------------------------------------------

/** Running inside the Electron desktop wrapper (any OS). Retired: always false. */
export function getIsElectron(): boolean {
  return false;
}

/** Running inside the Electron desktop wrapper on macOS. Retired: always false. */
export function getIsElectronMac(): boolean {
  return false;
}
