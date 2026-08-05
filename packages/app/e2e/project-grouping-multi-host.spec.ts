import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { addConnectedHostAndReload } from "./helpers/hosts";
import { startIsolatedHostDaemon } from "./helpers/isolated-host-daemon";
import { connectSeedClient } from "./helpers/seed-client";
import { submitNewWorkspaceEmpty } from "./helpers/new-workspace";
import { getServerId } from "./helpers/server-id";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

const REMOTE = "https://github.com/byspace-e2e/shared-project.git";

test.describe("cross-host project identity", () => {
  test.describe.configure({ timeout: 180_000 });

  test("hydrates one grouped project while retaining each host's local mutation id", async ({
    page,
  }) => {
    const primaryServerId = getServerId();
    const secondary = await startIsolatedHostDaemon("project-group-secondary");
    const primaryClient = await connectSeedClient();
    const secondaryClient = await connectSeedClient({ port: secondary.port });
    const primaryRepo = await createTempGitRepo("group-primary-", { originUrl: REMOTE });
    const secondaryRepo = await createTempGitRepo("group-secondary-", { originUrl: REMOTE });
    let primaryProjectId = "";
    let secondaryProjectId = "";

    try {
      const primaryCreated = await primaryClient.createWorkspace({
        source: { kind: "directory", path: primaryRepo.path },
      });
      const secondaryCreated = await secondaryClient.createWorkspace({
        source: { kind: "directory", path: secondaryRepo.path },
      });
      if (!primaryCreated.workspace || !secondaryCreated.workspace) {
        throw new Error(
          primaryCreated.error ?? secondaryCreated.error ?? "Failed to seed projects",
        );
      }
      primaryProjectId = primaryCreated.workspace.projectId;
      secondaryProjectId = secondaryCreated.workspace.projectId;
      expect(primaryProjectId).not.toBe(secondaryProjectId);

      const primaryProject = (await primaryClient.listProjects()).projects.find(
        (project) => project.projectId === primaryProjectId,
      );
      const secondaryProject = (await secondaryClient.listProjects()).projects.find(
        (project) => project.projectId === secondaryProjectId,
      );
      expect(primaryProject?.projectGroupingKey).toBe(secondaryProject?.projectGroupingKey);
      const projectKey = primaryProject?.projectGroupingKey;
      if (!projectKey) throw new Error("Expected a shared project key");

      await primaryClient.renameProject(primaryProjectId, "Primary shared app");
      await secondaryClient.renameProject(secondaryProjectId, "Secondary shared app");

      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondary.serverId,
        label: "Secondary Host",
        port: secondary.port,
        primaryLabel: "Primary Host",
      });
      await waitForSidebarHydration(page);

      const groupedRow = page.getByTestId(`sidebar-project-row-${projectKey}`);
      await expect(groupedRow).toHaveCount(1, { timeout: 30_000 });
      await groupedRow.hover();
      await page.getByTestId(`sidebar-project-new-worktree-${projectKey}`).click();
      await expect(page.getByTestId("new-workspace-project-picker-trigger")).toBeVisible();
      const secondaryHostOption = page.getByTestId(
        "new-workspace-host-picker-option-project-group-secondary",
      );
      await expect(secondaryHostOption).toBeVisible();
      await expect(page.getByTestId("host-picker-trigger")).toHaveAccessibleName("Choose host");
      await page.keyboard.press("Escape");
      const composer = page.getByRole("textbox", { name: "Message agent..." });
      const submit = page.getByTestId("workspace-create-submit");
      await composer.fill("Keep this draft across hosts");
      await expect(submit).toBeDisabled();
      await composer.press("Enter");
      await expect(composer).toHaveValue(/^Keep this draft across hosts\n?$/);
      await page.getByTestId("host-picker-trigger").click();
      await secondaryHostOption.click();
      await expect(page.getByTestId("host-picker-trigger")).toContainText("Secondary Host");
      await expect(composer).toHaveValue(/^Keep this draft across hosts\n?$/);

      const primaryWorkspaceCountBefore = (
        await primaryClient.fetchWorkspaces({ filter: { projectId: primaryProjectId } })
      ).entries.length;
      const secondaryWorkspaceIdsBefore = new Set(
        (
          await secondaryClient.fetchWorkspaces({ filter: { projectId: secondaryProjectId } })
        ).entries.map((workspace) => workspace.id),
      );
      await composer.fill("");
      await submitNewWorkspaceEmpty(page);
      await expect(page).toHaveURL(new RegExp(`/h/${secondary.serverId}/workspace/`), {
        timeout: 30_000,
      });
      await expect
        .poll(
          async () => {
            const [primaryWorkspaces, secondaryWorkspaces] = await Promise.all([
              primaryClient.fetchWorkspaces({ filter: { projectId: primaryProjectId } }),
              secondaryClient.fetchWorkspaces({ filter: { projectId: secondaryProjectId } }),
            ]);
            let created: (typeof secondaryWorkspaces.entries)[number] | undefined;
            for (const workspace of secondaryWorkspaces.entries) {
              if (!secondaryWorkspaceIdsBefore.has(workspace.id)) {
                created = workspace;
                break;
              }
            }
            return {
              primaryCount: primaryWorkspaces.entries.length,
              secondaryCount: secondaryWorkspaces.entries.length,
              createdProjectId: created?.projectId ?? null,
              createdProjectRootPath: created?.projectRootPath ?? null,
            };
          },
          { timeout: 30_000 },
        )
        .toEqual({
          primaryCount: primaryWorkspaceCountBefore,
          secondaryCount: secondaryWorkspaceIdsBefore.size + 1,
          createdProjectId: secondaryProjectId,
          createdProjectRootPath: secondaryCreated.workspace.projectRootPath,
        });

      await page.goBack();
      await waitForSidebarHydration(page);
      await groupedRow.hover();
      await page.getByTestId(`sidebar-project-kebab-${projectKey}`).click();
      await page.getByTestId(`sidebar-project-menu-open-settings-${projectKey}`).click();
      await expect(page.getByText("Primary shared app", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("host-picker").click();
      await page.getByTestId(`host-picker-item-${secondary.serverId}`).click();
      await expect(page.getByText("Secondary shared app", { exact: true })).toBeVisible();

      await page.goBack();
      await waitForSidebarHydration(page);
      await page.getByTestId("sidebar-schedules").click();
      await page.getByTestId("schedules-empty-new").click();
      await page.getByTestId("schedule-host-trigger").click();
      await page.getByTestId(`schedule-host-option-${primaryServerId}`).click();
      await page.getByTestId("schedule-project-trigger").click();
      await expect(page.getByTestId(`schedule-project-option-${projectKey}`)).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByTestId("schedule-host-trigger").click();
      await page.getByTestId(`schedule-host-option-${secondary.serverId}`).click();
      await page.getByTestId("schedule-project-trigger").click();
      await expect(page.getByTestId(`schedule-project-option-${projectKey}`)).toBeVisible();
      await page.keyboard.press("Escape");

      await page.goBack();
      await waitForSidebarHydration(page);
      await groupedRow.hover();
      await page.getByTestId(`sidebar-project-kebab-${projectKey}`).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByTestId(`sidebar-project-menu-remove-${projectKey}`).click();
      const listProjectIds = async (client: typeof primaryClient) =>
        (await client.listProjects()).projects.map((project) => project.projectId);
      await expect
        .poll(async () => (await listProjectIds(primaryClient)).includes(primaryProjectId), {
          timeout: 30_000,
        })
        .toBe(false);
      await expect
        .poll(async () => (await listProjectIds(secondaryClient)).includes(secondaryProjectId), {
          timeout: 30_000,
        })
        .toBe(false);
    } finally {
      if (primaryProjectId)
        await primaryClient.removeProject(primaryProjectId).catch(() => undefined);
      if (secondaryProjectId)
        await secondaryClient.removeProject(secondaryProjectId).catch(() => undefined);
      await primaryClient.close().catch(() => undefined);
      await secondaryClient.close().catch(() => undefined);
      await primaryRepo.cleanup().catch(() => undefined);
      await secondaryRepo.cleanup().catch(() => undefined);
      await secondary.close().catch(() => undefined);
    }
  });
});
