import { existsSync } from "node:fs";
import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  archiveWorkspaceFromDaemon,
  connectNewWorkspaceDaemonClient,
  createWorktreeViaDaemon,
  openProjectViaDaemon,
} from "./helpers/new-workspace";
import { getServerId } from "./helpers/server-id";
import {
  archiveWorkspaceFromSidebar,
  expectWorkspaceAbsentFromSidebar,
  selectWorkspaceInSidebar,
} from "./helpers/sidebar";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForSidebarHydration, waitForWorkspaceInSidebar } from "./helpers/workspace-ui";

test.describe("Workspace archive with worktree backing", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  let tempRepo: { path: string; cleanup: () => Promise<void> };
  const createdWorktreeDirectories = new Set<string>();

  test.describe.configure({ retries: 1, timeout: 120_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
    tempRepo = await createTempGitRepo("wt-archive-");
  });

  test.afterEach(async () => {
    for (const directory of createdWorktreeDirectories) {
      await archiveWorkspaceFromDaemon(client, directory).catch(() => undefined);
    }
    createdWorktreeDirectories.clear();
    await client?.close().catch(() => undefined);
    await tempRepo?.cleanup().catch(() => undefined);
  });

  test("archive split button caret fills its container", async ({ page }) => {
    const serverId = getServerId();
    await openProjectViaDaemon(client, tempRepo.path);
    const worktree = await createWorktreeViaDaemon(client, {
      cwd: tempRepo.path,
      slug: `archive-caret-${Date.now()}`,
    });
    createdWorktreeDirectories.add(worktree.workspaceDirectory);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: worktree.workspaceId });
    await selectWorkspaceInSidebar(page, worktree.workspaceId);

    const primary = page.getByTestId("changes-primary-cta");
    const caret = page.getByTestId("changes-primary-cta-caret");
    await expect(primary).toHaveAccessibleName("Archive workspace", { timeout: 30_000 });
    await expect(caret).toBeVisible();

    const geometryDelta = await caret.evaluate((caretElement) => {
      const primaryElement = document.querySelector('[data-testid="changes-primary-cta"]');
      if (!primaryElement) throw new Error("Missing archive split-button primary action");
      const primaryRect = primaryElement.getBoundingClientRect();
      const caretRect = caretElement.getBoundingClientRect();
      return {
        top: caretRect.top - primaryRect.top,
        bottom: caretRect.bottom - primaryRect.bottom,
        height: caretRect.height - primaryRect.height,
      };
    });

    expect(geometryDelta).toEqual({ top: 0, bottom: 0, height: 0 });
  });

  test("archiving the final workspace removes its managed worktree directory", async ({ page }) => {
    const serverId = getServerId();
    await openProjectViaDaemon(client, tempRepo.path);
    const worktree = await createWorktreeViaDaemon(client, {
      cwd: tempRepo.path,
      slug: `archive-${Date.now()}`,
    });
    createdWorktreeDirectories.add(worktree.workspaceDirectory);
    expect(existsSync(worktree.workspaceDirectory)).toBe(true);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: worktree.workspaceId });

    await archiveWorkspaceFromSidebar(page, worktree.workspaceId);

    await expectWorkspaceAbsentFromSidebar(page, worktree.workspaceId);
    await expect
      .poll(() => existsSync(worktree.workspaceDirectory), { timeout: 30_000 })
      .toBe(false);
  });

  test("a managed worktree remains until its last workspace is archived", async ({ page }) => {
    const serverId = getServerId();
    await openProjectViaDaemon(client, tempRepo.path);
    const first = await createWorktreeViaDaemon(client, {
      cwd: tempRepo.path,
      slug: `shared-archive-${Date.now()}`,
    });
    createdWorktreeDirectories.add(first.workspaceDirectory);

    const siblingPayload = await client.createWorkspace({
      source: {
        kind: "directory",
        path: first.workspaceDirectory,
      },
      title: "Second workspace",
    });
    if (!siblingPayload.workspace) {
      throw new Error(siblingPayload.error ?? "Failed to create a workspace on the worktree");
    }
    const sibling = siblingPayload.workspace;
    expect(sibling.workspaceKind).toBe("worktree");
    expect(sibling.workspaceDirectory).toBe(first.workspaceDirectory);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: first.workspaceId });
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: sibling.id });

    await archiveWorkspaceFromSidebar(page, first.workspaceId);

    await expectWorkspaceAbsentFromSidebar(page, first.workspaceId);
    expect(existsSync(first.workspaceDirectory)).toBe(true);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: sibling.id });

    await archiveWorkspaceFromSidebar(page, sibling.id);

    await expectWorkspaceAbsentFromSidebar(page, sibling.id);
    await expect.poll(() => existsSync(first.workspaceDirectory), { timeout: 30_000 }).toBe(false);
  });
});
