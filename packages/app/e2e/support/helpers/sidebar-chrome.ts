import { expect, type Locator, type Page } from "@playwright/test";

const TRIGGER_TEST_ID = "sidebar-nav-menu-trigger";
const MENU_TEST_ID = "sidebar-nav-menu";
/**
 * Any entry works as a probe: the menu holds and hides them together. It must be one of the
 * entries the menu actually owns — New workspace and History live on the Workspaces header, where
 * they are visible whether or not the menu is open, so probing with either of them would report
 * "already open" forever.
 */
const PROBE_ITEM_TEST_ID = "sidebar-search";

/**
 * The pinned desktop sidebar. The shell can keep a hidden copy mounted, so always read it
 * through `:visible` rather than a bare testID.
 */
export function pinnedSidebar(page: Page): Locator {
  return page.locator('[data-testid="left-sidebar"]:visible').first();
}

/**
 * A top-level sidebar destination, however the current form factor presents it: an icon button on
 * the Workspaces header, or an item in the BySpace menu.
 */
export function topLevelNavItem(page: Page, testID: string): Locator {
  return page.locator(`[data-testid="${testID}"]:visible`).first();
}

export function navMenuSurface(page: Page): Locator {
  return page.getByTestId(MENU_TEST_ID);
}

function navMenuTrigger(page: Page): Locator {
  return page.locator(`[data-testid="${TRIGGER_TEST_ID}"]:visible`).first();
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

/**
 * Waits until the menu's items are actually where the user sees them.
 *
 * An anchored surface renders its content before the anchor measurement lands, parked off-screen
 * at `-9999`, and `toBeVisible` is happy with that — it asks about the box, not the viewport. It
 * also enters with a scale keyframe, so a click or a measurement taken on the first frames reads a
 * box a few percent smaller. Poll until the first item is on screen and has stopped moving.
 *
 * The probe is any item in *this* menu, so it survives a user reordering or hiding entries.
 */
async function expectNavMenuSettled(page: Page): Promise<void> {
  const items = navMenuSurface(page).locator('[data-menu-item="true"]');
  let lastBox: { y: number; height: number } | null = null;
  await expect
    .poll(
      async () => {
        const viewport = page.viewportSize();
        const box = await items.first().boundingBox();
        if (!viewport || !box || box.width <= 0) {
          lastBox = null;
          return false;
        }
        const isOnScreen = box.y >= 0 && box.y + box.height <= viewport.height;
        const isStill = lastBox !== null && lastBox.y === box.y && lastBox.height === box.height;
        lastBox = { y: box.y, height: box.height };
        return isOnScreen && isStill;
      },
      { message: "Expected the BySpace menu to settle", timeout: 10_000 },
    )
    .toBe(true);
}

/**
 * Opens the BySpace menu.
 *
 * A no-op when the button is absent: with every entry hidden, both shells render neither the
 * button nor the menu, so there is nothing to open.
 *
 * Waits for the shell toggle first: the sidebar, and with it the trigger, mounts after the
 * first paint, so a caller that measured immediately would read an absent menu rather than a
 * closed one.
 */
export async function openTopLevelNavMenu(page: Page): Promise<void> {
  await expect(page.getByTestId("menu-button")).toBeVisible({ timeout: 30_000 });
  if (await isVisible(topLevelNavItem(page, PROBE_ITEM_TEST_ID))) return;

  const trigger = navMenuTrigger(page);
  if (!(await isVisible(trigger))) return;

  await trigger.click();
  await expectNavMenuSettled(page);
}

/**
 * Closes the menu again, leaving the shell as the test found it.
 *
 * Escape, not a second press on the trigger: an open menu paints a backdrop over the whole window,
 * so the trigger underneath is no longer clickable and the press would land on the backdrop the
 * menu engine put there.
 */
export async function closeTopLevelNavMenu(page: Page): Promise<void> {
  if (!(await isVisible(topLevelNavItem(page, PROBE_ITEM_TEST_ID)))) return;
  await page.keyboard.press("Escape");
  await expect(navMenuSurface(page)).toHaveCount(0);
}

const NON_MENU_NAV_TEST_IDS = new Set(["sidebar-global-new-workspace", "sidebar-sessions"]);

/**
 * Clicks a top-level destination, opening the menu only when the destination actually lives inside
 * the BySpace menu. New workspace + History (Workspaces header) are outside the menu — during
 * initial skeleton load the header buttons mount after the first workspace list response, so
 * opening the floating menu while waiting for them would cover them with the menu's backdrop.
 */
export async function clickTopLevelNavItem(page: Page, testID: string): Promise<void> {
  if (!NON_MENU_NAV_TEST_IDS.has(testID) && !(await isVisible(topLevelNavItem(page, testID)))) {
    await openTopLevelNavMenu(page);
  }
  const item = topLevelNavItem(page, testID);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
}
