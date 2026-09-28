import { describe, expect, it } from "vitest";

import { LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT, groupActivityBlocks } from "./multica-activity-fold";

interface Entry {
  kind: string;
  id: string;
}

const entry = (kind: string, id: string): Entry => ({ kind, id });

describe("activity fold", () => {
  it("consecutive activities form one block; a comment breaks the run", () => {
    const blocks = groupActivityBlocks([
      entry("activity", "a1"),
      entry("activity", "a2"),
      entry("comment", "c1"),
      entry("activity", "a3"),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].entries.map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(blocks[1].entries.map((row) => row.id)).toEqual(["a3"]);
  });

  it("every block but the trailing one folds to its summary", () => {
    const blocks = groupActivityBlocks([
      entry("activity", "a1"),
      entry("activity", "a2"),
      entry("comment", "c1"),
      entry("activity", "a3"),
    ]);
    expect(blocks[0].trailing).toBe(false);
    expect(blocks[0].visible).toHaveLength(0);
    expect(blocks[0].folded).toHaveLength(2);
    expect(blocks[1].trailing).toBe(true);
    expect(blocks[1].visible.map((row) => row.id)).toEqual(["a3"]);
  });

  it("the trailing block keeps its most recent eight", () => {
    const rows = Array.from({ length: LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT + 3 }, (_, i) =>
      entry("activity", `a${i}`),
    );
    const [block] = groupActivityBlocks(rows);
    expect(block.visible).toHaveLength(LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT);
    expect(block.folded).toHaveLength(3);
    expect(block.visible[0].id).toBe("a3");
  });

  it("a short trailing block folds nothing", () => {
    const [block] = groupActivityBlocks([entry("activity", "a1"), entry("activity", "a2")]);
    expect(block.folded).toHaveLength(0);
    expect(block.visible).toHaveLength(2);
  });
});
