import { expect, type Page } from "@playwright/test";
import { getServerId } from "./server-id";

export async function selectWorkspaceInSidebar(page: Page, workspaceId: string): Promise<void> {
  const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

async function openWorkspaceSidebarKebab(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  if (!(await kebab.isVisible())) {
    await row.hover();
  }

  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  return serverId;
}

export async function expectWorkspaceListed(page: Page, name: string): Promise<void> {
  await expect(
    page.locator('[data-testid^="sidebar-workspace-row-"]').filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

// The workspace row kebab and its menu items carry no web ARIA role, so the sidebar
// suite addresses them by the stable test ids the app assigns per workspace — the same
// convention the rename flow uses. Compact layouts keep the kebab visible; wider layouts
// still reveal it on hover.
export async function clickArchiveWorkspaceMenuItem(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const serverId = await openWorkspaceSidebarKebab(page, workspaceId);
  const archiveItem = page.getByTestId(`sidebar-workspace-menu-archive-${serverId}:${workspaceId}`);
  await expect(archiveItem).toBeVisible({ timeout: 10_000 });
  await archiveItem.click();
}

export async function archiveWorkspaceFromSidebar(page: Page, workspaceId: string): Promise<void> {
  // A clean workspace archives with no prompt. Managed worktree backing may raise
  // a browser confirm for unsynced work, so accept it when present.
  page.once("dialog", (dialog) => void dialog.accept());
  await clickArchiveWorkspaceMenuItem(page, workspaceId);
}

export async function expectWorkspaceAbsentFromSidebar(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await expect(
    page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`),
  ).toHaveCount(0, { timeout: 30_000 });
}

export async function openMobileAgentSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu" }).click();
}

export async function closeMobileAgentSidebar(page: Page): Promise<void> {
  const closeButton = page.getByTestId("sidebar-close");
  await expect(closeButton).toBeInViewport({ ratio: 1, timeout: 5_000 });
  await closeButton.click();
}

// The mobile sidebar panel animates via translateX. Waiting for its header to be fully visible
// prevents a close click from targeting a button while the panel is still moving.
export async function expectMobileAgentSidebarVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-pages")).toBeInViewport({ ratio: 1, timeout: 5_000 });
}

export async function expectMobileAgentSidebarHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-pages")).not.toBeInViewport({ timeout: 5_000 });
}

// Top-level pages live behind the sidebar's single page-menu trigger, so reaching one is always
// "open the menu, then pick the page".
export async function openSidebarPage(page: Page, pageTestID: string): Promise<void> {
  const trigger = page.getByTestId("sidebar-pages");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const item = page.getByTestId(pageTestID);
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}
