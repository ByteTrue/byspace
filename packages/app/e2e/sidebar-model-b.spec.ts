import { test, expect, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { gotoWorkspace, clickNewTerminal } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { seedMockAgentWorkspace } from "./helpers/mock-agent";
import { getServerId } from "./helpers/server-id";
import { waitForSidebarHydration } from "./helpers/workspace-ui";
import { getVisibleWorkspaceAgentTabIds } from "./helpers/workspace-tabs";

// Model B sidebar shape: every project — git or non-git, single- or
// multi-workspace — renders as the same expandable parent, the deepest sidebar
// level is the workspace row, and tabs/agents/terminals NEVER appear in the
// sidebar. These specs prove all three invariants end to end.

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function projectRow(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectKey}`);
}

function projectNewWorktreeIcon(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-new-worktree-${projectKey}`);
}

async function seedSecondWorkspace(seeded: SeededWorkspace, title: string): Promise<string> {
  const created = await seeded.client.createWorkspace({
    source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create second workspace for ${seeded.projectId}`);
  }
  return created.workspace.id;
}

test.describe("Model B sidebar shape", () => {
  test.describe.configure({ timeout: 180_000 });

  test("git and non-git projects both render as expandable parents with a per-row New workspace icon", async ({
    page,
  }) => {
    const gitProject = await seedWorkspace({ repoPrefix: "model-b-git-" });
    const nonGitProject = await seedWorkspace({ repoPrefix: "model-b-nongit-", git: false });

    try {
      const gitSecondId = await seedSecondWorkspace(gitProject, "Git second");
      const nonGitSecondId = await seedSecondWorkspace(nonGitProject, "Non-git second");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Both projects are expandable parents — the non-git one is NOT flattened
      // into a bare workspace link.
      await expect(projectRow(page, gitProject.projectKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, nonGitProject.projectKey)).toBeVisible({ timeout: 30_000 });

      // Each parent shows both of its workspace rows underneath.
      await expect(workspaceRow(page, gitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, gitSecondId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitSecondId)).toBeVisible({ timeout: 30_000 });

      await expect(page.getByTestId("sidebar-needs-attention-section")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-other-projects-section")).toHaveCount(0);

      // Both projects show a per-row New workspace icon (revealed on hover): the
      // git project can branch off a worktree, and the non-git project can add
      // another workspace because the host supports workspaceMultiplicity.
      await projectRow(page, gitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, gitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await projectRow(page, nonGitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, nonGitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      await expect(page.getByTestId("sidebar-global-new-workspace")).toHaveCount(0);
    } finally {
      await gitProject.cleanup();
      await nonGitProject.cleanup();
    }
  });

  test("surfaces workspace attention and shows every agent status on hover", async ({ page }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-attention-",
      title: "Needs user decision",
      initialPrompt: "Emit synthetic plan approval.",
    });

    try {
      const parked = await mock.client.waitForFinish(mock.agentId, 15_000);
      expect(parked.status).toBe("permission");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      const row = workspaceRow(page, mock.workspaceId);
      await expect(row).toBeVisible({ timeout: 30_000 });
      const attentionSummary = row.getByTestId("workspace-agent-summary-attention");
      await expect(attentionSummary).toHaveText("1");
      await expect(attentionSummary).toHaveAccessibleName("Agents needing attention: 1");
      await expect(page.getByTestId("sidebar-needs-attention-section")).toContainText("1");
      await expect(page.getByTestId("sidebar-other-projects-section")).toHaveCount(0);
      await row.hover();

      const hoverCard = page.getByTestId("workspace-hover-card");
      await expect(hoverCard).toBeVisible({ timeout: 10_000 });
      await expect(hoverCard).toContainText("Needs user decision");
      await expect(hoverCard).toContainText("Needs input");

      await page.mouse.move(1000, 700);
      await expect(hoverCard).toHaveCount(0);
      await row.focus();
      await expect(hoverCard).toBeVisible({ timeout: 10_000 });

      await page.setViewportSize({ width: 390, height: 844 });
      if (!(await row.isVisible())) {
        await page.getByTestId("menu-button").click();
      }
      await expect(attentionSummary).toHaveText("1");
      await expect(hoverCard).toHaveCount(0);
    } finally {
      await mock.cleanup();
    }
  });

  test("no tab, agent, or terminal ever renders as a sidebar row", async ({ page }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-leaf-",
      title: "Leaf workspace",
    });

    try {
      // Open the workspace and materialize both an agent tab and a terminal tab.
      await gotoWorkspace(page, mock.workspaceId);
      const agentTabs = await getVisibleWorkspaceAgentTabIds(page);
      expect(agentTabs).toContain(`workspace-tab-agent_${mock.agentId}`);

      await clickNewTerminal(page);
      await expect(
        page.locator('[data-testid^="workspace-tab-terminal_"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // The deepest level inside the sidebar is the workspace row: no tab,
      // agent, or terminal element appears as a sidebar descendant.
      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();
      await expect(workspaceRow(page, mock.workspaceId).first()).toBeVisible({ timeout: 30_000 });
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-agent-row-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-terminal-row-"]')).toHaveCount(0);
    } finally {
      await mock.cleanup();
    }
  });
});
