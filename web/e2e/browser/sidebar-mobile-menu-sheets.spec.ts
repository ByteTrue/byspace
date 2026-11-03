import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 10_000 });
}

test("project and workspace kebabs open their action menus on compact layouts", async ({
  page,
}) => {
  const seeded = await seedWorkspace({ repoPrefix: "sidebar-mobile-menu-sheet-" });

  try {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await waitForSidebarHydration(page);

    await page
      .getByTestId(`sidebar-project-kebab-${projectEquivalenceViewKey(seeded.projectKey)}`)
      .click();
    const projectMenu = page.getByRole("menu");
    await expect(projectMenu).toBeVisible({ timeout: 10_000 });
    await expect(projectMenu.getByRole("menuitem", { name: "Remove project" })).toBeVisible();
    await expect(projectMenu).toBeInViewport({ ratio: 1 });
    await closeMenu(page);

    // Not scoped to the row: web/'s row is a link, so its kebab sits beside it.
    await page
      .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${seeded.workspaceId}`)
      .click();
    const workspaceMenu = page.getByRole("menu");
    await expect(workspaceMenu).toBeVisible({ timeout: 10_000 });
    await expect(workspaceMenu.getByRole("menuitem", { name: "Copy path" })).toBeVisible();
    await expect(workspaceMenu).toBeInViewport({ ratio: 1 });
    await closeMenu(page);
  } finally {
    await seeded.cleanup();
  }
});
