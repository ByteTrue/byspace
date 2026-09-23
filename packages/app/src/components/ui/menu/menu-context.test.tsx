/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMenuState } from "./menu-context";

describe("useMenuState selectItem", () => {
  it("runs a closing item's action immediately", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));

    act(() => result.current.selectItem(onSelect, true));
    expect(result.current.open).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("leaves the menu open for an item that does not close it", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));

    act(() => result.current.selectItem(onSelect, false));
    expect(result.current.open).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
