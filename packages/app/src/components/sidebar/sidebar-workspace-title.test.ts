import { describe, expect, it } from "vitest";
import {
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it("uses the workspace name in title mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search" },
      workspaceTitleSource: "title",
    });

    expect(label).toBe("Investigate search");
  });

  it("uses the branch name in branch mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search" },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("fix/search");
  });

  it("falls back to the workspace name in branch mode without a branch", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Local folder", currentBranch: null },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("Local folder");
  });
});

describe("resolveSidebarWorkspaceAccessibilityLabel", () => {
  it("composes the authoritative row label and omits missing metadata", () => {
    expect(
      resolveSidebarWorkspaceAccessibilityLabel({
        workspace: { name: "Investigate search", currentBranch: "fix/search" },
        workspaceTitleSource: "branch",
        projectName: "BySpace",
        hostLabel: "Remote",
        pullRequestLabel: "Pull request 42",
        checksLabel: "Checks failed",
        serviceLabel: null,
        statusLabel: "Needs attention",
      }),
    ).toBe("BySpace, fix/search, Remote, Pull request 42, Checks failed, Needs attention");
  });
});
