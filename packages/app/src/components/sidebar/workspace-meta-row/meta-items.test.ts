import { describe, expect, it } from "vitest";
import type { WorkspaceLabelDefinition } from "@bytetrue/byspace-protocol/workspace-labels";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import { selectMetaRowItems } from "./meta-items";

const LABELS: WorkspaceLabelDefinition[] = [{ name: "Urgent", color: "red" }];

function select(overrides: Partial<Parameters<typeof selectMetaRowItems>[0]> = {}) {
  return selectMetaRowItems({
    currentBranch: null,
    projectName: null,
    hasHostBadge: true,
    prHint: null,
    serviceSummary: null,
    labels: LABELS,
    visible: DEFAULT_SIDEBAR_ROW_ITEMS,
    checksDisplay: "none",
    ...overrides,
  });
}

const kinds = (items: ReturnType<typeof selectMetaRowItems>) => items.map((item) => item.kind);

describe("selectMetaRowItems", () => {
  it("includes host and named service according to row preferences", () => {
    expect(
      select({
        serviceSummary: { name: "api", health: "unhealthy" },
        visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, changeRequest: false, services: true },
      }),
    ).toEqual([
      { kind: "host" },
      { kind: "services", summary: { name: "api", health: "unhealthy" } },
      { kind: "labels", labels: LABELS },
    ]);
  });

  it("puts the enabled branch and project badges first", () => {
    expect(
      kinds(
        select({
          currentBranch: "feature/sidebar-badges",
          projectName: "BySpace",
          visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true },
        }),
      ),
    ).toEqual(["branch", "project", "host", "labels"]);
  });

  it("only draws identity badges when enabled and available", () => {
    expect(
      kinds(
        select({
          visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true },
        }),
      ),
    ).toEqual(["host", "labels"]);
  });

  it("draws the label run only when labels exist and the toggle is on", () => {
    expect(kinds(select())).toEqual(["host", "labels"]);
    expect(kinds(select({ labels: [] }))).toEqual(["host"]);
    expect(kinds(select({ visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, labels: false } }))).toEqual([
      "host",
    ]);
  });
});
