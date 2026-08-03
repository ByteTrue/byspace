import { describe, expect, it } from "vitest";
import type { ProjectDescriptor } from "@/stores/session-store";
import { buildWorkspaceStructureProjects } from "./workspace-structure";

function project(projectId: string, projectKey: string, root: string): ProjectDescriptor {
  return {
    projectId,
    projectKey,
    projectDisplayName: "repo",
    projectCustomName: null,
    projectRootPath: root,
    projectKind: "git",
  };
}

describe("buildWorkspaceStructureProjects", () => {
  it("groups one remote-backed project across hosts while retaining host-local ids", () => {
    const projects = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [project("prj_a", "remote:https://example.com/o/repo", "/a/repo")],
          workspaces: [],
        },
        {
          serverId: "host-b",
          projects: [project("prj_b", "remote:https://example.com/o/repo", "/b/repo")],
          workspaces: [],
        },
      ],
    });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.hosts).toEqual([
      expect.objectContaining({ serverId: "host-a", projectId: "prj_a" }),
      expect.objectContaining({ serverId: "host-b", projectId: "prj_b" }),
    ]);
  });

  it("does not collapse duplicate clones on one host", () => {
    const projects = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [
            project("prj_a", "remote:https://example.com/o/repo", "/a/one"),
            project("prj_b", "remote:https://example.com/o/repo", "/a/two"),
          ],
          workspaces: [],
        },
      ],
    });
    expect(projects).toHaveLength(2);
    expect(projects.map((entry) => entry.hosts[0]?.projectId).sort()).toEqual(["prj_a", "prj_b"]);
  });
});
