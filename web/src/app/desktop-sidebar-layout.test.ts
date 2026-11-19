import { describe, expect, it } from "vitest";
import {
  canDesktopAppSidebarShare,
  resolveDesktopAppContentMinimum,
  resolveDesktopSidebarVisibility,
  resolveDesktopSidebarWidth,
} from "@/app/desktop-sidebar-layout";

describe("desktop sidebar layout", () => {
  it("draws the stored width within its bounds, leaving the content 400px", () => {
    expect(resolveDesktopSidebarWidth({ requestedWidth: 600, viewportWidth: 1440 })).toBe(600);
    expect(resolveDesktopSidebarWidth({ requestedWidth: 600, viewportWidth: 800 })).toBe(400);
    expect(resolveDesktopSidebarWidth({ requestedWidth: 900, viewportWidth: 1440 })).toBe(600);
    expect(resolveDesktopSidebarWidth({ requestedWidth: 100, viewportWidth: 1440 })).toBe(200);
    expect(resolveDesktopSidebarWidth({ requestedWidth: 300, viewportWidth: 500 })).toBe(200);
  });

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

  it("yields app navigation when settings needs the shell width", () => {
    const settingsMinimum = resolveDesktopAppContentMinimum({ isSettingsRoute: true });
    expect(settingsMinimum).toBe(720);
    expect(
      canDesktopAppSidebarShare({
        contentMinimumWidth: settingsMinimum,
        sidebarWidth: 320,
        viewportWidth: 751,
      }),
    ).toBe(false);
  });

  it("imposes no content minimum outside settings", () => {
    expect(resolveDesktopAppContentMinimum({ isSettingsRoute: false })).toBe(0);
    expect(
      canDesktopAppSidebarShare({
        contentMinimumWidth: resolveDesktopAppContentMinimum({ isSettingsRoute: false }),
        sidebarWidth: 320,
        viewportWidth: 751,
      }),
    ).toBe(true);
  });
});
