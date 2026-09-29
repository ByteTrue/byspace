import { expect, type Locator, type Page } from "@playwright/test";

const TRIGGER_TEST_ID = "sidebar-nav-menu-trigger";
/** Any entry works as a probe: the disclosure reveals and hides them together. */
const PROBE_ITEM_TEST_ID = "sidebar-global-new-workspace";

/**
 * The pinned desktop sidebar. The shell can keep a hidden copy mounted, so always read it
 * through `:visible` rather than a bare testID.
 */
export function pinnedSidebar(page: Page): Locator {
  return page.locator('[data-testid="left-sidebar"]:visible').first();
}

/**
 * A top-level sidebar destination, however the current form factor presents it: a row under
 * the desktop BySpace button, or a row in the compact sidebar's overlay.
 */
export function topLevelNavItem(page: Page, testID: string): Locator {
  return page.locator(`[data-testid="${testID}"]:visible`).first();
}

function navMenuTrigger(page: Page): Locator {
  return page.locator(`[data-testid="${TRIGGER_TEST_ID}"]:visible`).first();
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

/**
 * Reveals the top-level destinations behind the BySpace button.
 *
 * A no-op when the button is absent: with every entry hidden, both shells render neither the
 * button nor the rows, so there is nothing to reveal. Compact is *not* a no-op — it folds the
 * same entries behind the same trigger, so this clicks that one too.
 *
 * Waits for the shell toggle first: the sidebar, and with it the trigger, mounts after the
 * first paint, so a caller that measured immediately would read an absent disclosure rather
 * than a collapsed one.
 */
export async function openTopLevelNavMenu(page: Page): Promise<void> {
  await expect(page.getByTestId("menu-button")).toBeVisible({ timeout: 30_000 });
  if (await isVisible(topLevelNavItem(page, PROBE_ITEM_TEST_ID))) return;

  const trigger = navMenuTrigger(page);
  if (!(await isVisible(trigger))) return;

  await trigger.click();
  await expect(topLevelNavItem(page, PROBE_ITEM_TEST_ID)).toBeVisible({ timeout: 10_000 });
}

/** Collapses the disclosure again, leaving the pinned sidebar as the test found it. */
export async function closeTopLevelNavMenu(page: Page): Promise<void> {
  if (!(await isVisible(topLevelNavItem(page, PROBE_ITEM_TEST_ID)))) return;
  const trigger = navMenuTrigger(page);
  if (!(await isVisible(trigger))) return;

  await trigger.click();
  await expect(topLevelNavItem(page, PROBE_ITEM_TEST_ID)).toHaveCount(0);
}

/** Reveals the disclosure when needed, then clicks the destination. */
export async function clickTopLevelNavItem(page: Page, testID: string): Promise<void> {
  await openTopLevelNavMenu(page);
  const item = topLevelNavItem(page, testID);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
}
