import { test, expect } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";

test.describe("Settings sidebar scrolling", () => {
  test.use({ viewport: { width: 900, height: 260 } });

  test("scroll body remains reachable in a short browser viewport", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar).toBeVisible();

    const scrollable = await sidebar.evaluate((node) => {
      for (const element of node.querySelectorAll<HTMLElement>("*")) {
        if (element.scrollHeight <= element.clientHeight) continue;
        const before = element.scrollTop;
        element.scrollTop = element.scrollHeight;
        return element.scrollTop > before;
      }
      return false;
    });

    expect(scrollable).toBe(true);
  });
});
