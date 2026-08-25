import { test, expect } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";

test.describe("Settings sidebar scrolling", () => {
  test.use({ viewport: { width: 900, height: 260 } });

  test("scroll body remains reachable in a short browser viewport", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar).toBeVisible();

    const lastItem = sidebar.locator('[data-testid^="settings-"]').last();
    await lastItem.scrollIntoViewIfNeeded();
    await expect(lastItem).toBeVisible();
  });
});
