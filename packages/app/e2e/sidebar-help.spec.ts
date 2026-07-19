import { expect, test, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";

const DISCORD_DESTINATION =
  /^https:\/\/(?:discord\.gg\/jz8T2uahpH|discord\.com\/invite\/jz8T2uahpH)(?:[/?#]|$)/;
const GITHUB_ISSUE_DESTINATION =
  /^https:\/\/github\.com\/(?:ByteTrue\/byspace\/issues\/new(?:\/choose)?(?:[/?#]|$)|login\?return_to=https%3A%2F%2Fgithub\.com%2FByteTrue%2Fbyspace%2Fissues%2Fnew$)/;
const CHANGELOG_DESTINATION = /^https:\/\/byspace\.pages\.dev\/changelog(?:[/?#]|$)/;
const APP_VERSION = /^BySpace v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function openHelpMenu(page: Page): Promise<void> {
  await page.getByTestId("sidebar-help").click();
  await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
}

async function closeSheet(page: Page, testID: string): Promise<void> {
  const sheet = page.getByTestId(testID);
  await sheet.getByLabel("Close").click();
  await expect(sheet).not.toBeVisible();
}

async function expectExternalPage(
  page: Page,
  actionTestID: string,
  expectedUrl: RegExp,
): Promise<void> {
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId(actionTestID).click();
  const popup = await popupPromise;
  expect(popup.url()).toMatch(expectedUrl);
  await popup.close();
}

test("opens help and keyboard shortcuts from the sidebar", async ({ page }) => {
  await gotoAppShell(page);
  await expect(page.getByTestId("sidebar-help")).toBeVisible();

  await openHelpMenu(page);
  const triggerBox = await page.getByTestId("sidebar-help").evaluate((element) => {
    const { y, height } = element.getBoundingClientRect();
    return { y, height };
  });
  const menuBox = await page.getByTestId("sidebar-help-menu").evaluate((element) => {
    const { y, height } = element.getBoundingClientRect();
    return { y, height };
  });
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y);
  await expect(page.getByText("Help", { exact: true })).toBeVisible();
  await expect(page.getByText("Report an issue", { exact: true })).toBeVisible();
  await expect(page.getByText("What's new", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sidebar-help-version")).toHaveText(APP_VERSION);

  await page.getByTestId("sidebar-help-shortcuts").click();
  await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
  await closeSheet(page, "keyboard-shortcuts-dialog");
});

test("opens support and release destinations", async ({ page }) => {
  await gotoAppShell(page);

  await openHelpMenu(page);
  await expectExternalPage(page, "sidebar-help-discord", DISCORD_DESTINATION);

  await openHelpMenu(page);
  await expectExternalPage(page, "sidebar-help-github", GITHUB_ISSUE_DESTINATION);

  await openHelpMenu(page);
  await expectExternalPage(page, "sidebar-help-changelog", CHANGELOG_DESTINATION);
});

test.describe("compact sidebar help", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("does not advertise keyboard shortcuts", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();

    await openHelpMenu(page);
    await expect(page.getByTestId("sidebar-help-shortcuts")).toHaveCount(0);
    await expect(page.getByText("Report an issue", { exact: true })).toBeVisible();
  });
});
