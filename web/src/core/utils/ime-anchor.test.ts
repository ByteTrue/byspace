// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installImeAnchorGuard,
  isWindowsWailsWebview,
  restoreEditableState,
  saveEditableState,
} from "./ime-anchor";

type WailsWindow = Window & { wails?: unknown };

describe("isWindowsWailsWebview", () => {
  it("arms only for the Windows desktop client", () => {
    expect(isWindowsWailsWebview("Mozilla/5.0 (Windows NT 10.0) Chrome/154", true)).toBe(true);
    expect(isWindowsWailsWebview("Mozilla/5.0 (Windows NT 10.0) Chrome/154", false)).toBe(false);
    expect(isWindowsWailsWebview("Mozilla/5.0 (Macintosh) Safari/605", true)).toBe(false);
  });
});

describe("saveEditableState / restoreEditableState", () => {
  it("restores an input's selection and scroll", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    input.setSelectionRange(3, 7);
    input.scrollTop = 40;
    const state = saveEditableState(input);

    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
    restoreEditableState(input, state);

    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(7);
    expect(input.scrollTop).toBe(40);
  });
});

describe("installImeAnchorGuard", () => {
  let input: HTMLInputElement;
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    (window as WailsWindow).wails = {};
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/154",
    );
    input = document.createElement("input");
    input.value = "candidates belong at the caret";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(2, 9);
  });

  afterEach(() => {
    dispose?.();
    input.remove();
    delete (window as WailsWindow).wails;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-anchors the focused editable after a resize settles", () => {
    const blurSpy = vi.spyOn(input, "blur");
    const focusSpy = vi.spyOn(input, "focus");
    dispose = installImeAnchorGuard();

    window.dispatchEvent(new Event("resize"));
    // The debounce must absorb the resize burst before anything happens.
    expect(blurSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(blurSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    // The re-anchor must not disturb the selection.
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(9);
    expect(document.activeElement).toBe(input);
  });

  it("waits for an active composition to end before re-anchoring", () => {
    const blurSpy = vi.spyOn(input, "blur");
    dispose = installImeAnchorGuard();

    document.dispatchEvent(new Event("compositionstart"));
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);
    // Typing with the IME must not be interrupted mid-composition.
    expect(blurSpy).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("compositionend"));
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the focused element is not editable", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    document.body.append(div);
    div.focus();
    const blurSpy = vi.spyOn(input, "blur");
    dispose = installImeAnchorGuard();

    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);
    expect(blurSpy).not.toHaveBeenCalled();
    div.remove();
  });
});
