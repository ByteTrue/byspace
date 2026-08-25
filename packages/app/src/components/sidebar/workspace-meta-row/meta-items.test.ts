import { describe, expect, it } from "vitest";
import { selectMetaRowItems } from "./meta-items";

describe("selectMetaRowItems", () => {
  it("includes host and named service according to row preferences", () => {
    expect(
      selectMetaRowItems({
        currentBranch: null,
        projectName: null,
        hasHostBadge: true,
        prHint: null,
        serviceSummary: { name: "api", health: "unhealthy" },
        visible: {
          branch: false,
          project: false,
          host: true,
          changeRequest: false,
          services: true,
        },
        checksDisplay: "none",
      }),
    ).toEqual([
      { kind: "host" },
      { kind: "services", summary: { name: "api", health: "unhealthy" } },
    ]);
  });

  it("puts the enabled branch and project badges first", () => {
    expect(
      selectMetaRowItems({
        currentBranch: "feature/sidebar-badges",
        projectName: "BySpace",
        hasHostBadge: true,
        prHint: null,
        serviceSummary: null,
        visible: { branch: true, project: true, host: true, changeRequest: true, services: true },
        checksDisplay: "none",
      }).map((item) => item.kind),
    ).toEqual(["branch", "project", "host"]);
  });

  it("only draws identity badges when enabled and available", () => {
    expect(
      selectMetaRowItems({
        currentBranch: null,
        projectName: null,
        hasHostBadge: true,
        prHint: null,
        serviceSummary: null,
        visible: { branch: true, project: true, host: true, changeRequest: true, services: true },
        checksDisplay: "none",
      }).map((item) => item.kind),
    ).toEqual(["host"]);
  });
});
