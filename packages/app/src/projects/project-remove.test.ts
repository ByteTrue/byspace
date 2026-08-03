import { describe, expect, it, vi } from "vitest";
import {
  getProjectRemoveReadiness,
  removeProjectFromHosts,
  type ProjectRemoveProject,
} from "./project-remove";

const project: ProjectRemoveProject = {
  hosts: [
    { serverId: "host-a", projectId: "prj_a" },
    { serverId: "host-b", projectId: "prj_b" },
  ],
};

describe("project remove", () => {
  it("requires support and host-local project ids on every host", () => {
    expect(getProjectRemoveReadiness({ project, supportsProjectRemove: () => true })).toEqual({
      kind: "ready",
      targets: [
        { serverId: "host-a", projectId: "prj_a" },
        { serverId: "host-b", projectId: "prj_b" },
      ],
    });
    expect(
      getProjectRemoveReadiness({
        project,
        supportsProjectRemove: (serverId) => serverId === "host-a",
      }),
    ).toEqual({ kind: "needs_host_update", serverIds: ["host-b"] });
    expect(
      getProjectRemoveReadiness({
        project: { hosts: [{ serverId: "host-a" }] },
        supportsProjectRemove: () => true,
      }),
    ).toEqual({ kind: "needs_host_update", serverIds: ["host-a"] });
  });

  it("sends each daemon its own project id", async () => {
    const removeA = vi.fn().mockResolvedValue(undefined);
    const removeB = vi.fn().mockResolvedValue(undefined);
    const result = await removeProjectFromHosts({
      targets: [
        { serverId: "host-a", projectId: "prj_a" },
        { serverId: "host-b", projectId: "prj_b" },
      ],
      getClient: (serverId) => ({ removeProject: serverId === "host-a" ? removeA : removeB }),
    });
    expect(result).toEqual({ kind: "removed", serverIds: ["host-a", "host-b"] });
    expect(removeA).toHaveBeenCalledWith("prj_a");
    expect(removeB).toHaveBeenCalledWith("prj_b");
  });
});
