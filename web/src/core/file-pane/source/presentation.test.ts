import { describe, expect, it } from "vitest";
import { SOURCE_PRESENTATION_BUDGETS, selectSourcePresentation } from "./presentation";

describe("selectSourcePresentation", () => {
  it("keeps threshold edges predictable", () => {
    const budgets = SOURCE_PRESENTATION_BUDGETS;
    expect(selectSourcePresentation({ size: budgets.highlighted })).toBe("highlighted");
    expect(selectSourcePresentation({ size: budgets.highlighted + 1 })).toBe("plain");
    expect(selectSourcePresentation({ size: budgets.plain })).toBe("plain");
    expect(selectSourcePresentation({ size: budgets.plain + 1 })).toBe("unsupported");
  });
});
