import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import {
  HEADER_NAV_KEYS,
  expectHeaderNavOrder,
  expectSidebarItemHidden,
  expectSidebarNavSettingsOrder,
  expectSidebarNavSettingsRow,
  expectSidebarOrder,
  expectStoredSidebarNav,
  leaveSettings,
  moveSidebarNavItemUp,
  openSidebarNavSettings,
  seedSidebarNavPreferences,
  setSidebarNavItemVisible,
} from "../support/helpers/sidebar-nav-settings";

/**
 * The compact close button's painted right edge, or -1 while it has no box. Read through a
 * poll rather than once, because the panel slides in via transform and a single measurement
 * can catch it mid-flight.
 */
async function closeButtonRightEdge(page: Page): Promise<number> {
  const box = await page.getByTestId("sidebar-close").boundingBox();
  return box ? box.x + box.width : -1;
}

test.describe("Sidebar items in Appearance settings", () => {
  test("owner reorders and hides top-level sidebar items", async ({ page }) => {
    await gotoAppShell(page);

    await test.step("the sidebar starts in the default shape", async () => {
      // Chief sits on the top row, New workspace and History sit on the Workspaces header, and
      // the BySpace menu holds the rest.
      await expect(page.getByTestId("sidebar-chief")).toBeVisible();
      await expectHeaderNavOrder(page, HEADER_NAV_KEYS);
      await expectSidebarOrder(page, ["search", "schedules", "tunnels"]);
    });

    await test.step("the Sidebar section lists every item in the same order", async () => {
      await openSidebarNavSettings(page);
      // The section explains itself through the header's info tooltip, not a paragraph.
      await expect(page.getByTestId("sidebar-nav-section-info")).toHaveAccessibleName(
        "About Sidebar",
      );
      await expectSidebarNavSettingsOrder(page, [
        "new-workspace",
        "history",
        "chief",
        "search",
        "schedules",
        "tunnels",
      ]);
      await expectSidebarNavSettingsRow(page, {
        key: "history",
        label: "History",
        visible: true,
      });
      // Items with a keyboard shortcut badge it next to their name.
      const modPrefix = process.platform === "darwin" ? "⌘" : "Ctrl+";
      await expect(
        page
          .getByTestId("sidebar-nav-item-new-workspace")
          .getByText(`${modPrefix}N`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId("sidebar-nav-item-chief").getByText(`${modPrefix}J`, { exact: true }),
      ).toBeVisible();
    });

    await test.step("the fixed top-row and header items offer no reorder control", async () => {
      // They are placed by the shell's layout, so a Move up/down there would do nothing.
      await expect(page.getByTestId("sidebar-nav-move-up-new-workspace")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-move-up-history")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-move-up-chief")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-move-up-search")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-move-up-schedules")).toBeVisible();
    });

    await test.step("Search cannot move up past the fixed items, and Schedules can lift above Search", async () => {
      // Search is first in the BySpace menu. The fixed items sit above it in this list but are
      // not part of its run, so there is nothing above it to trade places with.
      await expect(
        page
          .getByTestId("sidebar-nav-item-search")
          .getByRole("button", { name: "Move up", exact: true }),
      ).toBeDisabled();

      await moveSidebarNavItemUp(page, "schedules");
      await expectSidebarNavSettingsOrder(page, [
        "new-workspace",
        "history",
        "chief",
        "schedules",
        "search",
        "tunnels",
      ]);

      await leaveSettings(page);
      await expectHeaderNavOrder(page, HEADER_NAV_KEYS);
      await expectSidebarOrder(page, ["schedules", "search", "tunnels"]);
    });

    await test.step("turning History off removes it from the header", async () => {
      await openSidebarNavSettings(page);
      await setSidebarNavItemVisible(page, "history", false);
      await expectStoredSidebarNav(page, [
        { key: "new-workspace", visible: true },
        { key: "history", visible: false },
        { key: "chief", visible: true },
        { key: "schedules", visible: true },
        { key: "search", visible: true },
        { key: "tunnels", visible: true },
      ]);

      await leaveSettings(page);
      await expect(page.getByTestId("sidebar-sessions")).toHaveCount(0);
      await expectHeaderNavOrder(page, ["new-workspace"]);
      await expectSidebarOrder(page, ["schedules", "search", "tunnels"]);
    });

    await test.step("the sidebar keeps that shape across a reload", async () => {
      await page.reload();
      await expect(page.getByTestId("sidebar-sessions")).toHaveCount(0);
      await expectHeaderNavOrder(page, ["new-workspace"]);
      await expectSidebarOrder(page, ["schedules", "search", "tunnels"]);
    });
  });

  test("renders no top-level items when every one is turned off", async ({ page }) => {
    await seedSidebarNavPreferences(page, [
      { key: "new-workspace", visible: false },
      { key: "history", visible: false },
      { key: "chief", visible: false },
      { key: "search", visible: false },
      { key: "schedules", visible: false },
      { key: "tunnels", visible: false },
    ]);
    await gotoAppShell(page);

    // The sidebar itself still renders; only its top-level nav items are gone.
    await expect(page.locator('[data-testid="sidebar-settings"]:visible')).toBeVisible({
      timeout: 30_000,
    });
    await expectSidebarItemHidden(page, "new-workspace");
    await expectSidebarItemHidden(page, "history");
    await expectSidebarItemHidden(page, "chief");
    await expectSidebarItemHidden(page, "search");
    await expectSidebarItemHidden(page, "schedules");
    await expectSidebarItemHidden(page, "tunnels");

    // With nothing to reveal, the BySpace button goes with the rows; the collapse toggle is
    // unaffected because it is the shell's, not the disclosure's.
    await expect(page.getByTestId("sidebar-nav-menu-trigger")).toHaveCount(0);
    await expect(page.getByTestId("menu-button")).toBeVisible();
  });
});

// Its own describe so the poll below sits under a single wrapper: `max-nested-callbacks` counts
// describe/test/poll as three levels.
test.describe("Compact sidebar with every nav item turned off", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("keeps the close button on its right rail", async ({ page }) => {
    await seedSidebarNavPreferences(page, [
      { key: "new-workspace", visible: false },
      { key: "history", visible: false },
      { key: "chief", visible: false },
      { key: "search", visible: false },
      { key: "schedules", visible: false },
      { key: "tunnels", visible: false },
    ]);
    await gotoAppShell(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);

    await expect(page.getByTestId("sidebar-nav-menu-trigger")).toHaveCount(0);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    await expect
      .poll(() => closeButtonRightEdge(page), { timeout: 10_000 })
      .toBeGreaterThan(viewport!.width - 24);
  });
});
