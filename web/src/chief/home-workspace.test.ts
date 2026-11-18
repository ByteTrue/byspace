import { describe, expect, it } from "vitest";
import {
  findHomeWorkspace,
  HOME_PROJECT_VIEW_KEY,
  HOME_WORKSPACE_LABEL,
  isHomeProjectViewKey,
  isHomeWorkspace,
} from "./home-workspace";
import type { WorkspaceDescriptor } from "@/stores/session-store";

function workspace(id: string, labels?: string[]): WorkspaceDescriptor {
  return {
    id,
    projectId: "prj",
    projectDisplayName: "app",
    projectCustomName: null,
    projectRootPath: "/app",
    workspaceDirectory: "/app",
    projectKind: "directory",
    workspaceKind: "local_checkout",
    name: "chief",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...(labels ? { labels } : {}),
  };
}

describe("isHomeWorkspace", () => {
  it("matches only the reserved byspace.home-workspace label", () => {
    expect(isHomeWorkspace({ labels: [HOME_WORKSPACE_LABEL] })).toBe(true);
    expect(isHomeWorkspace({ labels: ["other", HOME_WORKSPACE_LABEL] })).toBe(true);
    expect(isHomeWorkspace({ labels: ["other"] })).toBe(false);
    expect(isHomeWorkspace({ labels: [] })).toBe(false);
    expect(isHomeWorkspace(null)).toBe(false);
    expect(isHomeWorkspace(undefined)).toBe(false);
  });
});

describe("isHomeProjectViewKey", () => {
  it("matches only the reserved project view key", () => {
    expect(isHomeProjectViewKey(HOME_PROJECT_VIEW_KEY)).toBe(true);
    expect(isHomeProjectViewKey("remote:github.com/acme/app")).toBe(false);
    expect(isHomeProjectViewKey(null)).toBe(false);
  });
});

describe("every renderer asks one question", () => {
  // The sidebar reaches a workspace row from three places: its project block, the status/label
  // groups, and the Pinned section. Only the first has a project in scope, so the fixed-row rule
  // has to be answerable from the workspace alone — the row, the global pin shortcut, the global
  // rename dialog and the command center all call `isHomeWorkspace(descriptor)`.
  it("answers from the workspace descriptor, which every surface holds", () => {
    const descriptor = workspace("wks_home", [HOME_WORKSPACE_LABEL]);
    expect(isHomeWorkspace(descriptor)).toBe(true);
  });

  it("does not depend on a project view key", () => {
    // A row rendered outside its project block still has to be recognised, and the project key is
    // the one field that changes between renderers (the merged Home project rewrites it).
    const descriptor = workspace("wks_home", [HOME_WORKSPACE_LABEL]);
    expect(isHomeWorkspace(descriptor)).toBe(true);
    expect(isHomeProjectViewKey(HOME_PROJECT_VIEW_KEY)).toBe(true);
    expect(isHomeProjectViewKey(descriptor.projectId)).toBe(false);
  });
});

describe("findHomeWorkspace", () => {
  it("returns the workspace carrying the reserved label", () => {
    const home = findHomeWorkspace([
      workspace("wks_repo"),
      workspace("wks_home", [HOME_WORKSPACE_LABEL]),
    ]);
    expect(home?.id).toBe("wks_home");
  });

  it("returns null when no workspace carries the reserved label", () => {
    expect(findHomeWorkspace([workspace("wks_repo", ["custom"])])).toBeNull();
    expect(findHomeWorkspace(null)).toBeNull();
  });
});
