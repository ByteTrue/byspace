// The arithmetic of the Expo app's four panel gestures (mobile-panels/gestures.ts), for the DOM
// runtime in core/mobile-panels/provider.tsx.
import type { MobilePanelView } from "@/stores/panel-store";

export type MobilePanelGestureKind = "open-left" | "close-left" | "open-right" | "close-right";

/** The panel position for a drag of `deltaX` px: the Expo app's per-gesture onUpdate. */
export function mobilePanelGesturePosition(
  kind: MobilePanelGestureKind,
  deltaX: number,
  width: number,
): number {
  const travel = deltaX / width;
  switch (kind) {
    case "open-left":
    case "open-right":
      return -travel;
    case "close-left":
      return -1 - travel;
    case "close-right":
      return 1 - travel;
  }
}

/** Where a released drag settles: past a third of the width, or flicked faster than 500 px/s. */
export function mobilePanelGestureEndTarget(
  kind: MobilePanelGestureKind,
  deltaX: number,
  velocityX: number,
  width: number,
): MobilePanelView {
  const third = width / 3;
  switch (kind) {
    case "open-left":
      return deltaX > third || velocityX > 500 ? "agent-list" : "agent";
    case "close-left":
      return deltaX < -third || velocityX < -500 ? "agent" : "agent-list";
    case "open-right":
      return deltaX < -third || velocityX < -500 ? "file-explorer" : "agent";
    case "close-right":
      return deltaX > third || velocityX > 500 ? "agent" : "file-explorer";
  }
}

/** A CSS-style cubic-bezier easing, as Reanimated's Easing.bezier. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    // Newton's method stalled: bisect.
    let low = 0;
    let high = 1;
    t = x;
    while (high - low > 1e-6) {
      if (sampleX(t) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}
