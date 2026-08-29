import { expect, test, type Page } from "./fixtures";

test.use({ viewport: { width: 1600, height: 900 } });

async function expectBorderHighlight(page: Page, testID: string, expectedWidth: string) {
  const handle = page.getByTestId(testID);
  await expect(handle).toBeVisible();
  await expect(page.getByTestId(`${testID}-highlight`)).toHaveCount(0);

  const separator = handle.getByRole("separator");
  const hoverTarget = (await separator.count()) > 0 ? separator : handle;
  await hoverTarget.hover({ force: true });
  const highlight = page.getByTestId(`${testID}-highlight`);
  await expect(highlight).toBeVisible({ timeout: 10_000 });
  await expect(highlight).toHaveCSS("width", expectedWidth);
  await expect(highlight).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.locator("body").hover({ position: { x: 1, y: 1 }, force: true });
  await expect(page.getByTestId(`${testID}-highlight`)).toHaveCount(0);
}

test("both sidebar borders highlight on hover", async ({ page, withWorkspace }) => {
  const workspace = await withWorkspace({ prefix: "sidebar-resize-handle-" });
  await workspace.navigateTo();

  await expectBorderHighlight(page, "left-sidebar-resize-handle", "1px");

  await page.getByTestId("workspace-explorer-toggle").first().click();
  await expectBorderHighlight(page, "workspace-split-resize-handle", "3px");
});
