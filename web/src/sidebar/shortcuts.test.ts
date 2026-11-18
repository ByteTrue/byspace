import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

import { buildSidebarShortcutSections, getRelativeSidebarShortcutTarget } from "./shortcuts";

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
    projectViewKey: input.projectKey ?? "project-default",
    projectName: input.projectKey ?? "Project",
    workspaceDirectory: input.workspaceDirectory,
    workspaceDirectoryLabel: input.workspaceDirectory,
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
  };
}

describe("buildSidebarShortcutSections", () => {
  it("builds shortcut targets in visual order across every section", () => {
    const model = buildSidebarShortcutSections({
      sections: [
        {
          workspaces: [
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
          ],
        },
        {
          workspaces: [
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
          ],
        },
      ],
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

    const model = buildSidebarShortcutSections({ sections: [{ workspaces }] });

    expect(model.shortcutTargets).toHaveLength(9);
    expect(model.shortcutTargets[0]).toEqual({ serverId: "s", workspaceId: "ws-1" });
    expect(model.shortcutTargets[8]).toEqual({ serverId: "s", workspaceId: "ws-9" });
  });

  it("excludes collapsed sections from shortcut targets", () => {
    const model = buildSidebarShortcutSections({
      sections: [
        {
          workspaces: [
            workspace({
              serverId: "s1",
              workspaceId: "needs-input",
              workspaceDirectory: "/repo/needs-input",
              name: "needs input",
              statusBucket: "needs_input",
            }),
          ],
          collapsed: true,
        },
        {
          workspaces: [
            workspace({
              serverId: "s1",
              workspaceId: "running",
              workspaceDirectory: "/repo/running",
              name: "running",
              statusBucket: "running",
            }),
          ],
        },
      ],
    });

    expect(model.shortcutTargets).toEqual([{ serverId: "s1", workspaceId: "running" }]);
    expect(model.shortcutIndexByWorkspaceKey.get("s1:needs-input")).toBeUndefined();
    expect(model.shortcutIndexByWorkspaceKey.get("s1:running")).toBe(1);
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
