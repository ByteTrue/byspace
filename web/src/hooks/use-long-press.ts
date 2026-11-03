import { useCallback, useEffect, useRef, type PointerEvent } from "react";

// react-native's Pressable: delayLongPress defaults to 500ms, and a press that moves more than 10px
// is no longer a long press.
const DEFAULT_DELAY_MS = 500;
const SLOP_PX = 10;
// Marks a press an inner element already tracks, so a trigger around it (a list's background menu
// around a row's) does not long-press too: the innermost Pressable owned a press in the Expo app.
const claimedPresses = new WeakSet<Event>();

/** Swallows the click that ends a long press, so the press does not also activate what it held. */
function swallowNextClick() {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  // The next press starts with a pointerdown; whatever click follows it is a real one.
  const stop = () => {
    document.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerdown", stop, true);
  };
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerdown", stop, true);
}

/**
 * Pressable's onLongPress on the DOM: a primary press held still for `delayMs` calls back with its
 * pointer type, and the click that releases it is swallowed. Spread the handlers on the element.
 */
export function useLongPress(
  onLongPress: ((pointerType: string) => void) | undefined,
  delayMs = DEFAULT_DELAY_MS,
) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    originRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const enabled = Boolean(onLongPress);
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      cancel();
      if (!enabled || event.button !== 0 || claimedPresses.has(event.nativeEvent)) return;
      claimedPresses.add(event.nativeEvent);
      const pointerType = event.pointerType;
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        originRef.current = null;
        swallowNextClick();
        callbackRef.current?.(pointerType);
      }, delayMs);
    },
    [cancel, delayMs, enabled],
  );
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > SLOP_PX) {
        cancel();
      }
    },
    [cancel],
  );
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}
