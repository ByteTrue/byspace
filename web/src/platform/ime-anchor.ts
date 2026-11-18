import { isWailsDesktopContainer } from "@/platform/wails";

/**
 * Windows/WebView2 drops the IME caret anchor after an interactive window resize and after the
 * window is deactivated and reactivated (alt+tab): the TSF text store loses the caret layout,
 * GetTextExt fails, and the IME candidate window falls back to the screen origin (top-left) while
 * the caret itself still works. Clicking elsewhere heals it. Upstream:
 * MicrosoftEdge/WebView2Feedback#5675. Heal it by re-anchoring the focused editable element
 * (blur -> 60ms -> focus) after a resize settles or the window is activated, which makes
 * WebView2 re-query the caret. Shorter delays measurably fail (sync blur+focus, setTimeout(0)),
 * so 60ms is the floor.
 */

const RESIZE_SETTLE_MS = 120;
const REFOCUS_DELAY_MS = 60;
// Clicking a node inside a contenteditable editor targets a descendant, so resolve the host.
const EDITABLE_SELECTOR = "input, textarea, [contenteditable]";
// WebView2 does not dispatch a DOM window focus event on alt+tab (Wails restores native focus
// through MoveFocus, but the page gets no focus event and the TSF caret layout stays stale), so
// the desktop shell forwards native window activation instead.
const WINDOW_FOCUS_EVENT = "byspace:window-focus";

interface WailsEvents {
  On?: (name: string, callback: () => void) => () => void;
}
type WailsWindow = Window & { wails?: { Events?: WailsEvents } };

export interface EditableState {
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
  range: Range | null;
  scrollTop: number;
  scrollLeft: number;
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

function focusIsLost(el: Element | null): boolean {
  return !el || el === document.body || el === document.documentElement;
}

/** Snapshot everything a blur/focus round trip could disturb. */
export function saveEditableState(el: HTMLElement): EditableState {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return {
      start: el.selectionStart,
      end: el.selectionEnd,
      direction: el.selectionDirection,
      range: null,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
  }
  const range = window.getSelection()?.rangeCount
    ? window.getSelection()!.getRangeAt(0).cloneRange()
    : null;
  return {
    start: null,
    end: null,
    direction: null,
    range,
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
  };
}

/** Put the selection and scroll back exactly where they were before the re-anchor. */
export function restoreEditableState(el: HTMLElement, state: EditableState): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (state.start !== null && state.end !== null) {
      el.setSelectionRange(state.start, state.end, state.direction ?? "none");
    }
  } else if (state.range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(state.range);
  }
  el.scrollTop = state.scrollTop;
  el.scrollLeft = state.scrollLeft;
}

export function isWindowsWailsWebview(ua: string, wailsDesktop: boolean): boolean {
  return wailsDesktop && /windows/i.test(ua);
}

/**
 * Installs the guard. No-op everywhere but the Windows desktop client; safe to call from the
 * browser entry. Returns a disposer for tests.
 */
export function installImeAnchorGuard(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!isWindowsWailsWebview(window.navigator.userAgent, isWailsDesktopContainer())) {
    return () => {};
  }

  let composing = false;
  let pendingAfterCompose = false;
  let settleTimer: number | undefined;
  let refocusTimer: number | undefined;
  let cancelRefocus: (() => void) | undefined;
  let interrupted: { el: HTMLElement; state: EditableState } | undefined;
  // WebView2 can drop DOM focus entirely when the window is deactivated; remember the last
  // editor so returning to the window can put focus back where the user left it.
  let lastEditable: HTMLElement | undefined = isEditable(document.activeElement)
    ? document.activeElement
    : undefined;

  // This is a native WebView caret reset, not the user leaving an editor. Keep React's
  // focusout/blur handlers (rename commits, draft cancellation) out of this round trip.
  // DOM focus changes dispatch synchronously, so the suppression lasts only for the call.
  const withoutFocusEvents = (callback: () => void) => {
    const suppress = (event: Event) => {
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    for (const type of ["blur", "focus", "focusin", "focusout"]) {
      window.addEventListener(type, suppress, true);
    }
    try {
      callback();
    } finally {
      for (const type of ["blur", "focus", "focusin", "focusout"]) {
        window.removeEventListener(type, suppress, true);
      }
    }
  };

  // React listens to focusin (and focusout for the paired blur). The native events above
  // are suppressed, so publish only the settled focus transition to React, not a commit-on-blur.
  const notifyFocus = (el: HTMLElement) => {
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: null }));
  };

  const reanchor = (fallback?: { el: HTMLElement; state: EditableState }) => {
    cancelRefocus?.();
    const active = document.activeElement;
    const focusLost = focusIsLost(active);
    let el: HTMLElement | null = null;
    if (isEditable(active)) el = active;
    else if (focusLost) el = fallback?.el ?? null;
    if (!isEditable(el)) return;
    const state = active === el ? saveEditableState(el) : fallback?.state;
    if (!state) return;
    if (composing) {
      interrupted = { el, state };
      pendingAfterCompose = true;
      return;
    }
    const restoreFocus = () => {
      cancelRefocus?.();
      if (document.activeElement !== document.body) return;
      interrupted = undefined;
      if (!el.isConnected || !isEditable(el)) return;
      withoutFocusEvents(() => el.focus({ preventScroll: true }));
      notifyFocus(el);
      // Focus handlers may select the value (rename, numeric settings). The caret the
      // user had before resize wins over those initial-focus conveniences.
      restoreEditableState(el, state);
    };
    const restoreFocusForInput = () => {
      if (document.activeElement !== document.body) return;
      // Native focus must return before this key is dispatched; restoring the old
      // selection and React's state happens in the bubble phase after the input.
      withoutFocusEvents(() => el.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", restoreFocusForInput, true);
    window.addEventListener("keydown", restoreFocus);
    const cancelOnUserIntent = () => {
      interrupted = undefined;
      window.clearTimeout(refocusTimer);
      refocusTimer = undefined;
      cancelRefocus = undefined;
      window.removeEventListener("pointerdown", cancelOnUserIntent, true);
      window.removeEventListener("mousedown", cancelOnUserIntent, true);
      window.removeEventListener("keydown", restoreFocusForInput, true);
      window.removeEventListener("keydown", restoreFocus);
      document.removeEventListener("focusin", cancelOnUserIntent, true);
    };
    cancelRefocus = cancelOnUserIntent;
    interrupted = { el, state };
    window.addEventListener("pointerdown", cancelOnUserIntent, true);
    window.addEventListener("mousedown", cancelOnUserIntent, true);
    document.addEventListener("focusin", cancelOnUserIntent, true);
    withoutFocusEvents(() => el.blur());
    refocusTimer = window.setTimeout(restoreFocus, REFOCUS_DELAY_MS);
  };

  const scheduleReanchor = (
    delay: number,
    fallback?: { el: HTMLElement; state: EditableState },
  ) => {
    cancelRefocus?.();
    window.clearTimeout(refocusTimer);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      reanchor(fallback);
    }, delay);
  };

  const onResize = () => {
    const pending = interrupted;
    scheduleReanchor(RESIZE_SETTLE_MS, pending);
  };

  // Reactivation loses the same TSF caret layout as a resize. Heal right away, and refocus the
  // editor if WebView2 dropped DOM focus while the window was in the background.
  const onWindowFocus = () => {
    const active = document.activeElement;
    const fallbackEl = focusIsLost(active) && lastEditable?.isConnected ? lastEditable : undefined;
    scheduleReanchor(
      0,
      fallbackEl ? { el: fallbackEl, state: saveEditableState(fallbackEl) } : undefined,
    );
  };

  // Clicking non-focusable content (the message stream, a toolbar) moves focus to body without
  // touching an editable, so a stale editor must not be refocused on the next window activation.
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target.closest(EDITABLE_SELECTOR) : null;
    lastEditable = target instanceof HTMLElement && isEditable(target) ? target : undefined;
  };

  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Element && isEditable(event.target)) lastEditable = event.target;
  };

  const onCompositionStart = () => {
    composing = true;
    // The native composition may start in the 60ms gap before the scheduled focus
    // restoration. It is continued input, not the user choosing another editor.
    if (interrupted && refocusTimer !== undefined) {
      const pending = interrupted;
      cancelRefocus?.();
      window.clearTimeout(refocusTimer);
      reanchor(pending);
    }
  };
  const onCompositionEnd = () => {
    composing = false;
    if (pendingAfterCompose) {
      pendingAfterCompose = false;
      reanchor(interrupted);
    }
  };

  let offWindowFocus: (() => void) | undefined;
  // The app bundle can execute before /wails/runtime.js (both are module scripts, and the
  // runtime is injected after the bundle), so attach now when it is already there and again on
  // load, by which point every module script has run.
  const attachWindowFocus = () => {
    if (offWindowFocus) return;
    offWindowFocus = (window as WailsWindow).wails?.Events?.On?.(WINDOW_FOCUS_EVENT, onWindowFocus);
  };
  attachWindowFocus();
  window.addEventListener("load", attachWindowFocus);

  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("compositionstart", onCompositionStart);
  document.addEventListener("compositionend", onCompositionEnd);
  return () => {
    offWindowFocus?.();
    window.removeEventListener("load", attachWindowFocus);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("compositionstart", onCompositionStart);
    document.removeEventListener("compositionend", onCompositionEnd);
    window.clearTimeout(settleTimer);
    window.clearTimeout(refocusTimer);
    interrupted = undefined;
    cancelRefocus?.();
  };
}
