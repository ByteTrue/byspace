import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { getProjectSortTier, sortProjectsByRules } from "./sidebar-sort-projects";

function makeWorkspace(overrides: Partial<SidebarWorkspaceEntry> = {}): SidebarWorkspaceEntry {
  return {
    workspaceKey: "srv:ws-1",
    serverId: "srv",
    workspaceId: "ws-1",
    projectViewKey: "project-1",
    projectName: "proj",
    workspaceDirectory: "/repo",
    workspaceDirectoryLabel: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "ws-1",
    title: null,
    currentBranch: "main",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    ...overrides,
  };
}

function makeProject(
  viewKey: string,
  projectName: string,
  workspaceKeys: string[],
): SidebarProjectEntry {
  return {
    viewKey,
    projectName,
    projectKind: "git",
    iconWorkingDir: `/${projectName}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/${projectName}`,
        worktreeSupport: "supported",
      },
    ],
    workspaces: workspaceKeys.map((workspaceKey) => ({
      workspaceKey,
      serverId: "srv",
      workspaceId: workspaceKey.split(":")[1] ?? workspaceKey,
      projectViewKey: viewKey,
      projectName,
      projectKind: "git",
      workspaceKind: "checkout",
      name: workspaceKey,
    })),
  };
}

describe("sidebar-sort-projects", () => {
  it("correctly identifies project tiers", () => {
    const entries = new Map<string, SidebarWorkspaceEntry>([
      ["srv:active-1", makeWorkspace({ workspaceKey: "srv:active-1", statusBucket: "running" })],
      ["srv:active-2", makeWorkspace({ workspaceKey: "srv:active-2", statusBucket: "attention" })],
      ["srv:idle-1", makeWorkspace({ workspaceKey: "srv:idle-1", statusBucket: "done" })],
    ]);

    const activeProject = makeProject("p-act", "Active", ["srv:active-1", "srv:idle-1"]);
    const idleProject = makeProject("p-idle", "Idle", ["srv:idle-1"]);
    const emptyProject = makeProject("p-empty", "Empty", []);

    expect(getProjectSortTier(activeProject, entries)).toBe(1);
    expect(getProjectSortTier(idleProject, entries)).toBe(2);
    expect(getProjectSortTier(emptyProject, entries)).toBe(3);

    // Missing workspace entry defaults to non-active (Tier 2)
    const missingEntryProject = makeProject("p-missing", "Missing", ["srv:unhydrated-ws"]);
    expect(getProjectSortTier(missingEntryProject, entries)).toBe(2);
  });

  it("handles natural numeric sorting within the same tier", () => {
    const entries = new Map<string, SidebarWorkspaceEntry>();
    const p1 = makeProject("p-1", "App 1", []);
    const p2 = makeProject("p-2", "App 2", []);
    const p10 = makeProject("p-10", "App 10", []);

    const sorted = sortProjectsByRules([p10, p1, p2], entries);
    expect(sorted.map((p) => p.projectName)).toEqual(["App 1", "App 2", "App 10"]);
  });

  it("sorts projects into three tiers and alphabetically within each tier", () => {
    const entries = new Map<string, SidebarWorkspaceEntry>([
      ["srv:ws-run-z", makeWorkspace({ workspaceKey: "srv:ws-run-z", statusBucket: "running" })],
      ["srv:ws-att-a", makeWorkspace({ workspaceKey: "srv:ws-att-a", statusBucket: "attention" })],
      ["srv:ws-done-m", makeWorkspace({ workspaceKey: "srv:ws-done-m", statusBucket: "done" })],
      ["srv:ws-done-b", makeWorkspace({ workspaceKey: "srv:ws-done-b", statusBucket: "done" })],
    ]);

    const projectActiveZ = makeProject("p-z", "Zeta (Active)", ["srv:ws-run-z"]);
    const projectActiveA = makeProject("p-a", "Alpha (Active)", ["srv:ws-att-a"]);
    const projectIdleM = makeProject("p-m", "Mike (Idle)", ["srv:ws-done-m"]);
    const projectIdleB = makeProject("p-b", "Bravo (Idle)", ["srv:ws-done-b"]);
    const projectEmptyY = makeProject("p-y", "Yankee (Empty)", []);
    const projectEmptyC = makeProject("p-c", "Charlie (Empty)", []);

    const unsorted = [
      projectEmptyY,
      projectIdleM,
      projectActiveZ,
      projectEmptyC,
      projectIdleB,
      projectActiveA,
    ];

    const sorted = sortProjectsByRules(unsorted, entries);
    const sortedNames = sorted.map((p) => p.projectName);

    expect(sortedNames).toEqual([
      // Tier 1: 活跃项目，按首字母 A-Z
      "Alpha (Active)",
      "Zeta (Active)",
      // Tier 2: 有 workspace 的非活跃项目，按首字母 A-Z
      "Bravo (Idle)",
      "Mike (Idle)",
      // Tier 3: 无 workspace 的项目，按首字母 A-Z
      "Charlie (Empty)",
      "Yankee (Empty)",
    ]);
  });
});
