import { describe, expect, it } from "vitest";
import { planWorkspaceOpenTargets } from "./planner";

const checkoutStatus = {
  isGit: true,
  remoteUrl: "git@github.com:bytetrue/byspace.git",
  currentBranch: "main",
};

describe("planWorkspaceOpenTargets", () => {
  it("uses blob and tree URLs for the forge target", () => {
    const blobTargets = planWorkspaceOpenTargets({
      workspaceDirectory: "/repo",
      activeFile: { path: "src/app.ts", lineStart: 3, lineEnd: 5 },
      checkoutStatus,
    });
    const treeTargets = planWorkspaceOpenTargets({
      workspaceDirectory: "/repo",
      checkoutStatus,
    });

    expect(blobTargets).toEqual([
      {
        source: "forge",
        forge: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/bytetrue/byspace/blob/main/src/app.ts#L3-L5",
      },
    ]);
    expect(treeTargets).toEqual([
      {
        source: "forge",
        forge: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/bytetrue/byspace/tree/main",
      },
    ]);
  });

  it("infers the forge from the remote URL when the forge input is null", () => {
    const targets = planWorkspaceOpenTargets({
      workspaceDirectory: "/repo",
      activeFile: { path: "src/app.ts", lineStart: 3, lineEnd: 5 },
      checkoutStatus: {
        isGit: true,
        remoteUrl: "git@gitlab.com:group/project.git",
        currentBranch: "main",
      },
      forge: null,
    });

    expect(targets).toEqual([
      {
        source: "forge",
        forge: "gitlab",
        id: "gitlab",
        label: "GitLab",
        url: "https://gitlab.com/group/project/-/blob/main/src/app.ts#L3-5",
      },
    ]);
  });

  it("returns no targets without git checkout status", () => {
    expect(planWorkspaceOpenTargets({ workspaceDirectory: "/repo" })).toEqual([]);
    expect(
      planWorkspaceOpenTargets({
        workspaceDirectory: "/repo",
        checkoutStatus: { isGit: false, remoteUrl: null, currentBranch: null },
      }),
    ).toEqual([]);
  });
});
