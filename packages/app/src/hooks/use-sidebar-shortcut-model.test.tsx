/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarShortcutModel } from "./use-sidebar-shortcut-model";

function workspace(projectKey: string, workspaceId: string): SidebarWorkspaceEntry {
  return {
    workspaceKey: `srv:${workspaceId}`,
    serverId: "srv",
    workspaceId,
    projectViewKey: projectKey,
    projectName: projectKey,
    projectRootPath: `/repo/${projectKey}`,
    workspaceDirectory: `/repo/${projectKey}/${workspaceId}`,
    workspaceDirectoryLabel: `/repo/${projectKey}/${workspaceId}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    title: null,
    currentBranch: null,
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

function project(projectKey: string): SidebarProjectEntry {
  return {
    viewKey: projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: `/repo/${projectKey}`,
    hosts: [],
    workspaces: [workspace(projectKey, `${projectKey}-main`)],
  };
}

const PROJECTS_BOTH = [project("p1"), project("p2")];
const PROJECTS_ONLY_SECOND = [project("p2")];

let lastIndexByKey: Map<string, number> | null = null;

function Probe({ projectSet }: { projectSet: "both" | "onlySecond" }) {
  const projects = projectSet === "both" ? PROJECTS_BOTH : PROJECTS_ONLY_SECOND;
  const { shortcutIndexByWorkspaceKey } = useSidebarShortcutModel({ projects });
  lastIndexByKey = shortcutIndexByWorkspaceKey;
  return null;
}

describe("useSidebarShortcutModel", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("renumbers shortcut targets when the project list changes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe projectSet="both" />);
    });
    expect(lastIndexByKey?.get("srv:p1-main")).toBe(1);
    expect(lastIndexByKey?.get("srv:p2-main")).toBe(2);

    await act(async () => {
      root?.render(<Probe projectSet="onlySecond" />);
    });
    expect(lastIndexByKey?.has("srv:p1-main")).toBe(false);
    expect(lastIndexByKey?.get("srv:p2-main")).toBe(1);
  });
});
