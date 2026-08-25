import { describe, expect, it } from "vitest";
import { shouldShowProjectHostLabels } from "@/hooks/sidebar-workspaces-view-model";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceAgentSummary } from "@/utils/workspace-agent-summary";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(input: {
  id: string;
  projectKey: string;
  serverId?: string;
  status?: SidebarWorkspaceEntry["statusBucket"];
  statusEnteredAt?: string;
  latestActivityAt?: string;
  needsAttentionCount?: number;
  workingCount?: number;
}) {
  const status = input.status ?? "done";
  const statusEnteredAt = new Date(input.statusEnteredAt ?? "2026-07-01T00:00:00.000Z");
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `${input.serverId ?? "srv"}:${input.id}`,
    serverId: input.serverId ?? "srv",
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
    hosts: [...new Set(workspaces.map((workspace) => workspace.serverId))].map((serverId) => ({
      serverId,
      iconWorkingDir: "/repo",
      canCreateWorktree: true,
    })),
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
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      pinnedWorkspaceOrder: [],
      pinnedCollapsed: false,
    });

    expect(projectKeys(projection.projects)).toEqual(["first", "second", "empty"]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual([
      "idle",
      "recent",
    ]);
    expect(projection.projects.map((project) => project.needsAttentionCount)).toEqual([0, 1, 0]);
    expect(projection.needsAttentionWorkspaceCount).toBe(1);
    expect(projection.projects.map((project) => project.statusBucket)).toEqual([
      "done",
      "attention",
      "done",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "idle" },
      { serverId: "srv", workspaceId: "recent" },
      { serverId: "srv", workspaceId: "waiting" },
    ]);
  });

  it("attentionOnly narrows automatic host labels to visible workspaces", () => {
    const quiet = makeWorkspace({
      id: "quiet",
      projectKey: "mixed",
      serverId: "srv-a",
    });
    const waiting = makeWorkspace({
      id: "waiting",
      projectKey: "mixed",
      serverId: "srv-b",
      status: "needs_input",
      needsAttentionCount: 1,
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
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      pinnedWorkspaceOrder: [],
      pinnedCollapsed: false,
    });

    expect(projectKeys(projection.projects)).toEqual(["mixed"]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual(["waiting"]);
    expect(projection.needsAttentionWorkspaceCount).toBe(1);
    expect(shouldShowProjectHostLabels(projection.projects[0]!)).toBe(false);
  });

  it("hoists pinned chats into their own group, most recently pinned first", () => {
    const older = makeWorkspace({ id: "older", projectKey: "first" });
    const keeper = makeWorkspace({ id: "keeper", projectKey: "first" });
    const newer = makeWorkspace({ id: "newer", projectKey: "second" });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("first", [older.placement, keeper.placement]),
        makeProject("second", [newer.placement]),
      ],
      workspaceEntriesByKey: new Map([
        [older.entry.workspaceKey, older.entry],
        [keeper.entry.workspaceKey, keeper.entry],
        [newer.entry.workspaceKey, newer.entry],
      ]),
      attentionOnly: false,
      pinnedKeys: {
        pinnedWorkspaceKeys: ["srv:older", "srv:newer"],
        pinnedAtByKey: {
          "srv:older": "2026-07-01T09:00:00.000Z",
          "srv:newer": "2026-07-01T10:00:00.000Z",
        },
      },
      pinnedWorkspaceOrder: [],
      pinnedCollapsed: false,
    });

    expect(projection.pinnedGroups.pinnedChats.map((row) => row.workspaceId)).toEqual([
      "newer",
      "older",
    ]);
    // "second" had only pinned chats, so its empty shell is dropped (BySpace behavior).
    expect(projectKeys(projection.pinnedGroups.unpinnedProjects)).toEqual(["first"]);
    expect(projectKeys(projection.projects)).toEqual(["first"]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual(["keeper"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "newer" },
      { serverId: "srv", workspaceId: "older" },
      { serverId: "srv", workspaceId: "keeper" },
    ]);
  });

  it("applies the stored pinned order over pin recency", () => {
    const older = makeWorkspace({ id: "older", projectKey: "first" });
    const keeper = makeWorkspace({ id: "keeper", projectKey: "first" });
    const newer = makeWorkspace({ id: "newer", projectKey: "first" });

    const projection = buildSidebarProjection({
      projects: [makeProject("first", [older.placement, keeper.placement, newer.placement])],
      workspaceEntriesByKey: new Map([
        [older.entry.workspaceKey, older.entry],
        [keeper.entry.workspaceKey, keeper.entry],
        [newer.entry.workspaceKey, newer.entry],
      ]),
      attentionOnly: false,
      pinnedKeys: {
        pinnedWorkspaceKeys: ["srv:older", "srv:newer"],
        pinnedAtByKey: {
          "srv:older": "2026-07-01T09:00:00.000Z",
          "srv:newer": "2026-07-01T10:00:00.000Z",
        },
      },
      pinnedWorkspaceOrder: ["srv:older", "srv:newer"],
      pinnedCollapsed: false,
    });

    expect(projection.pinnedGroups.pinnedChats.map((row) => row.workspaceId)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("attentionOnly filters the pinned group as well as the projects", () => {
    const pinnedQuiet = makeWorkspace({ id: "pinned-quiet", projectKey: "p" });
    const pinnedWaiting = makeWorkspace({
      id: "pinned-waiting",
      projectKey: "p",
      status: "attention",
      needsAttentionCount: 1,
    });
    const quiet = makeWorkspace({ id: "quiet", projectKey: "p" });
    const waiting = makeWorkspace({
      id: "waiting",
      projectKey: "p",
      status: "needs_input",
      needsAttentionCount: 1,
    });

    const projection = buildSidebarProjection({
      projects: [
        makeProject("p", [
          pinnedQuiet.placement,
          pinnedWaiting.placement,
          quiet.placement,
          waiting.placement,
        ]),
      ],
      workspaceEntriesByKey: new Map([
        [pinnedQuiet.entry.workspaceKey, pinnedQuiet.entry],
        [pinnedWaiting.entry.workspaceKey, pinnedWaiting.entry],
        [quiet.entry.workspaceKey, quiet.entry],
        [waiting.entry.workspaceKey, waiting.entry],
      ]),
      attentionOnly: true,
      pinnedKeys: {
        pinnedWorkspaceKeys: ["srv:pinned-quiet", "srv:pinned-waiting"],
        pinnedAtByKey: {
          "srv:pinned-quiet": "2026-07-01T09:00:00.000Z",
          "srv:pinned-waiting": "2026-07-01T10:00:00.000Z",
        },
      },
      pinnedWorkspaceOrder: [],
      pinnedCollapsed: false,
    });

    expect(projection.pinnedGroups.pinnedChats.map((row) => row.workspaceId)).toEqual([
      "pinned-waiting",
    ]);
    expect(projection.projects[0]?.workspaces.map((row) => row.workspaceId)).toEqual(["waiting"]);
    expect(projection.needsAttentionWorkspaceCount).toBe(2);
  });

  it("gives pinned shortcut numbers back to the projects when the Pinned section is collapsed", () => {
    const pinned = makeWorkspace({ id: "pinned", projectKey: "first" });
    const keeper = makeWorkspace({ id: "keeper", projectKey: "first" });

    const projection = buildSidebarProjection({
      projects: [makeProject("first", [pinned.placement, keeper.placement])],
      workspaceEntriesByKey: new Map([
        [pinned.entry.workspaceKey, pinned.entry],
        [keeper.entry.workspaceKey, keeper.entry],
      ]),
      attentionOnly: false,
      pinnedKeys: {
        pinnedWorkspaceKeys: ["srv:pinned"],
        pinnedAtByKey: { "srv:pinned": "2026-07-01T09:00:00.000Z" },
      },
      pinnedWorkspaceOrder: [],
      pinnedCollapsed: true,
    });

    expect(projection.pinnedGroups.pinnedChats.map((row) => row.workspaceId)).toEqual(["pinned"]);
    expect(projection.shortcutModel.shortcutIndexByWorkspaceKey.get("srv:pinned")).toBeUndefined();
    expect(projection.shortcutModel.shortcutIndexByWorkspaceKey.get("srv:keeper")).toBe(1);
  });
});
