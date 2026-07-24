import { describe, expect, test } from "vitest";

import { toneFromUsedPct } from "./usage.js";

describe("toneFromUsedPct", () => {
  test.each([
    [undefined, "default"],
    [49, "ok"],
    [70, "warning"],
    [90, "warning"],
    [91, "danger"],
  ] as const)("maps %s to %s", (usedPct, tone) => {
    expect(toneFromUsedPct(usedPct)).toBe(tone);
  });
});
