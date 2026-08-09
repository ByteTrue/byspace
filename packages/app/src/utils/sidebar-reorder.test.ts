import { describe, expect, it } from "vitest";

import { hasVisibleOrderChanged, mergeWithRemainder } from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("reorders visible keys without moving hidden keys from their slots", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "x", "a", "y"]);
  });

  it("preserves the complete hidden tail when a limited 20-item group is reordered", () => {
    const currentOrder = Array.from({ length: 25 }, (_, index) => `workspace-${index + 1}`);
    const reorderedVisibleKeys = [...currentOrder.slice(19, 20), ...currentOrder.slice(0, 19)];

    expect(
      mergeWithRemainder({
        currentOrder,
        reorderedVisibleKeys,
      }),
    ).toEqual([currentOrder[19], ...currentOrder.slice(0, 19), ...currentOrder.slice(20)]);
  });

  it("preserves interleaved quiet workspace positions in an attention-only reorder", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["quiet-a", "attention-b", "quiet-c", "attention-d"],
        reorderedVisibleKeys: ["attention-d", "attention-b"],
      }),
    ).toEqual(["quiet-a", "attention-d", "quiet-c", "attention-b"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });
});
