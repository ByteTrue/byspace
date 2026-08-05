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
  it("keeps each project once and moves any project with attention into the first section", () => {
    const waiting = makeWorkspace({
      id: "waiting",
      projectKey: "needs-attention",
      status: "attention",
      statusEnteredAt: "2026-07-01T09:00:00.000Z",
      needsAttentionCount: 2,
    });
    const working = makeWorkspace({
      id: "working",
      projectKey: "needs-attention",
      status: "running",
      latestActivityAt: "2026-07-01T10:00:00.000Z",
      workingCount: 1,
    });
    const other = makeWorkspace({
      id: "other",
      projectKey: "other",
      latestActivityAt: "2026-07-01T11:00:00.000Z",
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("other", [other.placement]),
        makeProject("needs-attention", [working.placement, waiting.placement]),
      ],
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      workspaceEntriesByKey: new Map([
        [waiting.entry.workspaceKey, waiting.entry],
        [working.entry.workspaceKey, working.entry],
        [other.entry.workspaceKey, other.entry],
      ]),
      projectNamesByKey: new Map(),
      collapsedProjectKeys: new Set(),
    });

    expect(projectKeys(projection.needsAttentionProjects)).toEqual(["needs-attention"]);
    expect(projectKeys(projection.otherProjects)).toEqual(["other"]);
    expect(projection.needsAttentionProjects[0]?.needsAttentionCount).toBe(1);
    expect(projection.needsAttentionProjects[0]?.workspaces.map((row) => row.workspaceId)).toEqual([
      "waiting",
      "working",
    ]);
  });

  it("sorts attention projects by the oldest wait first", () => {
    const newer = makeWorkspace({
      id: "newer",
      projectKey: "newer-project",
      status: "failed",
      statusEnteredAt: "2026-07-01T10:00:00.000Z",
      needsAttentionCount: 1,
    });
    const older = makeWorkspace({
      id: "older",
      projectKey: "older-project",
      status: "needs_input",
      statusEnteredAt: "2026-07-01T08:00:00.000Z",
      needsAttentionCount: 1,
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("newer-project", [newer.placement]),
        makeProject("older-project", [older.placement]),
      ],
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      workspaceEntriesByKey: new Map([
        [newer.entry.workspaceKey, newer.entry],
        [older.entry.workspaceKey, older.entry],
      ]),
      projectNamesByKey: new Map(),
      collapsedProjectKeys: new Set(),
    });

    expect(projectKeys(projection.needsAttentionProjects)).toEqual([
      "older-project",
      "newer-project",
    ]);
  });

  it("sorts other projects by recent activity and leaves empty projects at the end", () => {
    const older = makeWorkspace({
      id: "older",
      projectKey: "older-project",
      latestActivityAt: "2026-07-01T08:00:00.000Z",
    });
    const newer = makeWorkspace({
      id: "newer",
      projectKey: "newer-project",
      latestActivityAt: "2026-07-01T10:00:00.000Z",
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("empty", []),
        makeProject("older-project", [older.placement]),
        makeProject("newer-project", [newer.placement]),
      ],
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      workspaceEntriesByKey: new Map([
        [older.entry.workspaceKey, older.entry],
        [newer.entry.workspaceKey, newer.entry],
      ]),
      projectNamesByKey: new Map(),
      collapsedProjectKeys: new Set(),
    });

    expect(projectKeys(projection.otherProjects)).toEqual([
      "newer-project",
      "older-project",
      "empty",
    ]);
  });

  it("keeps the explicit pin override ahead of recent activity in Other projects", () => {
    const pinned = makeWorkspace({
      id: "pinned",
      projectKey: "project",
      latestActivityAt: "2026-07-01T08:00:00.000Z",
    });
    const recent = makeWorkspace({
      id: "recent",
      projectKey: "project",
      latestActivityAt: "2026-07-01T10:00:00.000Z",
    });

    const projection = buildSidebarProjection({
      projects: [makeProject("project", [recent.placement, pinned.placement])],
      pinnedKeys: {
        pinnedWorkspaceKeys: [pinned.entry.workspaceKey],
        pinnedAtByKey: { [pinned.entry.workspaceKey]: "2026-07-01T12:00:00.000Z" },
      },
      workspaceEntriesByKey: new Map([
        [pinned.entry.workspaceKey, pinned.entry],
        [recent.entry.workspaceKey, recent.entry],
      ]),
      projectNamesByKey: new Map(),
      collapsedProjectKeys: new Set(),
    });

    expect(projection.otherProjects[0]?.workspaces.map((row) => row.workspaceId)).toEqual([
      "pinned",
      "recent",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "recent" },
    ]);
  });

  it("keeps oldest-waiting order ahead of pinning in Needs attention", () => {
    const older = makeWorkspace({
      id: "older",
      projectKey: "project",
      status: "needs_input",
      statusEnteredAt: "2026-07-01T08:00:00.000Z",
      needsAttentionCount: 1,
    });
    const pinnedNewer = makeWorkspace({
      id: "pinned-newer",
      projectKey: "project",
      status: "failed",
      statusEnteredAt: "2026-07-01T10:00:00.000Z",
      needsAttentionCount: 1,
    });

    const projection = buildSidebarProjection({
      projects: [makeProject("project", [pinnedNewer.placement, older.placement])],
      pinnedKeys: {
        pinnedWorkspaceKeys: [pinnedNewer.entry.workspaceKey],
        pinnedAtByKey: { [pinnedNewer.entry.workspaceKey]: "2026-07-01T12:00:00.000Z" },
      },
      workspaceEntriesByKey: new Map([
        [older.entry.workspaceKey, older.entry],
        [pinnedNewer.entry.workspaceKey, pinnedNewer.entry],
      ]),
      projectNamesByKey: new Map(),
      collapsedProjectKeys: new Set(),
    });

    expect(projection.needsAttentionProjects[0]?.workspaces.map((row) => row.workspaceId)).toEqual([
      "older",
      "pinned-newer",
    ]);
  });
});
