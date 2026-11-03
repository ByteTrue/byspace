import { useSyncExternalStore } from "react";

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

let lastDimensions = { width: 0, height: 0, scale: 1, fontScale: 1 };
function readDimensions() {
  const { innerWidth: width, innerHeight: height, devicePixelRatio: scale } = window;
  if (
    width !== lastDimensions.width ||
    height !== lastDimensions.height ||
    scale !== lastDimensions.scale
  ) {
    lastDimensions = { width, height, scale, fontScale: 1 };
  }
  return lastDimensions;
}

/** The window's size and device pixel ratio, re-read on resize. */
export function useWindowDimensions() {
  return useSyncExternalStore(subscribeResize, readDimensions, readDimensions);
}
