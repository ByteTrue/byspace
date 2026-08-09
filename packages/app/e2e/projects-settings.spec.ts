import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base, type Page } from "./fixtures";
import { connectSeedClient, seedWorkspace } from "./helpers/seed-client";
import {
  blockBySpaceConfigWrites,
  bumpBySpaceConfigOnDisk,
  clickReloadProjectSettings,
  clickRetryProjectSettingsSave,
  clickSaveProjectSettings,
  corruptBySpaceConfig,
  editWorktreeSetup,
  expectEmptyScriptList,
  expectHostIndicatorVisible,
  expectHostPickerHidden,
  expectNoEditableTarget,
  expectNoProjectSettingsError,
  expectProjectSettingsError,
  expectProjectSettingsFormHidden,
  expectProjectSettingsFormVisible,
  expectSaveButtonDisabled,
  expectScriptRowCount,
  expectWriteFailedCalloutActions,
  installDaemonConnectionGate,
  installOrchestrationSkillsStatus,
  installReadTransportFailure,
  navigateToProjectSettings,
  openProjectSettings,
  openProjects,
  removeProjectScript,
  restoreBySpaceConfig,
  unblockBySpaceConfigWrites,
} from "./helpers/project-settings";
import { gotoAppShell } from "./helpers/app";
import {
  addProjectFlowInput,
  chooseAddProjectMethod,
  openAddProjectFlow,
} from "./helpers/add-project-flow";
import { createTempGitRepo } from "./helpers/workspace";
import { expectNewWorkspaceDraft } from "./helpers/new-workspace";
import { getServerId } from "./helpers/server-id";

const updatedSetup = ["npm install", "npm run build"];
const projectSetupPrompt =
  "Use the byspace-project-setup skill to inspect this repository and recommend the smallest evidence-based changes that make clean worktrees repeatable, common commands discoverable, and long-running services safe to run in parallel. Inspect first and show me the recommendations before changing files.";

interface ProjectsSettingsProject {
  name: string;
  path: string;
  projectId: string;
}

interface ProjectsSettingsFixtures {
  editableProject: ProjectsSettingsProject;
  gitlabRemoteProject: ProjectsSettingsProject;
}

const initialBySpaceConfig = {
  worktree: {
    setup: ["echo initial setup"],
    teardown: "echo cleanup",
    customWorktreeField: "preserved",
  },
  scripts: {
    dev: {
      command: "npm run dev",
      type: "server",
      port: 3000,
      customScriptField: "preserved",
    },
  },
  customTopLevelField: "preserved",
};

const test = base.extend<ProjectsSettingsFixtures>({
  editableProject: async ({ page: _page }, provide) => {
    const workspace = await seedWorkspace({
      repoPrefix: "projects-settings-",
      repo: { byspaceConfig: initialBySpaceConfig },
    });

    await provide({
      name: workspace.projectDisplayName,
      path: workspace.repoPath,
      projectId: workspace.projectId,
    });

    // Defensive: restore directory write permission in case the test left it blocked
    // (write_failed test), so that cleanup can remove files inside.
    await chmod(workspace.repoPath, 0o755).catch(() => undefined);
    await workspace.cleanup();
  },
  gitlabRemoteProject: async ({ page: _page }, provide) => {
    const workspace = await seedWorkspace({
      repoPrefix: "projects-settings-gitlab-",
      repo: {
        byspaceConfig: initialBySpaceConfig,
        originUrl: "https://gitlab.com/acme/app.git",
      },
    });

    await provide({
      name: workspace.projectDisplayName,
      path: workspace.repoPath,
      projectId: workspace.projectId,
    });

    await workspace.cleanup();
  },
});

async function expectProjectConfigSaved(project: ProjectsSettingsProject): Promise<void> {
  await expect
    .poll(
      async () => {
        const contents = await readProjectConfigFile(project);
        return JSON.parse(contents) as unknown;
      },
      {
        timeout: 30_000,
      },
    )
    .toMatchObject({
      worktree: {
        setup: updatedSetup,
        teardown: initialBySpaceConfig.worktree.teardown,
        customWorktreeField: initialBySpaceConfig.worktree.customWorktreeField,
      },
      scripts: {
        dev: {
          command: initialBySpaceConfig.scripts.dev.command,
          type: initialBySpaceConfig.scripts.dev.type,
          port: initialBySpaceConfig.scripts.dev.port,
          customScriptField: initialBySpaceConfig.scripts.dev.customScriptField,
        },
      },
      customTopLevelField: initialBySpaceConfig.customTopLevelField,
    });

  const savedConfig = await readProjectConfigFile(project);
  expect(savedConfig).toBe(`${JSON.stringify(JSON.parse(savedConfig), null, 2)}\n`);
}

async function readProjectConfigFile(project: ProjectsSettingsProject): Promise<string> {
  return readFile(path.join(project.path, "byspace.json"), "utf8");
}

async function addProjectFromSidebar(page: Page, projectPath: string): Promise<string> {
  await openAddProjectFlow(page);
  await chooseAddProjectMethod(page, "directory-search");

  const input = addProjectFlowInput(page);
  await input.fill(projectPath);
  await page.keyboard.press("Enter");

  const projectRow = page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: path.basename(projectPath) })
    .first();
  await expect(projectRow).toBeVisible({ timeout: 30_000 });

  const testId = await projectRow.getAttribute("data-testid");
  expect(testId).not.toBeNull();
  return testId!.replace("sidebar-project-row-", "");
}

async function openProjectSettingsFromSidebar(page: Page, projectKey: string): Promise<void> {
  const projectRow = page.getByTestId(`sidebar-project-row-${projectKey}`);
  await expect(projectRow).toBeVisible({ timeout: 30_000 });
  await projectRow.hover();

  const kebab = page.getByTestId(`sidebar-project-kebab-${projectKey}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const openSettingsItem = page.getByTestId(`sidebar-project-menu-open-settings-${projectKey}`);
  await expect(openSettingsItem).toBeVisible({ timeout: 10_000 });
  await openSettingsItem.click();
}

test.describe("Projects settings", () => {
  test("real daemon opens a project-scoped setup draft", async ({ page }) => {
    const repo = await createTempGitRepo("projects-settings-empty-");
    const client = await connectSeedClient();
    let projectId: string | null = null;

    try {
      await gotoAppShell(page);

      const projectKey = await addProjectFromSidebar(page, repo.path);
      const listedProject = (await client.listProjects()).projects.find(
        (project) => project.projectRootPath === repo.path,
      );
      if (!listedProject) {
        throw new Error(`Missing listed project for ${repo.path}`);
      }
      projectId = listedProject.projectId;
      await openProjectSettingsFromSidebar(page, projectKey);

      await expectProjectSettingsFormVisible(page);
      await expect(page.getByTestId("project-settings-back-button")).not.toBeVisible();
      const action = page.getByTestId("project-setup-agent-action");
      await expect(action).toHaveText("Configure with agent");
      page.on("dialog", (dialog) => void dialog.accept());
      await action.click();

      await expect(page).toHaveURL(/\/new\?/);
      const route = new URL(page.url());
      expect(route.searchParams.get("serverId")).toBe(getServerId());
      expect(route.searchParams.get("projectId")).toBe(projectId);
      expect(route.searchParams.get("dir")).toBe(repo.path);
      expect(route.searchParams.get("name")).toBe(listedProject.projectDisplayName);
      await expectNewWorkspaceDraft(page, projectSetupPrompt);
      const e2eHome = process.env.E2E_BYSPACE_HOME;
      if (!e2eHome) throw new Error("E2E_BYSPACE_HOME is required");
      expect(
        await readFile(
          path.join(e2eHome, ".agents", "skills", "byspace-project-setup", "SKILL.md"),
          "utf8",
        ),
      ).toContain("name: byspace-project-setup");
    } finally {
      if (projectId) {
        await client.removeProject(projectId).catch(() => undefined);
      }
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    }
  });

  test("user edits worktree setup from the projects page", async ({ page, editableProject }) => {
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);
    await editWorktreeSetup(page, updatedSetup);
    await clickSaveProjectSettings(page);
    await expectProjectConfigSaved(editableProject);
  });

  test("user edits worktree setup on a non-GitHub remote project", async ({
    page,
    gitlabRemoteProject,
  }) => {
    await openProjects(page);
    await openProjectSettings(page, gitlabRemoteProject.name);
    await editWorktreeSetup(page, updatedSetup);
    await clickSaveProjectSettings(page);
    await expectProjectConfigSaved(gitlabRemoteProject);
  });

  test("agent setup entry opens a project-scoped draft without changing files", async ({
    page,
    editableProject,
  }) => {
    await installOrchestrationSkillsStatus(page, "not-installed");
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    const before = await readProjectConfigFile(editableProject);
    const action = page.getByTestId("project-setup-agent-action");
    await expect(action).toHaveText("Review with agent");
    page.once("dialog", (dialog) => dialog.accept());
    await action.click();

    await expect(page).toHaveURL(/\/new\?/);
    await expect.poll(() => new URL(page.url()).searchParams.get("dir")).toBe(editableProject.path);
    const route = new URL(page.url());
    expect(route.searchParams.get("serverId")).toBe(getServerId());
    expect(route.searchParams.get("projectId")).toBe(editableProject.projectId);
    expect(route.searchParams.get("name")).toBe(editableProject.name);
    await expectNewWorkspaceDraft(page, projectSetupPrompt);
    expect(await readProjectConfigFile(editableProject)).toBe(before);
  });

  test("skill install failure keeps project context and can be retried", async ({
    page,
    editableProject,
  }) => {
    await installOrchestrationSkillsStatus(page, "not-installed", true, true);
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    const before = await readProjectConfigFile(editableProject);
    const action = page.getByTestId("project-setup-agent-action");
    page.once("dialog", (dialog) => dialog.accept());
    await action.click();

    await expect(page.getByTestId("project-setup-agent-error")).toContainText(
      "Test orchestration skill install failure.",
    );
    await expect(page).toHaveURL(/\/settings\/projects\//);
    expect(await readProjectConfigFile(editableProject)).toBe(before);

    page.once("dialog", (dialog) => dialog.accept());
    await action.click();
    await expect(page).toHaveURL(/\/new\?/);
    expect(await readProjectConfigFile(editableProject)).toBe(before);
  });

  test("drifted skill updates before opening the project draft", async ({
    page,
    editableProject,
  }) => {
    await installOrchestrationSkillsStatus(page, "drift");
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    const action = page.getByTestId("project-setup-agent-action");
    page.once("dialog", (dialog) => dialog.accept());
    await action.click();

    await expect(page).toHaveURL(/\/new\?/);
    const route = new URL(page.url());
    expect(route.searchParams.get("serverId")).toBe(getServerId());
    expect(route.searchParams.get("projectId")).toBe(editableProject.projectId);
    await expectNewWorkspaceDraft(page, projectSetupPrompt);
  });

  test("leaving settings during skill install prevents stale draft navigation", async ({
    page,
    editableProject,
  }) => {
    const install = await installOrchestrationSkillsStatus(
      page,
      "not-installed",
      true,
      false,
      true,
    );
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    const action = page.getByTestId("project-setup-agent-action");
    page.once("dialog", (dialog) => dialog.accept());
    await action.click();
    await install.waitForInstallRequest();
    await expect(action).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/projects$/);
    install.releaseInstallResponse();
    await install.waitForInstallResponse();
    await page.evaluate(async () => {
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    });
    await expect(page).toHaveURL(/\/settings\/projects$/);
  });

  test("older hosts show an upgrade message without an unguided fallback", async ({
    page,
    editableProject,
  }) => {
    await installOrchestrationSkillsStatus(page, "up-to-date", false);
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    await expect(
      page.getByText("Update the host to use agent-assisted project setup"),
    ).toBeVisible();
    await expect(page.getByTestId("project-setup-agent-action")).toHaveCount(0);
  });
});

test.describe("Projects settings — error UX", () => {
  test("stale-write callout appears on save, disables save, and reload clears it", async ({
    page,
    editableProject,
  }) => {
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    // Bump the file on disk so the daemon detects a revision mismatch on save.
    await bumpBySpaceConfigOnDisk(editableProject.path);

    await clickSaveProjectSettings(page);

    await expectProjectSettingsError(page, "stale");
    await expectSaveButtonDisabled(page);

    await clickReloadProjectSettings(page);

    await expectNoProjectSettingsError(page, "stale");
    await expectProjectSettingsFormVisible(page);
  });

  test("invalid byspace.json shows read-error callout, reload after fix shows form", async ({
    page,
    editableProject,
  }) => {
    await corruptBySpaceConfig(editableProject.path);

    await openProjects(page);
    await navigateToProjectSettings(page, editableProject.name);

    await expectProjectSettingsError(page, "invalid");
    await expectProjectSettingsFormHidden(page);

    // Restore a valid config so the reload succeeds.
    await restoreBySpaceConfig(editableProject.path, initialBySpaceConfig);

    await clickReloadProjectSettings(page);

    await expectNoProjectSettingsError(page, "invalid");
    await expectProjectSettingsFormVisible(page);
  });

  test("write_failed callout appears on save with blocked directory, retry re-attempts, reload clears it", async ({
    page,
    editableProject,
  }) => {
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    await blockBySpaceConfigWrites(editableProject.path);

    await clickSaveProjectSettings(page);

    await expectProjectSettingsError(page, "write_failed");
    await expectWriteFailedCalloutActions(page);

    await clickRetryProjectSettingsSave(page);
    await expectProjectSettingsError(page, "write_failed");

    await unblockBySpaceConfigWrites(editableProject.path);
    await clickReloadProjectSettings(page);
    await expectNoProjectSettingsError(page, "write_failed");
    await expectProjectSettingsFormVisible(page);
  });

  test("read-transport failure shows callout, reload recovers", async ({
    page,
    editableProject,
  }) => {
    // Reject read_project_config_request calls until the user clicks Reload.
    // This keeps automatic reconnect refetches from racing past the callout.
    const transportFailure = await installReadTransportFailure(page);

    await openProjects(page);
    await navigateToProjectSettings(page, editableProject.name);

    await expectProjectSettingsError(page, "transport");
    await expectProjectSettingsFormHidden(page);

    // Retry Reload until the refetch wins any in-flight error-state rendering.
    transportFailure.allowRecovery();
    await expect(async () => {
      await clickReloadProjectSettings(page);
      await expectNoProjectSettingsError(page, "transport", 3_000);
    }).toPass({ timeout: 15_000 });
    await expectProjectSettingsFormVisible(page);
  });

  test("project settings shows no-target state when daemon connection drops", async ({
    page,
    editableProject,
  }) => {
    const gate = await installDaemonConnectionGate(page);

    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    // Closing with code 1001 (Going Away) transitions DaemonClient to "error" state.
    // The NoEditableTarget UI renders via isHostGone check regardless of state.
    await gate.drop();

    await expectNoEditableTarget(page);
  });

  test("single-host project renders static host indicator, not a picker chip", async ({
    page,
    editableProject,
  }) => {
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    await expectHostIndicatorVisible(page);
    await expectHostPickerHidden(page);
  });

  test("script removal via kebab menu removes the row from the form", async ({
    page,
    editableProject,
  }) => {
    await openProjects(page);
    await openProjectSettings(page, editableProject.name);

    await expectScriptRowCount(page, 1);

    await removeProjectScript(page, "dev");

    await expectScriptRowCount(page, 0);
    await expectEmptyScriptList(page);
  });
});
