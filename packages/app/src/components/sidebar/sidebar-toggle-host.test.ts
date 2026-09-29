import { describe, expect, it } from "vitest";
import { resolveSidebarToggleHost } from "./sidebar-toggle-host";

/**
 * The two hosts of the collapse toggle are complements, not independent conditions. Assert
 * the whole table here so a future edit cannot make both render (two `menu-button`s) or
 * neither (the toggle disappears).
 */
describe("resolveSidebarToggleHost", () => {
  const states = [
    { isCompact: true, desktopSidebarVisible: false },
    { isCompact: true, desktopSidebarVisible: true },
    { isCompact: false, desktopSidebarVisible: false },
    { isCompact: false, desktopSidebarVisible: true },
  ];

  it("returns exactly one host in every state", () => {
    const hosts = states.map(resolveSidebarToggleHost);
    expect(hosts).toEqual(["content", "content", "content", "sidebar"]);
  });

  it("never lets the pinned sidebar claim a compact layout", () => {
    // A compact layout shows the toggle in its content header even if the retained desktop
    // sidebar is still mounted, because the overlay's toggle is the hamburger.
    expect(resolveSidebarToggleHost({ isCompact: true, desktopSidebarVisible: true })).toBe(
      "content",
    );
  });

  it("hands the toggle to the pinned sidebar only when it is visible", () => {
    expect(resolveSidebarToggleHost({ isCompact: false, desktopSidebarVisible: true })).toBe(
      "sidebar",
    );
    expect(resolveSidebarToggleHost({ isCompact: false, desktopSidebarVisible: false })).toBe(
      "content",
    );
  });
});
