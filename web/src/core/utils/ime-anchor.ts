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
      range: null,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
  }
  const range = window.getSelection()?.rangeCount
    ? window.getSelection()!.getRangeAt(0).cloneRange()
    : null;
  return { start: null, end: null, range, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
}

/** Put the selection and scroll back exactly where they were before the re-anchor. */
export function restoreEditableState(el: HTMLElement, state: EditableState): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (state.start !== null && state.end !== null) {
      el.setSelectionRange(state.start, state.end);
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

  const reanchor = () => {
    const el = document.activeElement;
    if (!isEditable(el)) return;
    if (composing) {
      pendingAfterCompose = true;
      return;
    }
    const state = saveEditableState(el);
    el.blur();
    refocusTimer = window.setTimeout(() => {
      refocusTimer = undefined;
      el.focus({ preventScroll: true });
      restoreEditableState(el, state);
    }, REFOCUS_DELAY_MS);
  };

  const onResize = () => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      reanchor();
    }, RESIZE_SETTLE_MS);
  };

  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = () => {
    composing = false;
    if (pendingAfterCompose) {
      pendingAfterCompose = false;
      reanchor();
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
  };
}
