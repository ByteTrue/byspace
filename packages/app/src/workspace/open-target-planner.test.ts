import { describe, expect, it } from "vitest";
import { planWorkspaceOpenTargets } from "./open-target-planner";

const checkoutStatus = {
  isGit: true,
  remoteUrl: "git@github.com:getpaseo/paseo.git",
  currentBranch: "main",
};

describe("planWorkspaceOpenTargets", () => {
  it("builds a GitHub blob target for the active file", () => {
    expect(
      planWorkspaceOpenTargets({
        workspaceDirectory: "/repo",
        activeFile: { path: "src/app.ts", lineStart: 3, lineEnd: 5 },
        checkoutStatus,
      }),
    ).toEqual([
      {
        source: "forge",
        forge: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/getpaseo/paseo/blob/main/src/app.ts#L3-L5",
      },
    ]);
  });

  it("builds a GitHub tree target without an active file", () => {
    expect(planWorkspaceOpenTargets({ workspaceDirectory: "/repo", checkoutStatus })).toEqual([
      {
        source: "forge",
        forge: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/getpaseo/paseo/tree/main",
      },
    ]);
  });

  it("infers GitLab from the remote URL", () => {
    expect(
      planWorkspaceOpenTargets({
        workspaceDirectory: "/repo",
        activeFile: { path: "src/app.ts", lineStart: 3, lineEnd: 5 },
        checkoutStatus: {
          isGit: true,
          remoteUrl: "git@gitlab.com:group/project.git",
          currentBranch: "main",
        },
      }),
    ).toEqual([
      {
        source: "forge",
        forge: "gitlab",
        id: "gitlab",
        label: "GitLab",
        url: "https://gitlab.com/group/project/-/blob/main/src/app.ts#L3-5",
      },
    ]);
  });

  it("returns no target for non-Git workspaces", () => {
    expect(
      planWorkspaceOpenTargets({
        workspaceDirectory: "/repo",
        checkoutStatus: { isGit: false },
      }),
    ).toEqual([]);
  });
});
