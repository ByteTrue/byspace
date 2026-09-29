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
import { pinnedSidebar } from "../support/helpers/sidebar-chrome";
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

    test("folds the top-level nav into the BySpace button", async ({ page }) => {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const navTestIDs = [
        "sidebar-global-new-workspace",
        "sidebar-sessions",
        "sidebar-search",
        "sidebar-schedules",
      ];

      // Folding is the point of the button: the panel opens with the destinations away, so the
      // workspace list is not pushed below four rows nobody asked for on a phone.
      for (const testID of navTestIDs) {
        await expect(page.getByTestId(testID)).toHaveCount(0);
      }

      const trigger = page.getByTestId("sidebar-nav-menu-trigger");
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAccessibleName("BySpace");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");

      for (const testID of navTestIDs) {
        await expect(page.getByTestId(testID)).toHaveCount(1);
      }

      // The revealed rows sit below the button and on its rail, so the group reads as one list
      // even though the close button shares the button's row.
      const triggerBox = await trigger.boundingBox();
      const firstRowBox = await page.getByTestId("sidebar-global-new-workspace").boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(firstRowBox).not.toBeNull();
      expect(firstRowBox!.y).toBeGreaterThan(triggerBox!.y);
      expect(firstRowBox!.x).toBe(triggerBox!.x);

      const labelBox = await trigger.getByText("BySpace", { exact: true }).boundingBox();
      expect(labelBox).not.toBeNull();
      expect(labelBox!.x + labelBox!.width / 2).toBeCloseTo(
        triggerBox!.x + triggerBox!.width / 2,
        0,
      );

      // Choosing a destination closes the panel behind it.
      await page.getByTestId("sidebar-sessions").click();
      await expect(page).toHaveURL(/\/sessions(?:$|\?)/, { timeout: 30_000 });
      await expectMobileAgentSidebarHidden(page);
    });

    test("starts folded again the next time the panel opens", async ({ page }) => {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const trigger = page.getByTestId("sidebar-nav-menu-trigger");
      await trigger.click();
      await expect(page.getByTestId("sidebar-sessions")).toHaveCount(1);

      // Close with the ✕, which navigates nowhere. The panel is retained rather than unmounted,
      // so without an explicit reset the disclosure state would outlive it and the rows would
      // still be covering the workspace list on the next open — the thing folding them prevents.
      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      for (const testID of [
        "sidebar-global-new-workspace",
        "sidebar-sessions",
        "sidebar-search",
        "sidebar-schedules",
      ]) {
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

  test("reveals the top-level nav as rows under the BySpace button", async ({ page }) => {
    await gotoAppShell(page);

    await expect(pinnedSidebar(page)).toBeVisible();
    // The destinations start hidden; the pinned sidebar shows the button instead.
    for (const testID of [
      "sidebar-global-new-workspace",
      "sidebar-sessions",
      "sidebar-search",
      "sidebar-schedules",
    ]) {
      await expect(page.getByTestId(testID)).toHaveCount(0);
    }

    const trigger = page.getByTestId("sidebar-nav-menu-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName("BySpace");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // An inline disclosure, not a floating surface: the destinations are sidebar rows, and
    // they appear *below* the button, pushing the workspace list down rather than covering it.
    // A floating menu would portal them outside the sidebar; assert they are inside it.
    await expect(pinnedSidebar(page).getByTestId("sidebar-global-new-workspace")).toHaveCount(1);
    for (const testID of [
      "sidebar-global-new-workspace",
      "sidebar-sessions",
      "sidebar-search",
      "sidebar-schedules",
    ]) {
      await expect(page.getByTestId(testID)).toHaveCount(1);
    }

    const triggerBox = await trigger.boundingBox();
    const firstRowBox = await page.getByTestId("sidebar-global-new-workspace").boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(firstRowBox).not.toBeNull();
    expect(firstRowBox!.y).toBeGreaterThan(triggerBox!.y);

    // The revealed rows match one another, so the group reads as one list.
    const rowBox = await page.getByTestId("sidebar-sessions").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.x).toBe(firstRowBox!.x);
    expect(rowBox!.height).toBe(firstRowBox!.height);

    // The corner row carries both controls: the toggle and the app menu share it.
    const toggleBox = await page.getByTestId("menu-button").boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.y).toBeLessThan(triggerBox!.y + triggerBox!.height);
    expect(toggleBox!.y + toggleBox!.height).toBeGreaterThan(triggerBox!.y);

    // Align the glyph, not the frame: the toggle's frame is wider than the 16px glyph it
    // centers, so matching frames would leave the visible icon a few pixels off the rail.
    const glyphX = async (testID: string) => {
      const box = await page.getByTestId(testID).locator("svg").first().boundingBox();
      expect(box, `${testID} has no leading icon`).not.toBeNull();
      return box!.x;
    };
    expect(await glyphX("menu-button")).toBe(await glyphX("sidebar-global-new-workspace"));
    expect(await glyphX("menu-button")).toBe(await glyphX("sidebar-sessions"));

    // The app menu is a title-bar shape, not a nav row: its label is centred on the button and
    // its chevron hugs the button's right edge. Neither has to line up with the rows below —
    // sharing the corner row with the toggle makes that impossible anyway.
    const labelBox = await trigger.getByText("BySpace", { exact: true }).boundingBox();
    expect(labelBox).not.toBeNull();
    const buttonCentre = triggerBox!.x + triggerBox!.width / 2;
    expect(labelBox!.x + labelBox!.width / 2).toBeCloseTo(buttonCentre, 0);

    const chevronBox = await trigger.locator("svg").first().boundingBox();
    expect(chevronBox).not.toBeNull();
    const chevronRightInset =
      triggerBox!.x + triggerBox!.width - (chevronBox!.x + chevronBox!.width);
    expect(chevronRightInset).toBeLessThan(12);
    expect(chevronRightInset).toBeGreaterThanOrEqual(0);

    // Choosing a destination navigates and collapses the disclosure behind it.
    await page.getByTestId("sidebar-sessions").click();
    await expect(page).toHaveURL(/\/sessions(?:$|\?)/, { timeout: 30_000 });
    await expect(page.getByTestId("sidebar-sessions")).toHaveCount(0);
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
