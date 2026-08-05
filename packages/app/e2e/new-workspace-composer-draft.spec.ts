import { test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  expectNewWorkspaceDraft,
  expectNewWorkspaceProjectSelected,
  fillNewWorkspaceDraft,
  openNewWorkspaceComposer,
  selectNewWorkspaceProject,
} from "./helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

const DRAFT = `Please investigate the workspace startup failure.

Trace the request from the app through the daemon, preserve the existing behavior, and explain the root cause before making changes.`;

test.describe("New workspace composer draft", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the draft when the project changes", async ({ page }) => {
    const firstProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-a-",
    });
    const secondProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-b-",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: firstProject.projectKey,
        projectDisplayName: firstProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, firstProject.projectDisplayName);

      await fillNewWorkspaceDraft(page, DRAFT);

      await selectNewWorkspaceProject(page, {
        projectKey: secondProject.projectKey,
        projectDisplayName: secondProject.projectDisplayName,
      });

      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await secondProject.cleanup();
      await firstProject.cleanup();
    }
  });
});
