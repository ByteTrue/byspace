import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The pinned desktop sidebar. The shell can keep a hidden copy mounted, so always read it
 * through `:visible` rather than a bare testID.
 */
export function pinnedSidebar(page: Page): Locator {
  return page.locator('[data-testid="left-sidebar"]:visible').first();
}

/**
 * A top-level sidebar destination: a row above the workspace list (Search, Schedules, Tunnels) or
 * an icon button on the Workspaces header (New workspace, History).
 */
export function topLevelNavItem(page: Page, testID: string): Locator {
  return page.locator(`[data-testid="${testID}"]:visible`).first();
}

/**
 * Clicks a top-level destination once it is on screen. The header buttons mount after the first
 * workspace list response, so the wait covers the initial skeleton load.
 */
export async function clickTopLevelNavItem(page: Page, testID: string): Promise<void> {
  const item = topLevelNavItem(page, testID);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
}
