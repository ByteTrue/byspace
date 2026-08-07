import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceAgentSummary } from "@/utils/workspace-agent-summary";
import { buildSidebarProjection } from "./sidebar-projection";

const HOST = {
  serverId: "srv",
  iconWorkingDir: "/repo",
  canCreateWorktree: true,
};

function makeWorkspace(input: {
  id: string;
  projectKey: string;
  status?: SidebarWorkspaceEntry["statusBucket"];
  statusEnteredAt?: string;
  latestActivityAt?: string;
  needsAttentionCount?: number;
  workingCount?: number;
}) {
  const status = input.status ?? "done";
  const statusEnteredAt = new Date(input.statusEnteredAt ?? "2026-07-01T00:00:00.000Z");
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${input.id}`,
    serverId: "srv",
    workspaceId: input.id,
    projectKey: input.projectKey,
    projectName: input.projectKey,
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.id,
  };
  const agentSummary: WorkspaceAgentSummary = {
    agents: [],
    status,
    statusEnteredAt,
    needsAttentionCount: input.needsAttentionCount ?? 0,
    workingCount: input.workingCount ?? 0,
    oldestAttentionAt: (input.needsAttentionCount ?? 0) > 0 ? statusEnteredAt : null,
    latestActivityAt: new Date(input.latestActivityAt ?? statusEnteredAt),
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    title: null,
    currentBranch: null,
    statusBucket: status,
    statusEnteredAt,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    agentSummary,
  };
  return { placement, entry };
}

function makeProject(
  projectKey: string,
  workspaces: SidebarWorkspacePlacement[],
): SidebarProjectEntry {
  return {
    projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [HOST],
    workspaces,
  };
}

function projectKeys(projects: readonly SidebarProjectEntry[]): string[] {
  return projects.map((project) => project.projectKey);
}

describe("buildSidebarProjection", () => {
  it("keeps the input order regardless of attention or activity", () => {
    const waiting = makeWorkspace({
      id: "waiting",
      projectKey: "second",
      status: "attention",
      statusEnteredAt: "2026-07-01T09:00:00.000Z",
      needsAttentionCount: 1,
    });
    const recent = makeWorkspace({
      id: "recent",
      projectKey: "first",
      latestActivityAt: "2026-07-01T11:00:00.000Z",
    });
    const idle = makeWorkspace({
      id: "idle",
      projectKey: "first",
      latestActivityAt: "2026-07-01T08:00:00.000Z",
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("first", [idle.placement, recent.placement]),
        makeProject("second", [waiting.placement]),
        makeProject("empty", []),
      ],
      workspaceEntriesByKey: new Map([
        [waiting.entry.workspaceKey, waiting.entry],
        [recent.entry.workspaceKey, recent.entry],
        [idle.entry.workspaceKey, idle.entry],
      ]),
      attentionOnly: false,
    });

    expect(projectKeys(projection.projects)).toEqual(["first", "second", "empty"]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual([
      "idle",
      "recent",
    ]);
    expect(projection.projects.map((project) => project.needsAttentionCount)).toEqual([0, 1, 0]);
    expect(projection.needsAttentionWorkspaceCount).toBe(1);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "idle" },
      { serverId: "srv", workspaceId: "recent" },
      { serverId: "srv", workspaceId: "waiting" },
    ]);
  });

  it("attentionOnly shows only attention workspaces and drops quiet projects", () => {
    const waiting = makeWorkspace({
      id: "waiting",
      projectKey: "mixed",
      status: "needs_input",
      needsAttentionCount: 1,
    });
    const quiet = makeWorkspace({
      id: "quiet",
      projectKey: "mixed",
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("mixed", [quiet.placement, waiting.placement]),
        makeProject("quiet-project", [quiet.placement]),
      ],
      workspaceEntriesByKey: new Map([
        [waiting.entry.workspaceKey, waiting.entry],
        [quiet.entry.workspaceKey, quiet.entry],
      ]),
      attentionOnly: true,
    });

    expect(projectKeys(projection.projects)).toEqual(["mixed"]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual(["waiting"]);
    expect(projection.needsAttentionWorkspaceCount).toBe(1);
  });
});
