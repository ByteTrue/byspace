import { describe, expect, it } from "vitest";
import {
  resolveIsExplorerDockRendered,
  resolveWorkspaceExplorerToggleOwner,
} from "./workspace-explorer-toggle";

/**
 * The Explorer toggle must have exactly one host in every state. These two resolvers are the
 * whole decision, so assert the table rather than the call site that feeds them.
 */
describe("resolveWorkspaceExplorerToggleOwner", () => {
  it("lets compact own the toggle regardless of the dock", () => {
    expect(resolveWorkspaceExplorerToggleOwner({ isMobile: true, isDockRendered: true })).toBe(
      "mobile",
    );
    expect(resolveWorkspaceExplorerToggleOwner({ isMobile: true, isDockRendered: false })).toBe(
      "mobile",
    );
  });

  it("hands the toggle to the dock only while the dock renders", () => {
    expect(resolveWorkspaceExplorerToggleOwner({ isMobile: false, isDockRendered: true })).toBe(
      "dock",
    );
    expect(resolveWorkspaceExplorerToggleOwner({ isMobile: false, isDockRendered: false })).toBe(
      "content",
    );
  });
});

describe("resolveIsExplorerDockRendered", () => {
  const open = {
    canRenderDesktopPaneSplits: true,
    isFocusModeEnabled: false,
    isExplorerSidebarShowing: true,
  };

  it("renders only when splits, no focus mode, and the Explorer is showing", () => {
    expect(resolveIsExplorerDockRendered(open)).toBe(true);
    expect(resolveIsExplorerDockRendered({ ...open, isExplorerSidebarShowing: false })).toBe(false);
    expect(resolveIsExplorerDockRendered({ ...open, canRenderDesktopPaneSplits: false })).toBe(
      false,
    );
    // Focus mode hides both the dock and the content header, so neither host claims the toggle.
    expect(resolveIsExplorerDockRendered({ ...open, isFocusModeEnabled: true })).toBe(false);
  });
});
