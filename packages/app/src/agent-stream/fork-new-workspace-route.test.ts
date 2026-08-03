import { describe, expect, it } from "vitest";
import { buildForkNewWorkspaceRoute } from "./fork-new-workspace-route";

describe("buildForkNewWorkspaceRoute", () => {
  it("routes a grouped project by its current workspace's host-local project id", () => {
    expect(
      buildForkNewWorkspaceRoute({
        serverId: "host-a",
        sourceDirectory: "/repo/a",
        displayName: "Shared repo",
        workspaceProjectId: "prj_a",
        projectPlacement: {
          projectId: "prj_from_placement",
          projectKey: "remote:https://github.com/acme/shared",
        },
        draftId: "draft-1",
      }),
    ).toBe("/new?serverId=host-a&dir=%2Frepo%2Fa&name=Shared+repo&projectId=prj_a&draftId=draft-1");
  });

  it("uses the optional placement project id when the workspace is no longer listed", () => {
    expect(
      buildForkNewWorkspaceRoute({
        serverId: "host-a",
        sourceDirectory: "/repo/a",
        displayName: "Shared repo",
        workspaceProjectId: null,
        projectPlacement: {
          projectId: "prj_a",
          projectKey: "remote:https://github.com/acme/shared",
        },
        draftId: "draft-1",
      }),
    ).toContain("projectId=prj_a");
  });

  it("never substitutes the grouping key when an old placement has no local project id", () => {
    expect(
      buildForkNewWorkspaceRoute({
        serverId: "host-a",
        sourceDirectory: "/repo/a",
        displayName: "Shared repo",
        workspaceProjectId: null,
        projectPlacement: { projectKey: "remote:https://github.com/acme/shared" },
        draftId: "draft-1",
      }),
    ).toBe("/new?serverId=host-a&dir=%2Frepo%2Fa&name=Shared+repo&draftId=draft-1");
  });
});
