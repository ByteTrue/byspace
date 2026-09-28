import { describe, expect, it } from "vitest";

import { foldThreads } from "./multica-thread-fold";

interface Row {
  id: string;
  parentId: string | null;
  resolvedAt: string | null;
}

const row = (id: string, parentId: string | null, resolvedAt: string | null = null): Row => ({
  id,
  parentId,
  resolvedAt,
});

describe("thread fold", () => {
  it("a resolved root collapses its whole thread", () => {
    const rows = [row("r", null, "2026-01-01"), row("a", "r"), row("b", "r")];
    const fold = foldThreads(rows);
    expect(fold.visible.map((entry) => entry.id)).toEqual(["r"]);
    expect(fold.foldedByRoot.get("r")).toBe(2);
  });

  it("a resolved reply keeps the root plus the latest conclusion", () => {
    const rows = [
      row("r", null),
      row("a", "r"),
      row("b", "r", "2026-01-03"),
      row("c", "r", "2026-01-02"),
    ];
    const fold = foldThreads(rows);
    expect(fold.visible.map((entry) => entry.id).sort()).toEqual(["b", "r"]);
    expect(fold.foldedByRoot.get("r")).toBe(2);
  });

  it("an open thread keeps everything and folds nothing", () => {
    const rows = [row("r", null), row("a", "r"), row("b", "a")];
    const fold = foldThreads(rows);
    expect(fold.visible).toHaveLength(3);
    expect(fold.foldedByRoot.size).toBe(0);
  });

  it("nested replies fold to their true root", () => {
    const rows = [row("r", null, "2026-01-01"), row("a", "r"), row("b", "a")];
    const fold = foldThreads(rows);
    expect(fold.visible.map((entry) => entry.id)).toEqual(["r"]);
    expect(fold.foldedByRoot.get("r")).toBe(2);
  });
});
