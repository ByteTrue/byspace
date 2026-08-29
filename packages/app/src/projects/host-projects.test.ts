import { describe, expect, it } from "vitest";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import {
  buildHostProjectList,
  canCreateWorktreeForProjectKind,
  getHostProjectSourceDirectory,
  getWorkspaceCreationHosts,
  hostProjectFromRoute,
  resolveSelectedHostProject,
  resolveHostProjectWorkspaceIdentity,
  type HostProjectListItem,
} from "./host-project-model";

function structureProject(input: Partial<WorkspaceStructureProject>): WorkspaceStructureProject {
  return {
    projectKey: input.projectKey ?? "project-a",
    projectName: input.projectName ?? "Project A",
    projectKind: input.projectKind ?? "git",
    iconWorkingDir: input.iconWorkingDir ?? "/repo/a",
    hosts: input.hosts ?? [
      {
        serverId: "host-a",
        iconWorkingDir: input.iconWorkingDir ?? "/repo/a",
        canCreateWorktree: input.projectKind !== "directory",
      },
    ],
    workspaceKeys: input.workspaceKeys ?? ["workspace-a"],
  };
}

function hostProject(input: Partial<HostProjectListItem>): HostProjectListItem {
  return {
    projectKey: input.projectKey ?? "project-a",
    projectName: input.projectName ?? "Project A",
    projectKind: input.projectKind ?? "git",
    iconWorkingDir: input.iconWorkingDir ?? "/repo/a",
    hosts: input.hosts ?? [
      {
        serverId: "host-a",
        iconWorkingDir: input.iconWorkingDir ?? "/repo/a",
        canCreateWorktree: true,
      },
    ],
    workspaceKeys: input.workspaceKeys ?? ["workspace-a"],
  };
}

const routeProject = hostProject({
  projectKey: "route-project",
  projectName: "Route Project",
  iconWorkingDir: "/repo/route",
});

describe("host project list", () => {
  it("preserves workspace-structure order and project metadata", () => {
    expect(
      buildHostProjectList({
        projects: [
          structureProject({
            projectKey: "project-b",
            projectName: "Project B",
            projectKind: "directory",
            iconWorkingDir: "/repo/b",
            workspaceKeys: ["workspace-b"],
            hosts: [{ serverId: "host-a", iconWorkingDir: "/repo/b", canCreateWorktree: false }],
          }),
          structureProject({
            projectKey: "project-a",
            projectName: "Project A",
            projectKind: "git",
            iconWorkingDir: "/repo/a",
            workspaceKeys: ["workspace-a"],
            hosts: [{ serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: true }],
          }),
        ],
      }),
    ).toEqual([
      {
        projectKey: "project-b",
        projectName: "Project B",
        projectKind: "directory",
        iconWorkingDir: "/repo/b",
        hosts: [{ serverId: "host-a", iconWorkingDir: "/repo/b", canCreateWorktree: false }],
        workspaceKeys: ["workspace-b"],
      },
      {
        projectKey: "project-a",
        projectName: "Project A",
        projectKind: "git",
        iconWorkingDir: "/repo/a",
        hosts: [{ serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: true }],
        workspaceKeys: ["workspace-a"],
      },
    ]);
  });

  it("keeps worktree capability separate from project listability", () => {
    expect(canCreateWorktreeForProjectKind("git")).toBe(true);
    expect(canCreateWorktreeForProjectKind("directory")).toBe(false);
  });

  it("derives eligible creation hosts from each placement capability", () => {
    const multiHostProject = hostProject({
      projectKind: "directory",
      hosts: [
        { serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: false },
        { serverId: "host-b", iconWorkingDir: "/repo/b", canCreateWorktree: false },
        { serverId: "host-c", iconWorkingDir: "/repo/c", canCreateWorktree: true },
      ],
    });

    expect(
      getWorkspaceCreationHosts({
        project: multiHostProject,
        workspaceMultiplicityByServerId: new Map([
          ["host-a", false],
          ["host-b", true],
          ["host-c", false],
        ]),
      }).map((host) => host.serverId),
    ).toEqual(["host-b", "host-c"]);
  });

  it("resolves the selected host project source directory", () => {
    const project = hostProject({
      hosts: [
        { serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: true },
        { serverId: "host-b", iconWorkingDir: "/repo/b", canCreateWorktree: true },
      ],
    });

    expect(getHostProjectSourceDirectory(project, "host-b")).toBe("/repo/b");
    expect(getHostProjectSourceDirectory(project, "host-c")).toBeNull();
  });

  it("resolves workspace keys using the longest opaque Host prefix", () => {
    const project = hostProject({
      hosts: [
        { serverId: "relay", iconWorkingDir: "/repo/relay", canCreateWorktree: true },
        {
          serverId: "relay:byspace-host",
          iconWorkingDir: "/repo/byspace",
          canCreateWorktree: true,
        },
      ],
    });

    expect(resolveHostProjectWorkspaceIdentity(project, "relay:byspace-host:ws-main")).toEqual({
      serverId: "relay:byspace-host",
      workspaceId: "ws-main",
    });
    expect(resolveHostProjectWorkspaceIdentity(project, "unknown:ws-main")).toBeNull();
  });

  it("hydrates a host-local route key to the grouped project", () => {
    const grouped = hostProject({
      projectKey: "remote:https://github.com/acme/app",
      hosts: [
        {
          serverId: "host-a",
          projectId: "prj_local_a",
          iconWorkingDir: "/repo/a",
          canCreateWorktree: true,
        },
        {
          serverId: "host-b",
          projectId: "prj_local_b",
          iconWorkingDir: "/repo/b",
          canCreateWorktree: true,
        },
      ],
    });
    const localRoute = hostProjectFromRoute({
      serverId: "host-b",
      projectId: "prj_local_b",
      displayName: "App on B",
      sourceDirectory: "/repo/b",
    });

    expect(
      resolveSelectedHostProject({
        selectedProjectKey: "prj_local_b",
        projects: [grouped],
        routeProject: localRoute,
      }),
    ).toBe(grouped);
  });

  it("keeps a selected route project available before project hydration", () => {
    expect(
      resolveSelectedHostProject({
        selectedProjectKey: routeProject.projectKey,
        projects: [],
        routeProject,
      }),
    ).toEqual(routeProject);
  });

  it("preserves opaque aggregate project keys during selection", () => {
    const opaqueProject = hostProject({ projectKey: " project-a " });

    expect(
      resolveSelectedHostProject({
        selectedProjectKey: opaqueProject.projectKey,
        projects: [opaqueProject],
        routeProject: null,
      }),
    ).toBe(opaqueProject);
  });

  it("converts route project only when it has a key and source directory", () => {
    expect(
      hostProjectFromRoute({
        serverId: "host-a",
        projectId: "project-a",
        displayName: "Project A",
        sourceDirectory: "/repo/a",
      }),
    ).toEqual({
      projectKey: "project-a",
      projectName: "Project A",
      projectKind: "git",
      iconWorkingDir: "/repo/a",
      hosts: [
        {
          serverId: "host-a",
          projectId: "project-a",
          iconWorkingDir: "/repo/a",
          canCreateWorktree: true,
        },
      ],
      workspaceKeys: [],
    });
    expect(hostProjectFromRoute({ serverId: "host-a", projectId: "project-a" })).toBeNull();
  });
});
