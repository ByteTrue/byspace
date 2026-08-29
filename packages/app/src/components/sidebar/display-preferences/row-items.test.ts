import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ROW_ITEMS, parseSidebarRowItems } from "./row-items";

describe("parseSidebarRowItems", () => {
  it("shows operational metadata but hides identity badges by default", () => {
    expect(DEFAULT_SIDEBAR_ROW_ITEMS).toEqual({
      branch: false,
      project: false,
      host: true,
      changeRequest: true,
      labels: true,
      services: true,
    });
  });

  it("leaves items absent from storage at their default", () => {
    expect(parseSidebarRowItems({ host: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      host: false,
    });
  });
});
