import path from "node:path";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
  pinWorkspaceFromSidebar,
} from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectWorkspaceHeader } from "../support/helpers/workspace-ui";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { openFilesPanel } from "../support/helpers/workspace-tabs";
import { pinnedSidebar, openTopLevelNavMenu } from "../support/helpers/sidebar-chrome";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const GITHUB_REMOTE_URL = "https://github.com/test-owner/test-repo.git";

function getWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function openWorkspaceFromSidebar(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  return row;
}

async function waitForSidebarProject(page: import("@playwright/test").Page, projectName: string) {
  const row = page
    .getByRole("button", {
      name: new RegExp(escapeRegex(projectName), "i"),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function waitForSidebarWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

/**
 * True when the app menu's surface escaped the sidebar into the shared overlay root — i.e. it is a
 * floating menu rather than rows in the sidebar's own layout.
 */
async function isNavMenuPortalled(page: import("@playwright/test").Page): Promise<boolean> {
  return page
    .getByTestId("sidebar-nav-menu")
    .evaluate((element) => Boolean(element.closest("#overlay-root")));
}

async function openWorkspaceReadAction(
  page: import("@playwright/test").Page,
  workspaceId: string,
  action: "read" | "unread",
) {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();
  await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
  const item = page.getByTestId(`sidebar-workspace-menu-mark-as-${action}-${workspaceKey}`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  return item;
}

async function openWorkspaceHoverCard(page: import("@playwright/test").Page, workspaceId: string) {
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();

  const hoverCard = page.getByRole("menu", { name: "Workspace scripts" });
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

interface BySpaceOwnedWorktree {
  projectName: string;
  workspaceId: string;
  worktreeSlug: string;
}

async function withBySpaceOwnedWorktree(
  run: (workspace: BySpaceOwnedWorktree) => Promise<void>,
): Promise<void> {
  const project = await seedWorkspace({ repoPrefix: "sidebar-hover-owned-worktree-" });
  const worktreeSlug = "hover-card-owned-worktree";

  try {
    const created = await project.client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.repoPath,
        projectId: project.projectId,
        worktreeSlug,
      },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create BySpace-owned worktree");
    }
    expect(path.basename(created.workspace.workspaceDirectory)).toBe(worktreeSlug);

    await run({
      projectName: path.basename(project.repoPath),
      workspaceId: created.workspace.id,
      worktreeSlug,
    });
  } finally {
    await project.cleanup();
  }
}

test.describe("Sidebar workspace list", () => {
  test("project with GitHub remote shows its selected folder name in sidebar", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-remote-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);

      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: projectName })
        .first();

      await expect(projectRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).not.toContainText("test-owner/test-repo");
    } finally {
      await workspace.cleanup();
    }
  });

  test("non-git project shows directory name", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-directory-", git: false });

    try {
      await gotoAppShell(page);

      const directoryName = path.basename(workspace.repoPath);
      const projectRow = await waitForSidebarProject(page, directoryName);
      await expect(projectRow).toContainText(directoryName);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace header uses the selected folder name instead of its GitHub remote", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-header-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await expectWorkspaceHeader(page, {
        title: workspace.workspaceName,
        subtitle: projectName,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("git project shows branch name in workspace row", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-branch-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      expect(workspace.workspaceName).toBe("main");
      await expect(await waitForSidebarWorkspace(page, workspace.workspaceId)).toContainText(
        "main",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace hover card shows host as metadata", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-host-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      const hoverCard = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(page.getByTestId("hover-card-workspace-host")).toHaveText("localhost");
      await expect(hoverCard).not.toContainText(/\b(Online|Connecting|Offline|Error|Idle)\b/);
    } finally {
      await workspace.cleanup();
    }
  });

  test("marks a finished workspace unread until it is opened again", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-mark-unread-",
      title: "Mark unread",
      initialPrompt: "Finish this test turn.",
    });

    try {
      await workspace.client.waitForFinish(workspace.agentId, 20_000);
      await workspace.client.clearWorkspaceAttention(workspace.workspaceId);
      expect(workspace.client.getLastServerInfoMessage()?.features?.workspaceMarkUnread).toBe(true);
      await gotoAppShell(page);

      const row = await waitForSidebarWorkspace(page, workspace.workspaceId);
      await expect(row.getByTestId("workspace-status-indicator-done")).toBeVisible();
      await (await openWorkspaceReadAction(page, workspace.workspaceId, "unread")).click();
      await openWorkspaceReadAction(page, workspace.workspaceId, "read");

      await page.keyboard.press("Escape");
      await openWorkspaceFromSidebar(page, workspace.workspaceId);
      await openWorkspaceReadAction(page, workspace.workspaceId, "unread");
    } finally {
      await workspace.cleanup();
    }
  });

  test("BySpace-owned worktree hover card shows the worktree directory name", async ({ page }) => {
    await withBySpaceOwnedWorktree(async ({ projectName, workspaceId, worktreeSlug }) => {
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await openWorkspaceHoverCard(page, workspaceId);

      await expect(page.getByTestId("hover-card-workspace-cwd")).toHaveText(worktreeSlug);
    });
  });
});

test.describe("Workspace menu visibility", () => {
  test.describe("compact Web", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("shows the workspace menu before hover and keeps it mounted while open", async ({
      page,
    }, testInfo) => {
      const workspace = await seedWorkspace({ repoPrefix: "sidebar-compact-workspace-menu-" });
      const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

      try {
        await gotoAppShell(page);
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
        await waitForSidebarProject(page, path.basename(workspace.repoPath));

        const row = await waitForSidebarWorkspace(page, workspace.workspaceId);
        const kebab = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`);
        await expect(kebab).toBeVisible({ timeout: 10_000 });

        await kebab.click();
        const menuItem = page.getByTestId(`sidebar-workspace-menu-copy-path-${workspaceKey}`);
        await expect(
          page.getByRole("button", { name: "Bottom sheet backdrop" }).first(),
        ).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByText("Workspace actions", { exact: true })).toBeVisible();
        await expect(menuItem).toBeVisible({ timeout: 10_000 });

        await page.mouse.move(2, 2);
        await expect(row).toHaveCount(1);
        await expect(kebab).toBeVisible();
        await expect(menuItem).toBeVisible();

        await expect(menuItem).toBeInViewport({ ratio: 1, timeout: 10_000 });

        const screenshotPath = testInfo.outputPath("workspace-menu-compact.png");
        await page.screenshot({ path: screenshotPath });
        await testInfo.attach("workspace-menu-compact", {
          path: screenshotPath,
          contentType: "image/png",
        });

        await page
          .getByRole("button", { name: "Bottom sheet backdrop" })
          .first()
          .click({
            position: { x: 12, y: 12 },
          });
        await expect(menuItem).toHaveCount(0);
      } finally {
        await workspace.cleanup();
      }
    });

    test("folds the top-level nav into a floating menu on the BySpace button", async ({ page }) => {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      // New workspace + History sit on the Workspaces header, so both are on screen from the
      // start without opening the BySpace menu.
      await expect(page.getByTestId("sidebar-global-new-workspace")).toHaveCount(1);
      await expect(page.getByTestId("sidebar-sessions")).toHaveCount(1);

      const menuTestIDs = ["sidebar-search", "sidebar-schedules"];

      // Folding is the point of the button: the panel opens with the remaining destinations away,
      // so the workspace list is not pushed below rows nobody asked for on a phone.
      for (const testID of menuTestIDs) {
        await expect(page.getByTestId(testID)).toHaveCount(0);
      }

      const trigger = page.getByTestId("sidebar-nav-menu-trigger");
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAccessibleName("BySpace");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("sidebar-nav-menu")).toBeVisible();

      // A floating surface, not rows inside the panel: the entries portal out to the overlay
      // root, so opening them cannot push the workspace list down on a phone.
      expect(await isNavMenuPortalled(page)).toBe(true);

      for (const testID of menuTestIDs) {
        await expect(page.getByTestId(testID)).toHaveCount(1);
      }

      // The BySpace menu trigger owns the left of the top row; the panel's close button keeps the
      // right rail, which is what this row has to keep clear for it.
      const triggerBox = await trigger.boundingBox();
      const closeBox = await page.getByTestId("sidebar-close").boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(closeBox).not.toBeNull();
      expect(closeBox!.x).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width);

      // Choosing a destination closes the panel behind it. Search opens the command center in
      // place rather than navigating, which is what makes the panel's own dismissal measurable.
      await page.getByTestId("sidebar-search").click();
      await expect(page.getByTestId("command-center-panel")).toBeVisible({ timeout: 30_000 });
      await expectMobileAgentSidebarHidden(page);
    });

    test("starts closed again the next time the panel opens", async ({ page }) => {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const trigger = page.getByTestId("sidebar-nav-menu-trigger");
      await trigger.click();
      await expect(page.getByTestId("sidebar-search")).toHaveCount(1);

      // While the menu is open its backdrop owns the whole screen — that is what a menu is — so
      // the panel is closed after dismissing it. The panel is retained rather than unmounted, so
      // the point of the walk is what the next open starts from.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sidebar-nav-menu")).toHaveCount(0);
      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("sidebar-nav-menu")).toHaveCount(0);
      for (const testID of ["sidebar-search", "sidebar-schedules"]) {
        await expect(page.getByTestId(testID)).toHaveCount(0);
      }
    });
  });

  test.describe("wide Web", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("keeps the workspace menu hidden until the row is hovered", async ({ page }) => {
      const workspace = await seedWorkspace({ repoPrefix: "sidebar-wide-workspace-menu-" });
      const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

      try {
        await gotoAppShell(page);
        await waitForSidebarProject(page, path.basename(workspace.repoPath));

        const row = await waitForSidebarWorkspace(page, workspace.workspaceId);
        const kebab = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`);
        await expect(kebab).toBeHidden();

        await row.hover();
        await expect(kebab).toBeVisible({ timeout: 10_000 });

        await page.mouse.move(1279, 899);
        await expect(kebab).toBeHidden();
      } finally {
        await workspace.cleanup();
      }
    });
  });
});

test.describe("Mobile sidebar panelState transition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("showMobileAgent open and close transition", async ({ page }) => {
    await gotoAppShell(page);
    await expectMobileAgentSidebarHidden(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  });

  test("keeps a pinned workspace rendered while the retained sidebar is closed", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-pin-" });

    try {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const row = page.getByTestId(getWorkspaceRowTestId(workspace.workspaceId));
      await expect(row).toBeVisible({ timeout: 30_000 });
      await pinWorkspaceFromSidebar(page, workspace.workspaceId);
      await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible();

      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await expect(row).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Half-screen desktop layout", () => {
  test.use({ viewport: { width: 751, height: 982 } });

  test("keeps the sidebar scroll position across close and reopen", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-scroll-" });

    try {
      let lastWorkspaceId = workspace.workspaceId;
      for (let index = 0; index < 24; index += 1) {
        const created = await workspace.client.createWorkspace({
          source: {
            kind: "directory",
            path: workspace.repoPath,
            projectId: workspace.projectId,
          },
          title: `Retained sidebar ${index + 1}`,
        });
        if (!created.workspace) {
          throw new Error(created.error ?? "Failed to fill the retained sidebar");
        }
        lastWorkspaceId = created.workspace.id;
      }

      await gotoAppShell(page);
      await page
        .getByTestId(`sidebar-project-show-more-${projectEquivalenceViewKey(workspace.projectKey)}`)
        .click();
      await waitForSidebarWorkspace(page, lastWorkspaceId);

      const sidebarScroll = page.getByTestId("sidebar-project-workspace-list-scroll");
      const scrollTop = await sidebarScroll.evaluate((element) => {
        element.scrollTop = 160;
        return element.scrollTop;
      });
      expect(scrollTop).toBe(160);

      await page.getByTestId("menu-button").click();
      await expect(pinnedSidebar(page)).toHaveCount(0);

      await page.getByTestId("menu-button").click();
      await expect(pinnedSidebar(page)).toHaveCount(1);
      await expect(sidebarScroll).toHaveJSProperty("scrollTop", scrollTop);
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the pinned sidebar at half of a 14-inch Mac display", async ({ page }) => {
    await gotoAppShell(page);
    await expect(pinnedSidebar(page)).toBeVisible();
    await expect(page.getByTestId("agent-list-backdrop")).not.toBeVisible();
  });

  test("keeps the sidebar toggle pinned to the window's top-left corner", async ({ page }) => {
    await gotoAppShell(page);

    // The toggle holds one position, so collapsing the sidebar must not move the target.
    await expect(pinnedSidebar(page)).toBeVisible();
    const openToggle = page.getByTestId("menu-button");
    await expect(openToggle).toBeVisible();
    const openBounds = await openToggle.boundingBox();
    expect(openBounds).not.toBeNull();
    expect(openBounds?.x).toBeLessThan(12);
    expect(openBounds?.y).toBeLessThan(12);

    await openToggle.click();
    await expect(pinnedSidebar(page)).toHaveCount(0);

    const closedToggle = page.getByTestId("menu-button");
    await expect(closedToggle).toBeVisible();
    const closedBounds = await closedToggle.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(closedBounds?.x).toBe(openBounds?.x);
    expect(closedBounds?.y).toBe(openBounds?.y);

    // Exactly one host at a time: never two toggles, never none.
    await expect(page.getByTestId("menu-button")).toHaveCount(1);
  });

  test("floats the app menu above the workspace list", async ({ page }) => {
    await gotoAppShell(page);

    await expect(pinnedSidebar(page)).toBeVisible();
    // The menu starts closed. New workspace + History (Workspaces header) are not part of it
    // and are on screen from the start.
    for (const testID of ["sidebar-search", "sidebar-schedules"]) {
      await expect(page.getByTestId(testID)).toHaveCount(0);
    }
    await expect(page.getByTestId("sidebar-global-new-workspace")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-sessions")).toHaveCount(1);

    const trigger = page.getByTestId("sidebar-nav-menu-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName("BySpace");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const workspacesTitleTop = async () => {
      const box = await page.getByText("Workspaces", { exact: true }).first().boundingBox();
      expect(box, "the Workspaces section header is not on screen").not.toBeNull();
      return box!.y;
    };
    const closedListTop = await workspacesTitleTop();

    await openTopLevelNavMenu(page);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("sidebar-nav-menu")).toBeVisible();

    // A floating surface: the entries portal out to the overlay root, so opening the menu cannot
    // push the workspace list down the sidebar.
    expect(await isNavMenuPortalled(page)).toBe(true);
    expect(await workspacesTitleTop()).toBe(closedListTop);
    await expect(pinnedSidebar(page).getByTestId("sidebar-search")).toHaveCount(0);

    // The items match one another, so the group reads as one list.
    const firstItemBox = await page.getByTestId("sidebar-search").boundingBox();
    const secondItemBox = await page.getByTestId("sidebar-schedules").boundingBox();
    expect(firstItemBox).not.toBeNull();
    expect(secondItemBox).not.toBeNull();
    expect(secondItemBox!.x).toBe(firstItemBox!.x);
    // Within a pixel: the surface lands on fractional coordinates and each box rounds on its own.
    expect(Math.abs(secondItemBox!.height - firstItemBox!.height)).toBeLessThanOrEqual(1);

    // The app menu trigger sits on the left of the top row with its chevron hugging its right
    // edge.
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();

    const chevronBox = await trigger.locator("svg").first().boundingBox();
    expect(chevronBox).not.toBeNull();
    const chevronRightInset =
      triggerBox!.x + triggerBox!.width - (chevronBox!.x + chevronBox!.width);
    expect(chevronRightInset).toBeLessThan(12);
    expect(chevronRightInset).toBeGreaterThanOrEqual(0);

    // Escape dismisses it, as it does every other menu.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sidebar-nav-menu")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Choosing a destination navigates and takes the menu with it.
    await openTopLevelNavMenu(page);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("sidebar-schedules").click();
    await expect(page).toHaveURL(/\/schedules(?:$|\?)/, { timeout: 30_000 });
    await expect(page.getByTestId("sidebar-schedules")).toHaveCount(0);
  });

  test("reaches History from the Workspaces header without opening the menu", async ({ page }) => {
    await gotoAppShell(page);
    await expect(pinnedSidebar(page)).toBeVisible();

    // The point of moving it out of the menu: one click, not two.
    await expect(page.getByTestId("sidebar-nav-menu-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByTestId("sidebar-sessions").click();
    await expect(page).toHaveURL(/\/sessions(?:$|\?)/, { timeout: 30_000 });
  });

  test("starts closed again after the pinned sidebar is collapsed and reopened", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await expect(pinnedSidebar(page)).toBeVisible();

    await page.getByTestId("sidebar-nav-menu-trigger").click();
    await expect(page.getByTestId("sidebar-search")).toHaveCount(1);

    // Collapsed with the sidebar shortcut, not the toggle: an open menu paints a backdrop over the
    // whole window, so the toggle under it is no longer clickable. The sidebar is retained behind
    // `display: none` rather than unmounted, while the menu's surface is portalled outside it, so
    // without a reset the menu would outlive its trigger.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(pinnedSidebar(page)).toHaveCount(0);
    await expect(page.getByTestId("sidebar-nav-menu")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+b");
    await expect(pinnedSidebar(page)).toBeVisible();
    await expect(page.getByTestId("sidebar-nav-menu-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("sidebar-search")).toHaveCount(0);
  });

  test("yields app navigation to the settings split", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByTestId("sidebar-settings").click();

    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await expect(page.getByTestId("settings-detail-pane")).toBeVisible();
    await expect(page.getByTestId("sidebar-settings")).not.toBeVisible();
  });

  test("keeps app navigation beside the Explorer pane", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-half-screen-explorer-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await openFilesPanel(page);
      const explorerToggle = page
        .locator('[data-testid="workspace-explorer-toggle"]:visible')
        .first();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toBeVisible();
      await expect(explorerToggle).toHaveAccessibleName("Close Explorer sidebar");
      await expect(pinnedSidebar(page)).toBeVisible();
      await expect(page.getByTestId("explorer-sidebar-tab-rail")).toBeVisible();
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(1);

      await explorerToggle.click();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toHaveCount(0);
      await expect(explorerToggle).toHaveAccessibleName("Open Explorer sidebar");
      await expect(pinnedSidebar(page)).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the Explorer toggle pinned to the window's top-right corner", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-explorer-toggle-pinned-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      const toggle = () =>
        page.locator('[data-testid="workspace-explorer-toggle"]:visible').first();

      // With the dock closed the content header hosts the toggle, at the window's corner.
      await expect(toggle()).toBeVisible({ timeout: 30_000 });
      const closedBounds = await toggle().boundingBox();
      expect(closedBounds).not.toBeNull();
      expect(closedBounds!.x + closedBounds!.width).toBeGreaterThan(viewport!.width - 12);

      // Opening the dock hands the same control to the dock's tab rail, unmoved.
      await openFilesPanel(page);
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toBeVisible();
      const openBounds = await toggle().boundingBox();
      expect(openBounds).not.toBeNull();
      expect(openBounds!.x).toBe(closedBounds!.x);
      await expect(page.getByTestId("workspace-explorer-toggle")).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });
});
