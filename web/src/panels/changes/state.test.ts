import { describe, expect, it } from "vitest";
import { changesStateSchema, defaultChangesState } from "./state";

describe("Changes pane state", () => {
  it("accepts the current pane document state", () => {
    expect(changesStateSchema.parse(defaultChangesState)).toEqual(defaultChangesState);
  });

  it("rejects per-pane preference shapes persisted by older builds", () => {
    const result = changesStateSchema.safeParse({
      ...defaultChangesState,
      mode: "base",
      baseRef: "origin/main",
      layout: "split",
      wrapLines: true,
      hideWhitespace: true,
    });
    expect(result.success).toBe(false);
  });
});
