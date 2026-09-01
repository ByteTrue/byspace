import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

function workspaceRenameModalTestId(workspaceId: string, suffix: string): string {
  return `sidebar-workspace-rename-modal-${getServerId()}:${workspaceId}-${suffix}`;
}

async function openWorkspaceMenu(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();
}

async function openRenameModal(page: Page, workspaceId: string) {
  const serverId = getServerId();
  await openWorkspaceMenu(page, workspaceId);

  const renameItem = page.getByTestId(`sidebar-workspace-menu-rename-${serverId}:${workspaceId}`);
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const input = page.getByTestId(workspaceRenameModalTestId(workspaceId, "input"));
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

// In Model B the workspace title is its identity: renaming sets a custom title
// layered over the derived branch/directory name, and reconciliation never
// touches it. The sidebar row shows the title verbatim — no branch mutation.
test.describe("Sidebar workspace rename", () => {
  test("renaming via kebab sets a custom title that survives reload", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-" });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      const input = await openRenameModal(page, workspace.workspaceId);
      await expect(input).toHaveValue("main");

      const customTitle = "Payments Refactor";
      await input.fill(customTitle);
      await page.getByTestId(workspaceRenameModalTestId(workspace.workspaceId, "submit")).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      // The title is shown exactly as typed — not slugified into a branch name.
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 15_000 },
      );

      // The custom title is backing metadata on the workspace: a full reload
      // re-resolves the descriptor from persistence and must not lose it. This
      // exercises the same descriptor resolution reconciliation re-runs against,
      // so a reconcile pass cannot overwrite the user's title either.
      await page.reload();
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 30_000 },
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("copies the agent rename prompt with visible feedback", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-agent-rename-" });

    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoAppShell(page);
      await openWorkspaceMenu(page, workspace.workspaceId);
      const urlBefore = page.url();

      const renameWithAgent = page.getByTestId(
        `sidebar-workspace-menu-rename-with-agent-${getServerId()}:${workspace.workspaceId}`,
      );
      await expect(renameWithAgent).toBeVisible({ timeout: 10_000 });
      await renameWithAgent.click();

      await expect(
        page.getByText(
          "Prompt copied. Paste it into the agent that best understands this workspace.",
        ),
      ).toBeVisible();
      await expect
        .poll(() => readClipboard(page))
        .toContain("First set a concise, distinctive workspace title.");
      expect(page.url()).toBe(urlBefore);
      await expect(
        page.getByTestId(workspaceRenameModalTestId(workspace.workspaceId, "input")),
      ).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows an error when the agent rename prompt cannot be copied", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-agent-rename-failure-" });

    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoAppShell(page);
      await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () => Promise.reject(new Error("clipboard unavailable")),
        });
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          value: () => {
            throw new Error("clipboard fallback unavailable");
          },
        });
      });
      await openWorkspaceMenu(page, workspace.workspaceId);

      await page
        .getByTestId(
          `sidebar-workspace-menu-rename-with-agent-${getServerId()}:${workspace.workspaceId}`,
        )
        .click();

      await expect(page.getByText("Failed to copy prompt")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
