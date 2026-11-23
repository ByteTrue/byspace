import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { submitMessage } from "../support/helpers/composer";
import { cleanupRewindFlow, launchAgent, type AgentHandle } from "../support/helpers/rewind-flow";
import { openSubagentsTrack } from "../support/helpers/subagents";

process.env.CLAUDE_CODE_WORKFLOWS = "1";

const WORKFLOW_SCRIPT = path.resolve(
  import.meta.dirname,
  "../fixtures/claude-workflow/inspect-project.js",
);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

test.describe("real Claude project-inspection workflow", () => {
  test.setTimeout(600_000);

  test("shows the workflow's actual report in the generic detail pane", async ({
    page,
  }, testInfo) => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "byspace-project-inspection-")));
    let handle: AgentHandle | undefined;

    try {
      handle = await launchAgent({ page, provider: "claude", cwd, mode: "full-access" });
      await submitMessage(
        page,
        `Use Claude Code's Workflow tool exactly once with scriptPath ${JSON.stringify(
          WORKFLOW_SCRIPT,
        )} and args ${JSON.stringify({ repoPath: REPO_ROOT })}. Wait for completion, then reply with exactly PROJECT_INSPECTION_DONE.`,
      );

      await expect(page.getByTestId("subagents-track-header")).toBeVisible({ timeout: 60_000 });
      await openSubagentsTrack(page);
      const row = page
        .getByTestId(/^subagents-track-row-/)
        .filter({ has: page.getByText("Workflow", { exact: true }) });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(row.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0, {
        timeout: 180_000,
      });
      await expect(
        page.getByTestId("assistant-message").filter({ hasText: "PROJECT_INSPECTION_DONE" }).last(),
      ).toBeVisible({ timeout: 180_000 });

      await openSubagentsTrack(page);
      await row.click();
      const panel = page.getByTestId("provider-subagent-panel");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      for (const heading of [
        "What BySpace is",
        "Who it is for",
        "How it works",
        "Repository structure",
      ]) {
        await expect(panel).toContainText(heading);
      }
      await expect(panel.getByText("export const meta", { exact: false })).toHaveCount(0);
      await expect(
        panel.getByText("Inspect the BySpace repository at", { exact: false }),
      ).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("project-workflow-pane.png") });
    } finally {
      await cleanupRewindFlow({ handle, cwd });
    }
  });
});
