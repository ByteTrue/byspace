import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectNoBranchSwitcherInWorkspaceHeader,
  expectWorkspaceBranch,
  openChangesPanel,
  switchBranchFromChangesPanel,
} from "../support/helpers/branch-switcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { readWorktreeBranchInfo } from "../support/helpers/workspace";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

async function renameWorkspaceViaSidebar(
  page: Page,
  input: { workspaceId: string; title: string },
): Promise<void> {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${input.workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${input.workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(
    `sidebar-workspace-menu-rename-${serverId}:${input.workspaceId}`,
  );
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const modalPrefix = `sidebar-workspace-rename-modal-${serverId}:${input.workspaceId}`;
  const renameInput = page.getByTestId(`${modalPrefix}-input`);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(input.title);
  await page.getByTestId(`${modalPrefix}-submit`).click();
  await expect(renameInput).toHaveCount(0, { timeout: 15_000 });
}

test.describe("Branch switcher", () => {
  // The first test after a spec-file switch can fail while the shared daemon
  // releases stale sessions from the previous spec; one retry stabilizes it.
  test.describe.configure({ retries: 1 });

  test("a custom workspace title stays in the header while the diff panel switches the real branch", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "branch-coherence-",
      repo: { branches: ["main", "dev"] },
    });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspace.workspaceId });

      const customTitle = "Payments Refactor";
      await renameWorkspaceViaSidebar(page, {
        workspaceId: workspace.workspaceId,
        title: customTitle,
      });

      // The header shows the custom title verbatim (a plain static title), never a
      // branch name, and the branch switcher does not live in the header.
      const headerTitle = page
        .getByTestId("workspace-header-title")
        .filter({ visible: true })
        .first();
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });
      await expectNoBranchSwitcherInWorkspaceHeader(page);

      // The diff panel's switcher tracks the real branch ("main"), not the title,
      // and switching it checks out the real branch on disk.
      await openChangesPanel(page);
      await expectWorkspaceBranch(page, "main");
      await switchBranchFromChangesPanel(page, { from: "main", to: "dev" });
      await expectWorkspaceBranch(page, "dev");

      // The custom title is unaffected by the branch switch.
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });

      await expect
        .poll(
          async () =>
            (await readWorktreeBranchInfo({ worktreePath: workspace.repoPath })).currentBranch,
          { timeout: 30_000 },
        )
        .toBe("dev");
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows branch source semantics and supports keyboard selection", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "branch-source-",
      repo: { branches: ["main"], withRemote: true },
    });

    try {
      execFileSync("git", ["branch", "both-source"], { cwd: workspace.repoPath });
      execFileSync("git", ["push", "origin", "both-source"], { cwd: workspace.repoPath });
      execFileSync("git", ["push", "origin", "HEAD:refs/heads/remote-only"], {
        cwd: workspace.repoPath,
      });
      execFileSync("git", ["fetch", "origin"], { cwd: workspace.repoPath });
      rmSync(path.join(workspace.repoPath, "remote.git"), { recursive: true, force: true });

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspace.workspaceId });
      await openChangesPanel(page);

      const trigger = page
        .getByTestId("changes-repository-header")
        .getByRole("button", { name: /Current branch: main\b/ })
        .filter({ visible: true })
        .first();
      await trigger.focus();
      await page.keyboard.press("Enter");

      const picker = page.getByTestId("combobox-desktop-container");
      await expect(picker).toBeVisible({ timeout: 30_000 });
      const remoteOnlyOption = picker.getByRole("button", {
        name: "remote-only, Remote",
        exact: true,
      });
      const bothOption = picker.getByRole("button", {
        name: "both-source, Local • Remote",
        exact: true,
      });
      await expect(remoteOnlyOption).toBeVisible();
      await expect(bothOption).toBeVisible();
      await expect(picker.getByText("Remote", { exact: true })).toBeVisible();
      await expect(
        picker.getByRole("button", { name: "both-source, Local • Remote", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("branch-switcher-source.png") });

      await page.keyboard.press("Escape");
      await expect(picker).not.toBeVisible({ timeout: 30_000 });

      await trigger.focus();
      await page.keyboard.press("Enter");
      const search = page.getByPlaceholder("Filter branches...");
      await expect(search).toBeVisible({ timeout: 30_000 });
      await search.fill("both-source");
      await expect(
        picker.getByRole("button", { name: "both-source, Local • Remote", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(picker).not.toBeVisible({ timeout: 30_000 });
      await expect(
        page
          .getByTestId("changes-repository-header")
          .getByRole("button", { name: /Current branch: both-source\b/ })
          .filter({ visible: true })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });
});
