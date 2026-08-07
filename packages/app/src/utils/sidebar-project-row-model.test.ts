import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  resolveSidebarProjectIconTarget,
  resolveSidebarProjectNewWorkspaceTarget,
} from "./sidebar-project-row-model";

function workspace(): SidebarWorkspacePlacement {
  return {
    workspaceKey: "srv:ws-root",
    serverId: "srv",
    workspaceId: "ws-root",
    projectKey: "project-1",
    projectName: "byspace",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "byspace",
  };
}

function project(overrides: Partial<SidebarProjectEntry> = {}): SidebarProjectEntry {
  const projectKind = overrides.projectKind ?? "git";
  return {
    projectKey: "project-1",
    projectName: "byspace",
    projectKind,
    iconWorkingDir: "/repo",
    hosts: overrides.hosts ?? [
      { serverId: "srv", iconWorkingDir: "/repo", canCreateWorktree: projectKind === "git" },
    ],
    workspaces: [workspace()],
    ...overrides,
  };
}

describe("resolveSidebarProjectNewWorkspaceTarget", () => {
  it("hides the action for a non-git project without workspace multiplicity", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({ projectKind: "directory" }),
    });

    expect(target).toBeNull();
  });

  it("shows the action for a single-workspace git project", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({ project: project() });

    expect(target).toEqual({ projectKey: "project-1" });
  });

  it("shows the action for a non-git project when the host supports workspace multiplicity", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({ projectKind: "directory" }),
      supportsMultiplicityByServerId: new Map([["srv", true]]),
    });

    expect(target).toEqual({ projectKey: "project-1" });
  });

  it("hides the action when workspace multiplicity is explicitly unavailable", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({ projectKind: "directory" }),
      supportsMultiplicityByServerId: new Map([["srv", false]]),
    });

    expect(target).toBeNull();
  });

  it("shows the action for a git project regardless of workspace multiplicity", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project(),
      supportsMultiplicityByServerId: new Map([["srv", false]]),
    });

    expect(target).toEqual({ projectKey: "project-1" });
  });

  it("keeps multi-host creation scoped to the aggregate project", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({
        hosts: [
          { serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: false },
          { serverId: "host-b", iconWorkingDir: "/repo/b", canCreateWorktree: true },
        ],
      }),
    });

    expect(target).toEqual({ projectKey: "project-1" });
  });

  it("preserves opaque aggregate project keys in creation targets", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({ projectKey: " project-1 " }),
    });

    expect(target).toEqual({ projectKey: " project-1 " });
  });

  it("supports multiplicity from any host in an aggregate project", () => {
    const target = resolveSidebarProjectNewWorkspaceTarget({
      project: project({
        projectKind: "directory",
        hosts: [
          { serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: false },
          { serverId: "host-b", iconWorkingDir: "/repo/b", canCreateWorktree: false },
        ],
      }),
      supportsMultiplicityByServerId: new Map([["host-b", true]]),
    });

    expect(target).toEqual({ projectKey: "project-1" });
  });
});

describe("resolveSidebarProjectIconTarget", () => {
  it("resolves project icons from the project host, not the focused host", () => {
    const iconTarget = resolveSidebarProjectIconTarget(
      project({
        hosts: [
          { serverId: "host-b", iconWorkingDir: "/repo/b", canCreateWorktree: true },
          { serverId: "host-a", iconWorkingDir: "/repo/a", canCreateWorktree: true },
        ],
      }),
    );

    expect(iconTarget).toEqual({ serverId: "host-b", iconWorkingDir: "/repo/b" });
  });
});
