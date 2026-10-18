import { expect, type Locator, type Page } from "@playwright/test";
import { openSettings } from "./app";
import { closeTopLevelNavMenu, openTopLevelNavMenu, topLevelNavItem } from "./sidebar-chrome";
import { clickSettingsBackToWorkspace, openSettingsSection } from "./settings";

const APP_SETTINGS_KEY = "@byspace:app-settings";

/**
 * Persisted nav key -> the testID the app shell renders that item with. Mirrors the app's
 * `SIDEBAR_NAV_TEST_IDS`; the shell renders them on the Workspaces header or inside the BySpace
 * menu, and both keep the same ids so this table does not care which is showing.
 */
const SHELL_ROW_TEST_IDS = {
  "new-workspace": "sidebar-global-new-workspace",
  history: "sidebar-sessions",
  search: "sidebar-search",
  schedules: "sidebar-schedules",
  tunnels: "sidebar-tunnels",
} as const;

export type SidebarNavKey = keyof typeof SHELL_ROW_TEST_IDS;

export interface SidebarNavPreference {
  key: string;
  visible: boolean;
}

function shellRow(page: Page, key: SidebarNavKey): Locator {
  return topLevelNavItem(page, SHELL_ROW_TEST_IDS[key]);
}

function settingsRow(page: Page, key: SidebarNavKey): Locator {
  return page.getByTestId(`sidebar-nav-item-${key}`);
}

function itemLabel(key: SidebarNavKey): string {
  return {
    "new-workspace": "New workspace",
    history: "History",
    search: "Search",
    schedules: "Schedules",
    tunnels: "Tunnels",
  }[key];
}

async function rowTop(locator: Locator): Promise<number | null> {
  const box = await locator.boundingBox();
  return box?.y ?? null;
}

export async function seedSidebarNavPreferences(
  page: Page,
  preferences: SidebarNavPreference[],
): Promise<void> {
  await page.addInitScript(
    ({ key, sidebarNavItems }) => {
      localStorage.setItem(key, JSON.stringify({ sidebarNavItems }));
    },
    { key: APP_SETTINGS_KEY, sidebarNavItems: preferences },
  );
}

export async function openSidebarNavSettings(page: Page): Promise<void> {
  await openSettings(page);
  await openSettingsSection(page, "appearance");
  await expect(page.getByTestId("sidebar-nav-section")).toBeVisible({ timeout: 30_000 });
}

export async function leaveSettings(page: Page): Promise<void> {
  await clickSettingsBackToWorkspace(page);
}

export async function moveSidebarNavItemUp(page: Page, key: SidebarNavKey): Promise<void> {
  await settingsRow(page, key).getByRole("button", { name: "Move up", exact: true }).click();
}

export async function setSidebarNavItemVisible(
  page: Page,
  key: SidebarNavKey,
  visible: boolean,
): Promise<void> {
  const toggle = settingsRow(page, key).getByRole("switch", {
    name: itemLabel(key),
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(visible));
}

export async function expectSidebarNavSettingsRow(
  page: Page,
  expected: { key: SidebarNavKey; label: string; visible: boolean },
): Promise<void> {
  const row = settingsRow(page, expected.key);
  await expect(row).toBeVisible();
  await expect(row.getByText(expected.label, { exact: true })).toBeVisible();
  const toggle = row.getByRole("switch", { name: expected.label, exact: true });
  await expect(toggle).toHaveAccessibleName(expected.label);
  await expect(toggle).toHaveAttribute("aria-checked", String(expected.visible));
}

export async function expectSidebarNavSettingsOrder(
  page: Page,
  keys: SidebarNavKey[],
): Promise<void> {
  await expectVerticalOrder(keys, (key) => settingsRow(page, key), "sidebar nav settings rows");
}

/**
 * The order of the entries inside the BySpace menu.
 *
 * New workspace and History are deliberately not accepted here: they live on the Workspaces
 * header, which sits *below* the menu, so including them would compare two columns that are not
 * one list. Use `expectHeaderNavOrder` for those.
 */
export async function expectSidebarOrder(page: Page, keys: SidebarNavKey[]): Promise<void> {
  await openTopLevelNavMenu(page);
  try {
    await expectVerticalOrder(keys, (key) => shellRow(page, key), "app shell sidebar items");
  } finally {
    await closeTopLevelNavMenu(page);
  }
}

/**
 * The Workspaces header's icon buttons: always on screen, in a fixed left-to-right order.
 *
 * Horizontal, unlike every other order assertion here — these are one row of controls, so reading
 * them top-to-bottom would compare a number they all share.
 */
export async function expectHeaderNavOrder(
  page: Page,
  keys: readonly SidebarNavKey[],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const measured = await Promise.all(
          keys.map(async (key) => {
            const box = await shellRow(page, key).boundingBox();
            return { key, left: box?.x ?? null };
          }),
        );
        if (
          !measured.every(
            (entry): entry is { key: SidebarNavKey; left: number } => entry.left !== null,
          )
        ) {
          return null;
        }
        return measured.sort((a, b) => a.left - b.left).map((entry) => entry.key);
      },
      { message: "Expected the Workspaces header buttons in order", timeout: 15_000 },
    )
    .toEqual(keys);
}

export async function expectSidebarItemHidden(page: Page, key: SidebarNavKey): Promise<void> {
  await openTopLevelNavMenu(page);
  try {
    await expect(topLevelNavItem(page, SHELL_ROW_TEST_IDS[key])).toHaveCount(0);
  } finally {
    await closeTopLevelNavMenu(page);
  }
}

/** The two the Workspaces header owns, in the order the header draws them. */
export const HEADER_NAV_KEYS: readonly SidebarNavKey[] = ["new-workspace", "history"];

export async function expectStoredSidebarNav(
  page: Page,
  expected: SidebarNavPreference[],
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? (JSON.parse(raw).sidebarNavItems ?? null) : null;
        }, APP_SETTINGS_KEY),
      { timeout: 15_000 },
    )
    .toEqual(expected);
}

async function expectVerticalOrder(
  keys: SidebarNavKey[],
  locate: (key: SidebarNavKey) => Locator,
  subject: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const measured = await Promise.all(
          keys.map(async (key) => ({ key, top: await rowTop(locate(key)) })),
        );
        if (
          !measured.every(
            (entry): entry is { key: SidebarNavKey; top: number } => entry.top !== null,
          )
        )
          return null;
        return measured.sort((a, b) => a.top - b.top).map((entry) => entry.key);
      },
      { message: `Expected ${subject} in order`, timeout: 15_000 },
    )
    .toEqual(keys);
}
