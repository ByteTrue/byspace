import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { resolveNewWorkspaceHostSelection } from "./new-workspace-initial-context";

function project(input: {
  key?: string;
  hosts: Array<{
    serverId: string;
    projectId?: string;
    canCreateWorktree?: boolean;
  }>;
}): HostProjectListItem {
  return {
    projectKey: input.key ?? "project",
    projectName: input.key ?? "project",
    projectKind: "git",
    iconWorkingDir: `/work/${input.key ?? "project"}`,
    hosts: input.hosts.map((host) => ({
      serverId: host.serverId,
      projectId: host.projectId,
      iconWorkingDir: `/work/${input.key ?? "project"}/${host.serverId}`,
      canCreateWorktree: host.canCreateWorktree ?? true,
    })),
    workspaceKeys: [],
  };
}

function statuses(
  entries: Record<string, HostRuntimeConnectionStatus>,
): ReadonlyMap<string, HostRuntimeConnectionStatus> {
  return new Map(Object.entries(entries));
}

function multiplicity(entries: Record<string, boolean> = {}): ReadonlyMap<string, boolean> {
  return new Map(Object.entries(entries));
}

function resolve(input: {
  allServerIds?: string[];
  routeServerId?: string | null;
  selectedProject: HostProjectListItem | null;
  statuses?: Record<string, HostRuntimeConnectionStatus>;
  multiplicity?: Record<string, boolean>;
}) {
  const allServerIds = input.allServerIds ?? ["host-a", "host-b"];
  return resolveNewWorkspaceHostSelection({
    allServerIds,
    routeServerId: input.routeServerId,
    selectedProject: input.selectedProject,
    hostConnectionStatusByServerId: statuses(input.statuses ?? {}),
    workspaceMultiplicityByServerId: multiplicity(input.multiplicity),
  });
}

describe("resolveNewWorkspaceHostSelection", () => {
  it("does not use a remembered project before the user chooses a project", () => {
    expect(
      resolve({
        selectedProject: null,
        statuses: { "host-a": "online", "host-b": "offline" },
      }),
    ).toEqual({
      eligibleServerIds: [],
      selectedServerId: "host-a",
      requiresHostSelection: false,
    });
  });

  it("uses an explicit route host when it can create the selected project", () => {
    expect(
      resolve({
        routeServerId: "host-b",
        selectedProject: project({
          hosts: [{ serverId: "host-a" }, { serverId: "host-b" }],
        }),
        statuses: { "host-a": "online", "host-b": "online" },
      }),
    ).toEqual({
      eligibleServerIds: ["host-a", "host-b"],
      selectedServerId: "host-b",
      requiresHostSelection: false,
    });
  });

  it("derives the only eligible host without showing a choice", () => {
    expect(
      resolve({
        selectedProject: project({ hosts: [{ serverId: "host-b" }] }),
      }),
    ).toEqual({
      eligibleServerIds: ["host-b"],
      selectedServerId: "host-b",
      requiresHostSelection: false,
    });
  });

  it("requires an explicit choice when multiple placements have different connectivity", () => {
    expect(
      resolve({
        selectedProject: project({
          hosts: [{ serverId: "host-a" }, { serverId: "host-b" }],
        }),
        statuses: { "host-a": "offline", "host-b": "online" },
      }),
    ).toEqual({
      eligibleServerIds: ["host-a", "host-b"],
      selectedServerId: "host-a",
      requiresHostSelection: true,
    });
  });

  it("requires an explicit choice when multiple hosts remain equally valid", () => {
    expect(
      resolve({
        selectedProject: project({
          hosts: [{ serverId: "host-a" }, { serverId: "host-b" }],
        }),
        statuses: { "host-a": "online", "host-b": "online" },
      }),
    ).toEqual({
      eligibleServerIds: ["host-a", "host-b"],
      selectedServerId: "host-a",
      requiresHostSelection: true,
    });
  });

  it("uses per-host multiplicity for directory project placements", () => {
    expect(
      resolve({
        selectedProject: project({
          hosts: [
            { serverId: "host-a", canCreateWorktree: false },
            { serverId: "host-b", canCreateWorktree: false },
          ],
        }),
        multiplicity: { "host-a": false, "host-b": true },
      }),
    ).toEqual({
      eligibleServerIds: ["host-b"],
      selectedServerId: "host-b",
      requiresHostSelection: false,
    });
  });

  it("keeps a project unselected from hosts when no placement can create a workspace", () => {
    expect(
      resolve({
        selectedProject: project({
          hosts: [
            { serverId: "host-a", canCreateWorktree: false },
            { serverId: "host-b", canCreateWorktree: false },
          ],
        }),
        multiplicity: { "host-a": false, "host-b": false },
      }),
    ).toEqual({
      eligibleServerIds: [],
      selectedServerId: "host-a",
      requiresHostSelection: false,
    });
  });

  it("requires a host choice while multiple eligible hosts are still connecting", () => {
    expect(
      resolve({
        selectedProject: project({
          hosts: [{ serverId: "host-a" }, { serverId: "host-b" }],
        }),
        statuses: { "host-a": "connecting", "host-b": "connecting" },
      }),
    ).toEqual({
      eligibleServerIds: ["host-a", "host-b"],
      selectedServerId: "host-a",
      requiresHostSelection: true,
    });
  });
});
