import { useEffect, useState } from "react";

// Whether this user can hover and point precisely: a touch tablet can run the desktop layout,
// so only the media query answers it.
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function getFinePointerQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(FINE_POINTER_QUERY);
}

/** True when a mouse-like pointer drives the UI. Always false on native. */
export function hasFinePointer(): boolean {
  return getFinePointerQueryList()?.matches ?? false;
}

/**
 * Reactive `hasFinePointer()` — re-renders when the user switches between a
 * mouse and touch (detachable keyboards, tablet mode).
 */
export function useHasFinePointer(): boolean {
  const [finePointer, setFinePointer] = useState(hasFinePointer);

  useEffect(() => {
    const mediaQuery = getFinePointerQueryList();
    if (!mediaQuery) return;
    const handleChange = () => setFinePointer(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
    };
  }, []);

  return finePointer;
}
