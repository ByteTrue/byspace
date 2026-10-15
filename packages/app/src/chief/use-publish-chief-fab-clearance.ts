import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useWindowDimensions, type View } from "react-native";
import { resolveChiefFabClearance, useChiefFabClearanceStore } from "./chief-fab-clearance";

/**
 * Publishes where a surface sits relative to the entry's corner, so the entry
 * can rest above it instead of on top of it. Returns the ref to attach to the
 * surface and the handler to attach to its onLayout.
 *
 * `active` mirrors the host's visibility: a retained panel keeps rendering
 * offscreen, and nothing it measures belongs to the screen.
 */
export function usePublishChiefFabClearance(input: { ownerId: string; active: boolean }): {
  frameRef: RefObject<View | null>;
  reportLayout: () => void;
} {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const { ownerId, active } = input;
  const frameRef = useRef<View | null>(null);

  const publish = useCallback(
    (clearance: number | null) => {
      useChiefFabClearanceStore.getState().publish(ownerId, clearance);
    },
    [ownerId],
  );

  const reportLayout = useCallback(() => {
    const frame = frameRef.current;
    if (!active || !frame) {
      publish(null);
      return;
    }
    frame.measureInWindow((left, top, width, height) => {
      if (width <= 0 || height <= 0) {
        publish(null);
        return;
      }
      publish(
        resolveChiefFabClearance({
          frame: { left, top, width, height },
          viewportWidth,
          viewportHeight,
        }),
      );
    });
  }, [active, publish, viewportHeight, viewportWidth]);

  useEffect(() => {
    reportLayout();
    return () => publish(null);
  }, [publish, reportLayout]);

  return { frameRef, reportLayout };
}
