import { describe, expect, it } from "vitest";
import { planWorkspaceOpenTargets } from "./open-target-planner";

const checkoutStatus = {
  isGit: true,
  remoteUrl: "git@github.com:ByteTrue/byspace.git",
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
        source: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/ByteTrue/byspace/blob/main/src/app.ts#L3-L5",
      },
    ]);
  });

  it("builds a GitHub tree target without an active file", () => {
    expect(planWorkspaceOpenTargets({ workspaceDirectory: "/repo", checkoutStatus })).toEqual([
      {
        source: "github",
        id: "github",
        label: "GitHub",
        url: "https://github.com/ByteTrue/byspace/tree/main",
      },
    ]);
  });
});
