import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  connectNewWorkspaceDaemonClient,
  expectNewWorkspaceProjectSelected,
  openGlobalNewWorkspaceComposer,
  openNewWorkspaceComposer,
  openNewWorkspaceProjectPickerWithShortcut,
} from "./helpers/new-workspace";
import { getE2EDaemonPort } from "./helpers/daemon-port";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { seedSavedSettingsHosts } from "./helpers/settings";
import { getServerId } from "./helpers/server-id";
import { clickArchiveWorkspaceMenuItem, expectWorkspaceAbsentFromSidebar } from "./helpers/sidebar";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

// New Workspace entry points are the Workspaces header button, each project's header +,
// and the keyboard shortcut. These specs prove the global controls open the same screen,
// the project + preselects the right project, and non-git projects never offer isolation.

function projectRow(page: import("@playwright/test").Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectKey}`);
}

test.describe("New workspace entry points", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    await client?.close().catch(() => undefined);
  });

  test("the Workspaces header button opens the global Project-first screen", async ({ page }) => {
    const seeded: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-global-button-" });

    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: "localhost",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: "secondary-new-workspace-host",
          label: "Secondary host",
          endpoint: "127.0.0.1:9",
        },
      ]);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });

      const newWorkspaceButton = page.getByTestId("sidebar-global-new-workspace");
      await expect(newWorkspaceButton).toBeVisible();
      await expect(newWorkspaceButton).toHaveAccessibleName("New workspace");
      await newWorkspaceButton.click();
      await expect(page).toHaveURL(/\/new(?:\?|$)/);
      await expect(page.getByTestId("host-chooser")).toHaveCount(0);

      const projectOption = page.getByTestId(
        `new-workspace-project-picker-option-${seeded.projectKey}`,
      );
      await expect(projectOption).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("host-picker-trigger")).toHaveCount(0);
    } finally {
      await seeded.cleanup();
    }
  });

  test("Ctrl+P opens the project picker with search focused", async ({ page }) => {
    const seeded: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-shortcut-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await openNewWorkspaceProjectPickerWithShortcut(page);
    } finally {
      await seeded.cleanup();
    }
  });

  test("keeps the in-progress form when the remembered workspace is archived elsewhere", async ({
    page,
  }) => {
    const otherProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "aa-new-workspace-archive-other-",
    });
    const rememberedProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "zz-new-workspace-archive-remembered-",
    });
    const serverId = getServerId();
    const draftText = "keep this new workspace draft";

    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId,
          label: "localhost",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
      ]);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page
        .getByTestId(`sidebar-workspace-row-${serverId}:${rememberedProject.workspaceId}`)
        .click();
      await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });

      await openNewWorkspaceComposer(page, {
        projectKey: rememberedProject.projectKey,
        projectDisplayName: rememberedProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, rememberedProject.projectDisplayName);

      const composer = page.getByRole("textbox", { name: "Message agent..." });
      await expect(composer).toBeEditable({ timeout: 30_000 });
      await composer.fill(draftText);
      await expect(composer).toHaveValue(draftText);

      await clickArchiveWorkspaceMenuItem(page, rememberedProject.workspaceId);
      await expectWorkspaceAbsentFromSidebar(page, rememberedProject.workspaceId);

      await expect(page).toHaveURL(/\/new(?:\?.*)?$/, { timeout: 30_000 });
      await expect(composer).toHaveValue(draftText);
      await expectNewWorkspaceProjectSelected(page, rememberedProject.projectDisplayName);
    } finally {
      await otherProject.cleanup();
      await rememberedProject.cleanup();
    }
  });

  test("each project's row icon preselects that project, and the reused screen resets a stale manual choice across projects", async ({
    page,
  }) => {
    const projectA: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-preselect-a-" });
    const projectB: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-preselect-b-" });
    const projectC: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-preselect-c-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, projectA.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await expect(projectRow(page, projectB.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await expect(projectRow(page, projectC.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      // Project A's row icon opens New Workspace with A preselected.
      await openNewWorkspaceComposer(page, {
        projectKey: projectA.projectKey,
        projectDisplayName: projectA.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, projectA.projectDisplayName);

      // Manually override the selection to C from inside A's screen. This stale
      // manualProjectKey is what the reused 'new' screen must reset when the next
      // route-driven navigation targets a different project.
      await page.getByTestId("new-workspace-project-picker-trigger").click();
      const optionC = page.getByTestId(
        `new-workspace-project-picker-option-${projectC.projectKey}`,
      );
      await expect(optionC).toBeVisible({ timeout: 30_000 });
      await optionC.click();
      await expectNewWorkspaceProjectSelected(page, projectC.projectDisplayName);

      // Navigate via B's row icon. B must be preselected — the route project wins
      // because the stale manual choice (C) was reset on the route change. If the
      // reset were missing, the trigger would still read C.
      await openNewWorkspaceComposer(page, {
        projectKey: projectB.projectKey,
        projectDisplayName: projectB.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, projectB.projectDisplayName);

      // Reusing the same screen for plain /new must clear the route selection and
      // open the project picker instead of retaining B's closed picker state.
      await openGlobalNewWorkspaceComposer(page);
      await expect(page).toHaveURL(/\/new$/u);
      await expect(page.getByTestId("new-workspace-project-picker-trigger")).toContainText(
        "Choose project",
      );
      await expect(page.getByPlaceholder("Search projects")).toBeFocused();
    } finally {
      await projectA.cleanup();
      await projectB.cleanup();
      await projectC.cleanup();
    }
  });

  test("the Isolation control is hidden for a non-git project and shown for a git project", async ({
    page,
  }) => {
    const gitProject: SeededWorkspace = await seedWorkspace({ repoPrefix: "entry-iso-git-" });
    const nonGitProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "entry-iso-nongit-",
      git: false,
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, gitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await expect(projectRow(page, nonGitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      await openGlobalNewWorkspaceComposer(page);
      const nonGitOption = page.getByTestId(
        `new-workspace-project-picker-option-${nonGitProject.projectKey}`,
      );
      await expect(nonGitOption).toBeVisible({ timeout: 30_000 });
      await nonGitOption.click();
      await expectNewWorkspaceProjectSelected(page, nonGitProject.projectDisplayName);

      // No git checkout means no worktree isolation choice: the Isolation row is
      // absent entirely.
      await expect(page.getByTestId("workspace-create-isolation-trigger")).toHaveCount(0);

      // Switching to the git project on the same screen reveals the Isolation row.
      const trigger = page.getByTestId("new-workspace-project-picker-trigger");
      await expect(trigger).toBeVisible({ timeout: 30_000 });
      await trigger.click();
      const gitOption = page.getByTestId(
        `new-workspace-project-picker-option-${gitProject.projectKey}`,
      );
      await expect(gitOption).toBeVisible({ timeout: 30_000 });
      await gitOption.click();
      await expectNewWorkspaceProjectSelected(page, gitProject.projectDisplayName);

      await expect(page.getByTestId("workspace-create-isolation-trigger")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await gitProject.cleanup();
      await nonGitProject.cleanup();
    }
  });
});
