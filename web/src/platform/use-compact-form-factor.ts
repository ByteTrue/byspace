// The compact breakpoint is a media query and nothing else: no app state, no feature knowledge.
// It belongs with the other platform primitives, which is what lets the vendored sidebar depend on
// it without reaching into a feature directory.
import { useSyncExternalStore } from "react";

// Below Tailwind's `md`. The .98 avoids matching a 768px-wide viewport that `min-width: 768px`
// also claims, so exactly one of the two sides is true at the boundary.
const COMPACT_QUERY = "(max-width: 767.98px)";

function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const readCompact = () => window.matchMedia(COMPACT_QUERY).matches;

/** Reactive: re-renders the component when the breakpoint changes. */
export function useIsCompactFormFactor(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, readCompact);
}
