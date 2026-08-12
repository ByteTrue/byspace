import { test, expect, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { openSettingsSection } from "./helpers/settings";

const SHORTCUTS_ROW = "show-shortcuts";

test.setTimeout(120_000);

async function openShortcutsSettings(page: Page) {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "shortcuts");
  await expect(page.getByText("Show keyboard shortcuts", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openRowMenu(page: Page) {
  await page.getByTestId(`shortcut-actions-${SHORTCUTS_ROW}`).click();
  await expect(page.getByTestId(`shortcut-bind-${SHORTCUTS_ROW}`)).toBeVisible();
}

async function closeRowMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`shortcut-bind-${SHORTCUTS_ROW}`)).toHaveCount(0);
}

test("shortcut clear, reload, reset, rebind, and help use the effective binding", async ({
  page,
}) => {
  await openShortcutsSettings(page);

  const dialog = page.getByTestId("keyboard-shortcuts-dialog");
  const notSet = page.getByText("Not set", { exact: true });
  const clear = page.getByTestId(`shortcut-clear-${SHORTCUTS_ROW}`);
  const reset = page.getByTestId(`shortcut-reset-${SHORTCUTS_ROW}`);
  const bind = page.getByTestId(`shortcut-bind-${SHORTCUTS_ROW}`);

  // Establish that the shipped shortcut really fires before testing Clear.
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  await openRowMenu(page);
  await expect(clear).toBeVisible();
  await expect(reset).toHaveCount(0);
  await expect(bind).toHaveText("Rebind");
  await clear.click();

  await expect(notSet).toBeVisible();
  await openRowMenu(page);
  await expect(clear).toHaveCount(0);
  await expect(reset).toBeVisible();
  await expect(bind).toHaveText("Bind");
  await closeRowMenu(page);
  await page.keyboard.press("Shift+?");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });

  // An explicit unassignment survives the Browser Web storage reload boundary.
  await page.reload();
  await expect(page).toHaveURL(/\/settings\/shortcuts$/);
  await expect(notSet).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Shift+?");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });

  // Reset removes the override and restores both the UI and runtime default.
  await openRowMenu(page);
  await reset.click();
  await expect(notSet).toHaveCount(0);
  await openRowMenu(page);
  await expect(clear).toBeVisible();
  await expect(bind).toHaveText("Rebind");
  await closeRowMenu(page);
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  // Rebind through the real capture UI and prove runtime registration follows it.
  await openRowMenu(page);
  await bind.click();
  await page.keyboard.press("Alt+Shift+K");
  await page.getByText("Done", { exact: true }).click();
  await expect(page.getByText(/(?:Alt|⌥)\+Shift\+K/, { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+?");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Alt+Shift+K");
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // The cheat sheet displays and searches the effective binding, not the shipped default.
  const row = dialog.getByTestId(`shortcut-help-row-${SHORTCUTS_ROW}`);
  await expect(row.getByText(/(?:Alt|⌥)\+Shift\+K/, { exact: true })).toBeVisible();
  await expect(row.getByText("?", { exact: true })).toHaveCount(0);
  const search = dialog.getByRole("textbox", { name: "Search shortcuts" });
  await search.fill("alt shift k");
  await expect(row).toBeVisible();
  await search.fill("?");
  await expect(row).toHaveCount(0);
});
