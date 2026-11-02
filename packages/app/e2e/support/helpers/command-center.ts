import { expect, type Locator, type Page } from "@playwright/test";
import { clickTopLevelNavItem } from "./sidebar-chrome";

// Opens the command center / global search palette from the sidebar and returns its panel.
export async function openCommandCenter(page: Page): Promise<Locator> {
  await clickTopLevelNavItem(page, "sidebar-search");
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

/**
 * The command center's rows: options of its listbox in web/ (cmdk), buttons in packages/app.
 * COMPAT(web-switch): drop the button half when packages/app is deleted.
 */
export function commandCenterRows(
  panel: Locator,
  options?: Parameters<Locator["getByRole"]>[1],
): Locator {
  return panel.getByRole("option", options).or(panel.getByRole("button", options));
}

export async function closeCommandCenter(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center-panel")).not.toBeVisible();
}
