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

  it("does not commit an editor's business blur handler during the re-anchor", () => {
    const commit = vi.fn();
    input.addEventListener("blur", commit);
    dispose = installImeAnchorGuard();

    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(180);

    expect(commit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(9);
  });

  it("does not steal focus when the user clicks another editor during the delay", () => {
    const other = document.createElement("input");
    document.body.append(other);
    dispose = installImeAnchorGuard();

    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(120);
    other.dispatchEvent(new Event("mousedown", { bubbles: true }));
    other.focus();
    vi.advanceTimersByTime(60);

    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("cancels an old refocus when another resize begins", () => {
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(120);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(30);
    expect(document.activeElement).toBe(document.body);
    vi.advanceTimersByTime(180);
    expect(document.activeElement).toBe(input);
  });

  it("does not steal focus from an iframe", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(120);
    frame.focus();
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(frame);
    frame.remove();
  });

  it("restores React focus state once after the synthetic focus round trip", () => {
    const focusIn = vi.fn();
    input.addEventListener("focusin", focusIn);
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(180);
    expect(focusIn).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("does not leave the editor blurred when composition starts during the delay", () => {
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(120);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", bubbles: true }));
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
  });

  it("restores the caret after a select-on-focus handler runs", () => {
    input.addEventListener("focusin", () => input.select());
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(180);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(9);
  });

  it("preserves the direction of a backward selection", () => {
    input.setSelectionRange(2, 9, "backward");
    dispose = installImeAnchorGuard();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(180);
    expect(input.selectionDirection).toBe("backward");
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
