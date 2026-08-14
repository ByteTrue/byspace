import path from "node:path";
import { test, expect, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { expectAppRoute } from "./helpers/route-assertions";
import { seedWorkspace } from "./helpers/seed-client";
import {
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
  openSidebarPage,
} from "./helpers/sidebar";
import { buildSchedulesRoute, buildSessionsRoute } from "@/utils/host-routes";

// The sidebar's top-level pages sit behind a single trigger so that adding a page never grows the
// sidebar's fixed height. These specs hold the two properties that trade-off depends on: the rows
// really are collapsed (nothing but the trigger is resident), and the menu is still discoverable
// and reachable — by pointer, by hover hint, and by keyboard.

function pagesTrigger(page: Page) {
  return page.getByTestId("sidebar-pages").filter({ visible: true }).first();
}

async function getTopTestIdAtPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ([pointX, pointY]) => {
      const element = document.elementFromPoint(pointX, pointY);
      return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
    },
    [x, y],
  );
}

async function waitForSidebarProject(page: Page, projectName: string) {
  const row = page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: projectName })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
}

test.describe("sidebar pages menu", () => {
  test("keeps every top-level page behind one resident row", async ({ page }) => {
    await gotoAppShell(page);

    const trigger = pagesTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger).toContainText("BySpace");

    // The collapse is the point: no page keeps its own row in the sidebar.
    await expect(page.getByTestId("sidebar-sessions")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-schedules")).toHaveCount(0);

    await trigger.click();
    await expect(page.getByTestId("sidebar-pages-menu")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sidebar-sessions")).toBeVisible();
    await expect(page.getByTestId("sidebar-schedules")).toBeVisible();
  });

  // The point of the menu is a fixed cost that does not grow with the number of pages. This bound
  // fails if anyone adds a second resident row above the workspace list.
  test("costs the sidebar one row of fixed height", async ({ page }) => {
    await gotoAppShell(page);

    const header = page.getByTestId("sidebar-pages-header").filter({ visible: true }).first();
    await expect(header).toBeVisible({ timeout: 30_000 });

    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(56);
  });

  // A fixed surface width leaves the menu visibly narrower than the resizable row that opened it.
  test("lines the menu up with the row that opened it", async ({ page }) => {
    await gotoAppShell(page);

    const trigger = pagesTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();

    await trigger.click();
    const surface = page.getByTestId("sidebar-pages-menu");
    await expect(surface).toBeVisible({ timeout: 10_000 });
    // Poll past the surface's scale-in animation, which reports a narrower box mid-flight.
    await expect
      .poll(async () => Math.round((await surface.boundingBox())?.width ?? 0), { timeout: 5_000 })
      .toBe(Math.round(triggerBox!.width));

    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.x).toBeCloseTo(triggerBox!.x, 0);
  });

  test("names its destinations on hover, before any click", async ({ page }) => {
    await gotoAppShell(page);

    const trigger = pagesTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.hover();

    // Discoverability replacement for the two labels the trigger absorbed.
    await expect(page.getByText("History · Schedules", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("navigates to each page through the menu", async ({ page }) => {
    await gotoAppShell(page);

    await openSidebarPage(page, "sidebar-sessions");
    await expectAppRoute(page, buildSessionsRoute(), { timeout: 30_000 });

    await openSidebarPage(page, "sidebar-schedules");
    await expectAppRoute(page, buildSchedulesRoute(), { timeout: 30_000 });
  });

  test("opens and selects with the keyboard", async ({ page }) => {
    await gotoAppShell(page);

    const trigger = pagesTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 30_000 });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sidebar-pages-menu")).toBeVisible({ timeout: 10_000 });

    const item = page.getByTestId("sidebar-sessions");
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.press("Enter");
    await expectAppRoute(page, buildSessionsRoute(), { timeout: 30_000 });
  });

  test("does not push the workspace list when the menu opens", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-pages-menu-layout-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      const trigger = pagesTrigger(page);
      await expect(trigger).toBeVisible({ timeout: 30_000 });

      const list = page.getByTestId("sidebar-project-list").filter({ visible: true }).first();
      await expect(list).toBeVisible({ timeout: 30_000 });
      const before = await list.boundingBox();
      expect(before).not.toBeNull();

      await trigger.click();
      await expect(page.getByTestId("sidebar-pages-menu")).toBeVisible({ timeout: 10_000 });

      const after = await list.boundingBox();
      expect(after).not.toBeNull();
      expect(after!.y).toBeCloseTo(before!.y, 0);
    } finally {
      await workspace.cleanup();
    }
  });

  test.describe("compact layout", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("paints the menu above the mobile sidebar panel", async ({ page }) => {
      const workspace = await seedWorkspace({ repoPrefix: "sidebar-pages-menu-compact-" });

      try {
        await gotoAppShell(page);
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
        await waitForSidebarProject(page, path.basename(workspace.repoPath));

        await pagesTrigger(page).click();

        const item = page.getByTestId("sidebar-schedules");
        await expect(item).toBeVisible({ timeout: 10_000 });

        const box = await item.boundingBox();
        expect(box).not.toBeNull();

        // The mobile sidebar renders inside MobilePanelOverlay; the menu must escape it, not sit
        // under it.
        const topTestId = await getTopTestIdAtPoint(
          page,
          box!.x + box!.width / 2,
          box!.y + box!.height / 2,
        );
        expect(topTestId).toBe("sidebar-schedules");
      } finally {
        await workspace.cleanup();
      }
    });
  });
});
