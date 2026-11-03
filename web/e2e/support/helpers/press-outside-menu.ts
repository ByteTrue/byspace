import type { Locator, Page } from "@playwright/test";

/**
 * A press outside an open menu, which closes it. A Radix menu closes on a press anywhere outside it
 * and has no backdrop element, so the press lands on the side of the window the menu is not on.
 */
export async function pressOutsideMenu(
  page: Page,
  menu: Locator,
  options: { button?: "left" | "right" } = {},
): Promise<void> {
  const viewport = page.viewportSize();
  const box = await menu.boundingBox();
  if (!viewport || !box) throw new Error("Expected an open menu to press outside of");
  const x = box.x + box.width / 2 < viewport.width / 2 ? viewport.width - 4 : 4;
  await page.mouse.click(x, Math.round(viewport.height / 2), options);
}
