import { isWailsDesktopContainer } from "@/utils/wails";

/**
 * Windows/WebView2 drops the IME caret anchor after an interactive window resize: the TSF text
 * store loses the caret layout, GetTextExt fails, and the IME candidate window falls back to the
 * screen origin (top-left) while the caret itself still works. Clicking elsewhere heals it.
 * Upstream: MicrosoftEdge/WebView2Feedback#5675. Heal it by re-anchoring the focused editable
 * element (blur -> 60ms -> focus) once the resize settles, which makes WebView2 re-query the
 * caret. Shorter delays measurably fail (sync blur+focus, setTimeout(0)), so 60ms is the floor.
 */

const RESIZE_SETTLE_MS = 120;
const REFOCUS_DELAY_MS = 60;

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
    const el = isEditable(active) ? active : (fallback?.el ?? null);
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

  const onResize = () => {
    const pending = interrupted;
    cancelRefocus?.();
    window.clearTimeout(refocusTimer);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      reanchor(pending);
    }, RESIZE_SETTLE_MS);
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

  window.addEventListener("resize", onResize);
  document.addEventListener("compositionstart", onCompositionStart);
  document.addEventListener("compositionend", onCompositionEnd);
  return () => {
    window.removeEventListener("resize", onResize);
    document.removeEventListener("compositionstart", onCompositionStart);
    document.removeEventListener("compositionend", onCompositionEnd);
    window.clearTimeout(settleTimer);
    window.clearTimeout(refocusTimer);
    interrupted = undefined;
    cancelRefocus?.();
  };
}
