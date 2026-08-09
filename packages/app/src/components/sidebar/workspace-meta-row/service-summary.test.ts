import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { selectWorkspaceServiceSummary, workspaceServiceLabelKey } from "./service-summary";

const scripts = (
  ...items: Array<Partial<SidebarWorkspaceEntry["scripts"][number]>>
): SidebarWorkspaceEntry["scripts"] =>
  items.map((item, index) =>
    Object.assign(
      {
        scriptName: `service-${index}`,
        lifecycle: "running" as const,
        type: "service" as const,
        health: "healthy" as const,
      },
      item,
    ),
  ) as SidebarWorkspaceEntry["scripts"];

describe("selectWorkspaceServiceSummary", () => {
  it("surfaces a named unhealthy service ahead of a healthy one", () => {
    const summary = selectWorkspaceServiceSummary(
      scripts({ scriptName: "web" }, { scriptName: "api", health: "unhealthy" }),
    );
    expect(summary).toEqual({ name: "api", health: "unhealthy" });
    expect(summary && workspaceServiceLabelKey(summary)).toBe("workspace.status.serviceUnhealthy");
  });

  it("ignores commands and stopped services", () => {
    expect(
      selectWorkspaceServiceSummary(scripts({ type: "script" }, { lifecycle: "stopped" })),
    ).toBeNull();
  });
});
