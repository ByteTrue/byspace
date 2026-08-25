import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  buildSidebarShortcutModel,
  buildSidebarShortcutSections,
  getRelativeSidebarShortcutTarget,
} from "./sidebar-shortcuts";

function workspace(input: {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
  name: string;
  projectKey?: string;
  statusBucket?: SidebarWorkspaceEntry["statusBucket"];
  statusEnteredAt?: Date | null;
}): SidebarWorkspaceEntry {
  return {
    workspaceKey: `${input.serverId}:${input.workspaceId}`,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    projectKey: input.projectKey ?? "project-default",
    projectName: input.projectKey ?? "Project",
    workspaceDirectory: input.workspaceDirectory,
    projectKind: "git",
    workspaceKind: "checkout",
    name: input.name,
    title: null,
    currentBranch: null,
    statusBucket: input.statusBucket ?? "done",
    archivingAt: null,
    statusEnteredAt: input.statusEnteredAt ?? null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    agentSummary: null,
  };
}

function project(projectKey: string, workspaces: SidebarWorkspaceEntry[]): SidebarProjectEntry {
  return {
    projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: workspaces[0]?.workspaceDirectory ?? "",
    hosts: [
      {
        serverId: workspaces[0]?.serverId ?? "s1",
        iconWorkingDir: workspaces[0]?.workspaceDirectory ?? "",
        canCreateWorktree: true,
      },
    ],
    workspaces,
  };
}

describe("buildSidebarShortcutModel", () => {
  it("builds shortcut targets in visual order", () => {
    const projects = [
      project("p1", [
        workspace({
          serverId: "s1",
          workspaceId: "ws-main",
          workspaceDirectory: "/repo/main",
          name: "main",
        }),
        workspace({
          serverId: "s1",
          workspaceId: "ws-feat-a",
          workspaceDirectory: "/repo/feat-a",
          name: "feat-a",
        }),
      ]),
      project("p2", [
        workspace({
          serverId: "s1",
          workspaceId: "ws-repo2-main",
          workspaceDirectory: "/repo2/main",
          name: "main",
        }),
        workspace({
          serverId: "s1",
          workspaceId: "ws-repo2-feat-a",
          workspaceDirectory: "/repo2/feat-a",
          name: "feat-a",
        }),
      ]),
    ];

    const model = buildSidebarShortcutModel({
      projects,
    });

    expect(model.shortcutTargets).toEqual([
      { serverId: "s1", workspaceId: "ws-main" },
      { serverId: "s1", workspaceId: "ws-feat-a" },
      { serverId: "s1", workspaceId: "ws-repo2-main" },
      { serverId: "s1", workspaceId: "ws-repo2-feat-a" },
    ]);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-main")).toBe(1);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-feat-a")).toBe(2);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-repo2-main")).toBe(3);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-repo2-feat-a")).toBe(4);
  });

  it("limits shortcuts to 9", () => {
    const workspaces = Array.from({ length: 20 }, (_, index) =>
      workspace({
        serverId: "s",
        workspaceId: `ws-${index + 1}`,
        workspaceDirectory: `/repo/w${index + 1}`,
        name: `w${index + 1}`,
      }),
    );
    const projects = [project("p", workspaces)];

    const model = buildSidebarShortcutModel({
      projects,
    });

    expect(model.shortcutTargets).toHaveLength(9);
    expect(model.shortcutTargets[0]).toEqual({ serverId: "s", workspaceId: "ws-1" });
    expect(model.shortcutTargets[8]).toEqual({ serverId: "s", workspaceId: "ws-9" });
  });
});

describe("buildSidebarShortcutSections", () => {
  const pinned = workspace({
    serverId: "s1",
    workspaceId: "ws-pinned",
    workspaceDirectory: "/repo/pinned",
    name: "pinned",
  });
  const first = workspace({
    serverId: "s1",
    workspaceId: "ws-first",
    workspaceDirectory: "/repo/first",
    name: "first",
  });
  const second = workspace({
    serverId: "s1",
    workspaceId: "ws-second",
    workspaceDirectory: "/repo/second",
    name: "second",
  });

  it("numbers the Pinned section before the project sections", () => {
    const model = buildSidebarShortcutSections({
      sections: [{ workspaces: [pinned] }, { workspaces: [first, second] }],
    });

    expect(model.shortcutTargets).toEqual([
      { serverId: "s1", workspaceId: "ws-pinned" },
      { serverId: "s1", workspaceId: "ws-first" },
      { serverId: "s1", workspaceId: "ws-second" },
    ]);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-pinned")).toBe(1);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-first")).toBe(2);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-second")).toBe(3);
  });

  it("gives a collapsed section's numbers back to the rows below it", () => {
    const model = buildSidebarShortcutSections({
      sections: [{ workspaces: [pinned], collapsed: true }, { workspaces: [first, second] }],
    });

    expect(model.shortcutTargets).toEqual([
      { serverId: "s1", workspaceId: "ws-first" },
      { serverId: "s1", workspaceId: "ws-second" },
    ]);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-pinned")).toBeUndefined();
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-first")).toBe(1);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-second")).toBe(2);
  });

  it("respects the shortcut limit across sections", () => {
    const model = buildSidebarShortcutSections({
      sections: [{ workspaces: [pinned] }, { workspaces: [first, second] }],
      shortcutLimit: 2,
    });

    expect(model.shortcutTargets).toEqual([
      { serverId: "s1", workspaceId: "ws-pinned" },
      { serverId: "s1", workspaceId: "ws-first" },
    ]);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:ws-second")).toBeUndefined();
  });
});

describe("getRelativeSidebarShortcutTarget", () => {
  const targets = [
    { serverId: "s1", workspaceId: "ws-1" },
    { serverId: "s1", workspaceId: "ws-2" },
    { serverId: "s1", workspaceId: "ws-3" },
  ];

  it("moves backward and forward through the numbered shortcut target list", () => {
    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-2" },
        delta: -1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-1" });

    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-2" },
        delta: 1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-3" });
  });

  it("wraps around the numbered shortcut target list", () => {
    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-1" },
        delta: -1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-3" });

    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-3" },
        delta: 1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-1" });
  });

  it("falls back to the nearest edge when the current route is not in the numbered list", () => {
    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-hidden" },
        delta: 1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-1" });

    expect(
      getRelativeSidebarShortcutTarget({
        targets,
        currentTarget: { serverId: "s1", workspaceId: "ws-hidden" },
        delta: -1,
      }),
    ).toEqual({ serverId: "s1", workspaceId: "ws-3" });
  });
});
