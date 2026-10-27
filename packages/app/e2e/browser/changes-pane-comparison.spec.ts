import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  AFTER,
  BEFORE,
  createWorkspaceWithCommittedDiff,
  createWorkspaceWithMountedTabDiff,
  createWorkspaceWithScrollableComparisons,
  diffHeaderForPath,
  expectWorkingComparisonFiles,
  openWorkspaceChanges,
  openWorkspaceChangesSurface,
  selectChangedFileAndExpectFocused,
  selectChangesComparison,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

// Comparison lifecycle: opening, expiring, and the empty state.
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

test("Changes opens the populated committed comparison for a clean checkout", async ({ page }) => {
  const workspace = await createWorkspaceWithCommittedDiff();

  await openWorkspaceChangesSurface(page, workspace, 90_000);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await expect(tree.getByTestId("changes-diff-status-trigger")).toContainText("Committed");
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("committed-only.ts, +1, -0");
});

test("Changes expires a manual comparison when checkout dirtiness changes", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await openWorkspaceChanges(page, workspace);

  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const mode = tree.getByTestId("changes-diff-status-trigger");
  await expect(mode).toContainText("Uncommitted");

  await mode.click();
  await page.getByTestId("changes-diff-mode-committed").click();
  await expect(mode).toContainText("Committed");
  await expect(tree.getByRole("button", { name: "See uncommitted changes" })).toBeVisible();

  execFileSync("git", ["add", "--all"], { cwd: workspace.repoPath });
  execFileSync("git", ["commit", "-m", "Commit working changes"], { cwd: workspace.repoPath });
  await expect(mode).toContainText("Committed");
  await expect(tree.getByRole("button", { name: "See uncommitted changes" })).toHaveCount(0, {
    timeout: 30_000,
  });

  await writeFile(path.join(workspace.repoPath, "new-working-change.txt"), "uncommitted\n");
  await expect(mode).toContainText("Uncommitted", { timeout: 30_000 });
});

test("an empty Changes comparison links to the populated comparison", async ({ page }) => {
  const workspace = await createWorkspaceWithCommittedDiff();
  await openWorkspaceChangesSurface(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const mode = tree.getByTestId("changes-diff-status-trigger");
  await mode.click();
  await page.getByTestId("changes-diff-mode-committed").click();
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("committed-only.ts, +1, -0");

  await mode.click();
  await page.getByTestId("changes-diff-mode-uncommitted").click();

  await expect(tree.getByText("No changes to display", { exact: true })).toBeVisible();
  await expect(panel.getByText("No changes to display", { exact: true })).toBeVisible();
  const seeCommitted = tree.getByRole("button", { name: "See committed changes" });
  await expect(seeCommitted).toBeVisible();
  await seeCommitted.click();
  await expect(mode).toContainText("Committed");
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("committed-only.ts, +1, -0");
});

test("Changes comparison controls the working diff and tree selection focuses its file", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithScrollableComparisons();
  await openWorkspaceChangesSurface(page, workspace);

  await selectChangesComparison(page, "Committed");
  await expectWorkingComparisonFiles(page, "committed");
  await selectChangedFileAndExpectFocused(page, "committed/50-target.ts");

  await selectChangesComparison(page, "Uncommitted");
  await expectWorkingComparisonFiles(page, "uncommitted");
  await selectChangedFileAndExpectFocused(page, "uncommitted/50-target.ts");
});

test("Changes keeps review navigation and controls inside its workspace tab", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const visiblePanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(visiblePanel).toBeVisible();
  await expect(visiblePanel.getByTestId("changes-repository-header")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-branch-switcher")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-diff-status-trigger")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-selected-diff-stat")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-header")).toHaveCount(1);
  await expect(diffHeaderForPath(visiblePanel, "src/use-mounted-tab-set.ts")).toHaveAccessibleName(
    "src/use-mounted-tab-set.ts, +37, -1",
  );
  await expect(diffHeaderForPath(visiblePanel, "src/zz-deleted.ts")).toHaveAccessibleName(
    "src/zz-deleted.ts, +0, -1",
  );
  await expect(visiblePanel.getByTestId("changes-primary-cta")).toHaveCount(0);
  await expect(page.getByTestId("changes-primary-cta")).toHaveCount(1);
  await expect(page.getByTestId("changes-primary-cta")).toContainText("Commit");
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).not.toBeVisible();

  await expect(visiblePanel.getByRole("button", { name: "Diff options" })).toHaveCount(0);
  await expect(page.getByTestId("changes-open-tab")).toHaveCount(0);
  const collapseFiles = visiblePanel.getByTestId("changes-toggle-collapse-all");
  await expect(collapseFiles).toHaveAttribute("aria-label", "Collapse all files");
  await collapseFiles.click();
  await expect(collapseFiles).toHaveAttribute("aria-label", "Expand all files");
  await collapseFiles.click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();

  const layout = visiblePanel.getByTestId("changes-toggle-layout");
  await expect(layout).toHaveAttribute("aria-label", "Switch to side-by-side diff");
  await layout.click();
  await expect(layout).toHaveAttribute("aria-label", "Switch to unified diff");

  const whitespace = visiblePanel.getByTestId("changes-toggle-whitespace");
  await expect(whitespace).toHaveAttribute("aria-label", "Hide whitespace");
  const wrapLines = visiblePanel.getByTestId("changes-toggle-wrap-lines");
  await expect(wrapLines).toHaveAttribute("aria-label", "Wrap long lines");
  await expect(visiblePanel.getByTestId("changes-refresh")).toHaveAttribute(
    "aria-label",
    "Refresh",
  );
  await wrapLines.click();
  await expect(wrapLines).toHaveAttribute("aria-label", "Scroll long lines");
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);

  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), BEFORE);
  await expect(
    visiblePanel.locator('[data-diff-header-path="src/use-mounted-tab-set.ts"]'),
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(visiblePanel.locator('[data-diff-header-path="src/zz-deleted.ts"]')).toBeVisible();
  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), AFTER);
  await expect(diffHeaderForPath(visiblePanel, "src/use-mounted-tab-set.ts")).toHaveAccessibleName(
    "src/use-mounted-tab-set.ts, +37, -1",
    { timeout: 30_000 },
  );
  await expect(diffHeaderForPath(visiblePanel, "src/zz-deleted.ts")).toHaveAccessibleName(
    "src/zz-deleted.ts, +0, -1",
  );
});

test("compact Changes keeps its actions compact and menu-only", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  await page.setViewportSize({ width: 480, height: 900 });

  const compactChangesTab = page.getByTestId("explorer-tab-changes").filter({ visible: true });
  if (!(await compactChangesTab.isVisible())) {
    await page.getByTestId("workspace-explorer-toggle").first().click();
  }
  await expect(compactChangesTab).toBeVisible();
  await compactChangesTab.click();
  const compactExplorer = page.getByTestId("explorer-content-area").filter({ visible: true });
  await expect(compactExplorer.getByTestId("changes-header")).toBeVisible();

  const actions = compactExplorer.getByTestId("changes-actions-menu-trigger");
  const options = compactExplorer.getByRole("button", { name: "Diff options" });
  const [actionsBox, optionsBox, glyphBox] = await Promise.all([
    actions.boundingBox(),
    options.boundingBox(),
    options.locator("svg").boundingBox(),
  ]);
  if (!actionsBox || !optionsBox || !glyphBox) {
    throw new Error("Compact Changes toolbar geometry could not be measured");
  }
  expect(actionsBox.width).toBe(48);
  expect(actionsBox.height).toBe(28);
  expect(optionsBox.width).toBe(32);
  expect(optionsBox.height).toBe(32);
  expect(glyphBox.width).toBe(18);
  expect(glyphBox.height).toBe(18);

  await expect(actions).not.toContainText("Commit");
  await expect(actions.locator("svg")).toHaveCount(2);
  await actions.click();
  await expect(page.getByTestId("changes-primary-cta-menu")).toBeVisible();
  await expect(page.getByTestId("changes-menu-commit")).toContainText("Commit");
  await page.keyboard.press("Escape");

  await options.click();
  const wrapLines = page.getByText("Wrap long lines", { exact: true });
  await expect(wrapLines).toBeVisible();
  await wrapLines.click();
  await options.click();
  await expect(
    page.getByTestId("changes-options-menu-content").getByTestId("changes-toggle-wrap-lines"),
  ).toContainText("Scroll long lines");
});
