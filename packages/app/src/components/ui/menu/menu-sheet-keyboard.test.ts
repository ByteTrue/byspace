import { describe, expect, it, vi } from "vitest";
import { handleMenuSheetEscape } from "./menu-sheet-keyboard";

describe("handleMenuSheetEscape", () => {
  it("closes and consumes Escape", () => {
    const close = vi.fn();
    const event = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    expect(handleMenuSheetEscape(event, close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("ignores other keys", () => {
    const close = vi.fn();
    const event = { key: "Enter" } as KeyboardEvent;
    expect(handleMenuSheetEscape(event, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
