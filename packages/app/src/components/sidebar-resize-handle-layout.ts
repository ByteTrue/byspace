/**
 * Geometry for the sidebar resize handle.
 *
 * A mouse can grab a hairline, so the pointer variant straddles the sidebar
 * border — half the strip hangs outside the sidebar's own bounds, which is
 * fine because web hit-testing does not clip to the parent box.
 *
 * A coarse browser pointer needs a larger target that stays inside the sidebar.
 * The centered target avoids turning the full-height border into an interactive
 * strip that competes with vertical sidebar scrolling.
 */

export const POINTER_HANDLE_WIDTH = 10;
export const TOUCH_HANDLE_WIDTH = 24;
export const TOUCH_HANDLE_HEIGHT = 88;

/**
 * A finger resting on the grip drifts before it commits. Requiring horizontal
 * intent before the pan activates, and failing it once the drift is mostly
 * vertical, leaves the sidebar's own scrolling reachable through the grip.
 * A mouse press moves less than either threshold, so pointer drags are
 * unaffected.
 */
export const SIDEBAR_RESIZE_ACTIVATION_OFFSET = 6;
export const SIDEBAR_RESIZE_FAIL_OFFSET = 12;

export type SidebarResizeEdge = "left" | "right";
export type SidebarResizeHandleVariant = "pointer" | "coarse";

export interface SidebarResizePanGestureConfig {
  activeOffsetX: [number, number];
  failOffsetY: [number, number];
}

export function resolveSidebarResizeHandleVariant(
  platformIsWeb: boolean,
  finePointer: boolean,
): SidebarResizeHandleVariant {
  return platformIsWeb && !finePointer ? "coarse" : "pointer";
}

export function resolveSidebarResizePanGestureConfig(
  platformIsWeb: boolean,
): SidebarResizePanGestureConfig | null {
  if (!platformIsWeb) return null;
  return {
    activeOffsetX: [-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET],
    failOffsetY: [-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET],
  };
}

export interface SidebarResizeHandleGeometry {
  /**
   * Distance from the sidebar edge to the near side of the hit area. Negative
   * means the hit area overhangs the sidebar, which only touch forbids.
   */
  edgeOffset: number;
  width: number;
  /** `null` stretches the hit area to the sidebar's full height. */
  height: number | null;
}

export function resolveSidebarResizeHandleGeometry(
  finePointer: boolean,
): SidebarResizeHandleGeometry {
  if (finePointer) {
    return {
      edgeOffset: -POINTER_HANDLE_WIDTH / 2,
      width: POINTER_HANDLE_WIDTH,
      height: null,
    };
  }
  return {
    edgeOffset: 0,
    width: TOUCH_HANDLE_WIDTH,
    height: TOUCH_HANDLE_HEIGHT,
  };
}
