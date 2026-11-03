import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The pinned desktop sidebar while it is open. shadcn's Sidebar keeps a closed sidebar mounted,
 * slid off the left edge, so "open" is its data-state rather than visibility.
 */
export function pinnedSidebar(page: Page): Locator {
  return page.locator('[data-slot="sidebar"][data-state="expanded"] [data-testid="left-sidebar"]');
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
