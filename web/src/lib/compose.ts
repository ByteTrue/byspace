import type { Ref, RefCallback } from "react";

/** Runs both handlers, ours after the caller's, unless the caller prevented the default. */
export function composeHandlers<E extends { defaultPrevented?: boolean }>(
  theirs: ((event: E) => void) | undefined,
  ours: ((event: E) => void) | undefined,
): ((event: E) => void) | undefined {
  if (!theirs) return ours;
  if (!ours) return theirs;
  return (event) => {
    theirs(event);
    if (!event.defaultPrevented) ours(event);
  };
}

/** One ref callback that feeds every given ref. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}
