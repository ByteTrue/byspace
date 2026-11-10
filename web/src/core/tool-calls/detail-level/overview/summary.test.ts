import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { OverviewSummary } from "./model";
import { formatOverviewSummary } from "./summary";

const EMPTY: OverviewSummary = {
  thoughtCount: 0,
  thoughtDurationMs: 0,
  editedFileCount: 0,
  commandCount: 0,
  readFileCount: 0,
  searchCount: 0,
  otherToolCount: 0,
  byspaceCallCount: 0,
};

// Echoes the key plus the count so the assertions can check both the entry picked and the order.
function buildT(): TFunction {
  return ((key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : key + ":" + options.count) as unknown as TFunction;
}

describe("formatOverviewSummary", () => {
  it("returns an empty string when the script called nothing", () => {
    expect(formatOverviewSummary(EMPTY, buildT())).toBe("");
  });

  it("picks the singular or plural entry per count", () => {
    const text = formatOverviewSummary({ ...EMPTY, commandCount: 2, readFileCount: 1 }, buildT(), {
      capitalize: false,
    });
    expect(text).toBe(
      "toolCallGroup.commands.other:2 toolCallGroup.and toolCallGroup.readFiles.one:1",
    );
  });

  it("joins three or more parts with a serial comma", () => {
    const text = formatOverviewSummary(
      { ...EMPTY, commandCount: 1, readFileCount: 1, searchCount: 1 },
      buildT(),
      { capitalize: false },
    );
    expect(text).toBe(
      "toolCallGroup.commands.one:1, toolCallGroup.readFiles.one:1, toolCallGroup.and toolCallGroup.searches.one:1",
    );
  });

  it("capitalizes the sentence by default and leaves it lowercase on request", () => {
    const summary = { ...EMPTY, commandCount: 1 };
    expect(formatOverviewSummary(summary, buildT())).toBe("ToolCallGroup.commands.one:1");
    expect(formatOverviewSummary(summary, buildT(), { capitalize: false })).toBe(
      "toolCallGroup.commands.one:1",
    );
  });

  it("includes thought at the start of the summary when thinking is folded into the group", () => {
    expect(
      formatOverviewSummary(
        { ...EMPTY, thoughtCount: 1, readFileCount: 1, searchCount: 1 },
        buildT(),
        { capitalize: false },
      ),
    ).toBe(
      "toolcallgroup.thought, toolCallGroup.readFiles.one:1, toolCallGroup.and toolCallGroup.searches.one:1",
    );
    expect(
      formatOverviewSummary(
        { ...EMPTY, thoughtCount: 1, thoughtDurationMs: 17_000, commandCount: 1 },
        buildT(),
      ),
    ).toBe("Toolcallgroup.thoughtfor toolCallGroup.and toolCallGroup.commands.one:1");
    expect(formatOverviewSummary({ ...EMPTY, thoughtCount: 2 }, buildT())).toBe(
      "Toolcallgroup.thought",
    );
  });
});
