import { test, expect } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({ repoPrefix: "workspace-pins-e2e-" });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("Pinned workspace targets", () => {
  test("pinning a workspace from the sidebar menu adds it to the pinned section, unpinning removes it", async ({
    page,
  }) => {
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    await gotoAppShell(page);

    const projectRow = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
    await expect(projectRow).toBeVisible({ timeout: 30_000 });

    const pinnedSection = page.getByTestId("sidebar-pinned-section");
    await expect(pinnedSection.getByTestId(`sidebar-workspace-row-${workspaceKey}`)).toHaveCount(0);

    await projectRow.hover();
    await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
    await page.getByTestId(`sidebar-workspace-menu-pin-${workspaceKey}`).click();

    await expect(pinnedSection.getByTestId(`sidebar-workspace-row-${workspaceKey}`)).toBeVisible({
      timeout: 10_000,
    });

    const pinnedRow = pinnedSection.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
    await pinnedRow.hover();
    await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
    await page.getByTestId(`sidebar-workspace-menu-pin-${workspaceKey}`).click();

    await expect(pinnedSection.getByTestId(`sidebar-workspace-row-${workspaceKey}`)).toHaveCount(
      0,
      {
        timeout: 10_000,
      },
    );
  });

  test("clicking the pinned workspace row in the sidebar opens the workspace", async ({ page }) => {
    test.setTimeout(45_000);
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    await gotoAppShell(page);

    const projectRow = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
    await expect(projectRow).toBeVisible({ timeout: 30_000 });

    await projectRow.hover();
    await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
    await page.getByTestId(`sidebar-workspace-menu-pin-${workspaceKey}`).click();

    const pinnedSection = page.getByTestId("sidebar-pinned-section");
    const pinnedRow = pinnedSection.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
    await expect(pinnedRow).toBeVisible({ timeout: 10_000 });
    await pinnedRow.click();

    await expect(page).toHaveURL(new RegExp(`/workspace/${workspace.workspaceId}`), {
      timeout: 30_000,
    });
  });
});
