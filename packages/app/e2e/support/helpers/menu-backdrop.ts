import type { Locator, Page } from "@playwright/test";
import { isWebFrontend } from "./frontend";

/**
 * A press outside an open menu, which closes it. packages/app's menu engine paints a backdrop over
 * the window (`<menu testID>-backdrop`); web/'s Radix menus close on a press anywhere outside them,
 * so the press lands on the side of the window the menu is not on.
 */
export async function pressOutsideMenu(
  page: Page,
  menu: Locator,
  backdrop: Locator,
  options: { button?: "left" | "right" } = {},
): Promise<void> {
  // COMPAT(web-switch): keep only the web/ branch when packages/app is deleted.
  if (!isWebFrontend) {
    await backdrop.click(options);
    return;
  }
  const viewport = page.viewportSize();
  const box = await menu.boundingBox();
  if (!viewport || !box) throw new Error("Expected an open menu to press outside of");
  const x = box.x + box.width / 2 < viewport.width / 2 ? viewport.width - 4 : 4;
  await page.mouse.click(x, Math.round(viewport.height / 2), options);
}
