import { describe, expect, it } from "vitest";
import { selectMetaRowItems } from "./meta-items";

describe("selectMetaRowItems", () => {
  it("includes host and named service according to row preferences", () => {
    expect(
      selectMetaRowItems({
        hasHostBadge: true,
        prHint: null,
        serviceSummary: { name: "api", health: "unhealthy" },
        visible: { host: true, changeRequest: false, services: true },
        checksDisplay: "none",
      }),
    ).toEqual([
      { kind: "host" },
      { kind: "services", summary: { name: "api", health: "unhealthy" } },
    ]);
  });
});
