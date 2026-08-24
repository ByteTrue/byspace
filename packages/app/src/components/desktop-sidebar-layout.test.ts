import { describe, expect, it } from "vitest";
import {
  canDesktopAppSidebarShare,
  resolveDesktopAppChromeLayout,
  resolveDesktopAppContentMinimum,
  resolveDesktopSidebarVisibility,
  resolveDesktopSidebarWidth,
} from "@/components/desktop-sidebar-layout";

describe("desktop sidebar layout", () => {
  it("keeps a retained sidebar hidden while app chrome is suppressed", () => {
    expect(
      resolveDesktopSidebarVisibility({
        chromeEnabled: false,
        isCompactLayout: false,
        isMounted: true,
        isOpen: true,
        canShare: true,
      }),
    ).toBe(false);
  });

  it("assigns chrome ownership independently of workspace Explorer state", () => {
    expect(
      resolveDesktopAppChromeLayout({
        desktopSidebarRendered: true,
        hasTopLeftWindowControls: true,
        sidebarControlsEnabled: true,
      }),
    ).toEqual({
      sidebarCorners: "top-left",
      contentCorners: "top-right",
      sidebarToggleOwner: "window",
    });
  });

  it("clamps sidebar width while retaining the center minimum", () => {
    expect(resolveDesktopSidebarWidth({ requestedWidth: 900, viewportWidth: 1_000 })).toBe(600);
    expect(
      canDesktopAppSidebarShare({
        contentMinimumWidth: 640,
        requestedSidebarWidth: 320,
        viewportWidth: 1_200,
      }),
    ).toBe(true);
    expect(resolveDesktopAppContentMinimum({ isSettingsRoute: false })).toBe(0);
  });
});
