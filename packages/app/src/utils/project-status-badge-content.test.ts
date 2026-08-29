import { describe, expect, it } from "vitest";
import { getProjectStatusBadgeContent } from "./project-status-badge-content";

describe("getProjectStatusBadgeContent", () => {
  it("maps each aggregate status to the compact badge content", () => {
    expect(getProjectStatusBadgeContent("needs_input")).toEqual({ kind: "alert" });
    expect(getProjectStatusBadgeContent("failed")).toEqual({ kind: "dot", bucket: "failed" });
    expect(getProjectStatusBadgeContent("running")).toEqual({ kind: "dot", bucket: "running" });
    expect(getProjectStatusBadgeContent("attention")).toEqual({
      kind: "dot",
      bucket: "attention",
    });
    expect(getProjectStatusBadgeContent("done")).toBeNull();
  });
});
