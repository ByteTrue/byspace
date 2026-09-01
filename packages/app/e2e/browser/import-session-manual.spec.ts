import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test, type Page } from "../support/fixtures";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  getVisibleWorkspaceAgentTabIds,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

let workspace: SeededWorkspace | null = null;

test.afterEach(async () => {
  await workspace?.cleanup().catch(() => undefined);
  workspace = null;
});

test("imports a manually entered session, then rejects a duplicate", async ({ page }) => {
  workspace = await seedWorkspace({ repoPrefix: "import-session-manual" });
  const sessionId = `manual-e2e-${Date.now()}`;

  await openWorkspace(page, workspace);
  expect(await getVisibleWorkspaceAgentTabIds(page)).toHaveLength(0);

  await openImportSheet(page);
  await submitManualImport(page, sessionId);

  await expect(page.getByTestId("import-session-sheet")).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(async () => (await getVisibleWorkspaceAgentTabIds(page)).length, { timeout: 15_000 })
    .toBe(1);

  await openImportSheet(page);
  await submitManualImport(page, sessionId);

  await expect(page.getByText(/already imported/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("import-session-sheet")).toBeVisible();
  expect(await getVisibleWorkspaceAgentTabIds(page)).toHaveLength(1);
});

async function openWorkspace(page: Page, seed: SeededWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), seed.workspaceId));
  await waitForWorkspaceTabsVisible(page);
}

async function openImportSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Workspace actions" }).click();
  await page.getByTestId("workspace-header-import-agent").click();
  await expect(page.getByTestId("import-session-sheet")).toBeVisible({ timeout: 15_000 });
}

async function submitManualImport(page: Page, sessionId: string): Promise<void> {
  const sheet = page.getByTestId("import-session-sheet");
  await expect(sheet.getByTestId("import-session-manual-form")).toBeVisible({ timeout: 15_000 });

  await sheet.getByTestId("import-session-manual-provider-trigger").click();
  await page.getByTestId("import-session-manual-provider-mock").click();

  await sheet.getByTestId("import-session-manual-handle").fill(sessionId);
  await sheet.getByTestId("import-session-manual-submit").click();
}
