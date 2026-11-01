// Override of packages/app/src/lib/overlay-root.ts: the same module, plus the web's Radix layers.
// The shortcut engine asks this module whether an overlay owns the keyboard, but menus, dialogs,
// popovers and sheets here are Radix layers that never join the Expo overlay registry. Without
// this, Escape that closes a menu on Settings also left Settings, and in a workspace it fell
// through to "interrupt agent".
import {
  dispatchTopWebOverlayKeyDown as dispatchRegisteredOverlayKeyDown,
  hasActiveWebOverlay as hasRegisteredWebOverlay,
} from "../../../../packages/app/src/lib/overlay-root";

export {
  getOverlayRoot,
  OVERLAY_Z,
  OverlayLayerProvider,
  useCurrentOverlayLayer,
  useGlobalWebOverlayLayer,
  useOverlayLayer,
  useWebOverlayRegistration,
  WEB_SURFACE_PLANE,
} from "../../../../packages/app/src/lib/overlay-root";

// Open Radix layers that dismiss on Escape themselves. Tooltips are left out: as in the Expo app,
// a tooltip does not take Escape from the app.
const OPEN_RADIX_LAYER = [
  '[role="menu"][data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(",");

function hasOpenRadixLayer(): boolean {
  return typeof document !== "undefined" && document.querySelector(OPEN_RADIX_LAYER) !== null;
}

export function hasActiveWebOverlay(): boolean {
  return hasRegisteredWebOverlay() || hasOpenRadixLayer();
}

/**
 * A registered overlay keeps first refusal. Otherwise Escape belongs to an open Radix layer: the
 * shortcut engine (a window capture listener) runs before Radix's document listener, so this
 * reports the key as taken and leaves the event for Radix to dismiss the layer.
 */
export function dispatchTopWebOverlayKeyDown(event: KeyboardEvent): boolean {
  if (dispatchRegisteredOverlayKeyDown(event)) return true;
  if (event.isComposing || event.key === "Process") return false;
  return event.key === "Escape" && hasOpenRadixLayer();
}
