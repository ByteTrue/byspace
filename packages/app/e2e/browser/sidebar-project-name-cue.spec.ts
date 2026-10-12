import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectSeedClient, seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  selectSidebarStatusGrouping,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import type { SeededWorkspace } from "../support/helpers/seed-client";

// Two different directories that a person would both call "chat". Neither is a git remote, so
// there is no repo path to tell them apart — which is the case the cue exists for.
const COLLIDING_NAME = "chat";

// The collision cue is written by the sidebar, not by the daemon, so these tests drive two real
// projects through the UI rather than asserting on seeded state.

async function renameSeededProject(workspace: SeededWorkspace, name: string): Promise<void> {
  const client = await connectSeedClient();
  try {
    await client.renameProject(workspace.projectId, name);
  } finally {
    await client.close();
  }
}

// A project seeded from its own temp directory has a project key unique on the host, and an
// ungrouped project's sidebar view key IS that key — so the testid can be built from it.
function projectViewKeyOf(workspace: SeededWorkspace): string {
  return workspace.projectKey;
}

test.describe("Sidebar same-name project cue", () => {
  test("shows the cue under the title when two projects share a name", async ({ page }) => {
    const first = await seedWorkspace({ repoPrefix: "cue-first-", git: false });
    const second = await seedWorkspace({ repoPrefix: "cue-second-", git: false });

    try {
      await renameSeededProject(first, COLLIDING_NAME);
      await renameSeededProject(second, COLLIDING_NAME);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Both rows carry the name, and both carry a cue saying which one they are.
      for (const workspace of [first, second]) {
        const cue = page.getByTestId(`sidebar-project-name-cue-${projectViewKeyOf(workspace)}`);
        await expect(cue).toBeVisible({ timeout: 30_000 });
        // Host and path, because either half alone is ambiguous: same host means only the path
        // separates them, and a shortened path alone can collide across hosts.
        await expect(cue).toContainText("·");
        await expect(cue).toContainText(path.basename(workspace.repoPath));
      }
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  test("shows no cue when the name is unique", async ({ page }) => {
    const only = await seedWorkspace({ repoPrefix: "cue-solo-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      await expect(
        page.getByTestId(`sidebar-project-name-cue-${projectViewKeyOf(only)}`),
      ).toHaveCount(0);
    } finally {
      await only.cleanup();
    }
  });

  test("drops the cue as soon as a filter leaves only one of the pair on screen", async ({
    page,
  }) => {
    const first = await seedWorkspace({ repoPrefix: "cue-filter-a-", git: false });
    const second = await seedWorkspace({ repoPrefix: "cue-filter-b-", git: false });

    try {
      await renameSeededProject(first, COLLIDING_NAME);
      await renameSeededProject(second, COLLIDING_NAME);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      const cue = page.getByTestId(`sidebar-project-name-cue-${projectViewKeyOf(first)}`);
      await expect(cue).toBeVisible({ timeout: 30_000 });

      // Pinning the sidebar to the other project leaves one same-named row. Nothing is ambiguous
      // any more, so the line that explained the pair has to go with it.
      await openSidebarDisplayPage(page, "sidebar-display-project-filter");
      await page.getByTestId(`sidebar-project-filter-${projectViewKeyOf(second)}`).click();
      await closeSidebarDisplayPreferences(page);

      await expect(cue).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  test("carries the cue into status grouping, where no project row exists", async ({ page }) => {
    const first = await seedWorkspace({ repoPrefix: "cue-status-a-", git: false });
    const second = await seedWorkspace({ repoPrefix: "cue-status-b-", git: false });

    try {
      await renameSeededProject(first, COLLIDING_NAME);
      await renameSeededProject(second, COLLIDING_NAME);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // The project item is off by default; status rows only name their project when it is on.
      await openSidebarDisplayPage(page, "sidebar-display-show");
      await page.getByTestId("sidebar-row-item-project").click();
      await closeSidebarDisplayPreferences(page);

      await selectSidebarStatusGrouping(page);

      // Status grouping renders workspace rows with no project header above them, so the cue has
      // to ride on the row's own name. Both rows are in one bucket (neither has an agent running).
      for (const workspace of [first, second]) {
        const row = page.getByTestId(
          `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
        );
        await expect(row).toBeVisible({ timeout: 30_000 });
        const cue = row.getByTestId("sidebar-workspace-project-cue");
        await expect(cue).toBeVisible();
        await expect(cue).toContainText("·");
        await expect(cue).toContainText(path.basename(workspace.repoPath));
      }
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
