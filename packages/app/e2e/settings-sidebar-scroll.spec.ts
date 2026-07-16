import { test, expect } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";

test.describe("Settings sidebar scrolling", () => {
  test.use({ viewport: { width: 900, height: 260 } });

  test("scroll body remains reachable in a short browser viewport", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar).toBeVisible();

    const geometry = await sidebar.evaluate((node) => {
      let scroller: HTMLElement | null = null;
      for (const element of node.querySelectorAll<HTMLElement>("*")) {
        if (element.scrollHeight > element.clientHeight) {
          scroller = element;
          break;
        }
      }
      if (!scroller) return null;
      scroller.scrollTop = scroller.scrollHeight;
      return {
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.scrollHeight).toBeGreaterThan(geometry!.clientHeight);
    expect(geometry!.scrollTop).toBeGreaterThan(0);
  });
});
