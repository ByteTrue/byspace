import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  AFTER,
  BEFORE,
  changesTree,
  createWorkspaceWithMountedTabDiff,
  diffHeaderForPath,
  failNextDiscardRequest,
  openWorkspaceChanges,
  readFileIfPresent,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Changes tree: ordering, context menus, revert and discard.
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

test("changes file actions open below the right-click without a reserved kebab", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const deletedFileName = page.getByTestId("diff-file-1");
  await expect(deletedFileName).toHaveAccessibleName(/zz-deleted\.ts/);
  await deletedFileName.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-file-1-toggle").click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.getByText("Copy path", { exact: true }).click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await expect(page.getByTestId("diff-file-1-open-file")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const fileRow = page.getByTestId("diff-file-0-toggle");
  const fileRowBounds = await fileRow.boundingBox();
  expect(fileRowBounds).not.toBeNull();
  await fileRow.click({ button: "right", position: { x: 80, y: 10 } });
  await expect(page.getByTestId("diff-file-0-open-file")).toBeVisible();
  const menuBounds = await page.getByTestId("diff-file-0-context-menu").boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(Math.abs(menuBounds!.x - (fileRowBounds!.x + 80))).toBeLessThanOrEqual(1);
  expect(menuBounds!.y).toBeGreaterThan(fileRowBounds!.y + 10);
  await page.getByTestId("diff-file-0-open-file").click();

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
});

test("changes context menus duplicate files and folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-duplicate").click();
  await expect
    .poll(() => readFileIfPresent(path.join(workspace.repoPath, "src/use-mounted-tab-set copy.ts")))
    .toBe(AFTER);

  await changesTree(page).getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-duplicate").click();
  await expect
    .poll(() => readFileIfPresent(path.join(workspace.repoPath, "src copy/use-mounted-tab-set.ts")))
    .toBe(AFTER);
});

test("changes tree aligns every file status after its diff stat", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeDeletedFile: true,
    includeUntrackedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  const tree = changesTree(page);
  const modifiedRow = tree.getByTestId("diff-tree-file-0");
  const deletedRow = tree.getByTestId("diff-tree-file-1");
  const addedRow = tree.getByTestId("diff-tree-file-2");
  const modifiedStatus = modifiedRow.getByRole("img", { name: "Modified" });
  await expect(modifiedStatus).toBeVisible();
  await expect(deletedRow.getByRole("img", { name: "Deleted" })).toBeVisible();
  await expect(addedRow.getByRole("img", { name: "New" })).toBeVisible();

  const [statBounds, statusBounds] = await Promise.all([
    modifiedRow.getByTestId("diff-tree-file-0-stat").boundingBox(),
    modifiedStatus.boundingBox(),
  ]);
  if (!statBounds || !statusBounds) throw new Error("Changes tree trailing status has no bounds");
  expect(statusBounds.x - (statBounds.x + statBounds.width)).toBeGreaterThanOrEqual(8);
});

test("the scrolling diff lists files in changes tree order", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeNestedFolders: true,
    includeRootFileSortingFirst: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const tree = changesTree(page);
  const treeNames = tree.locator('[data-testid^="diff-tree-file-"][data-testid$="-name"]');
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const diffHeaders = panel.getByTestId(/^diff-file-\d+$/);

  // Directories sort before files at every level, so the root note lands last
  // even though "a-root-note.txt" compares below "src/..." as a whole string.
  const expected = ["changed.ts", "root.ts", "use-mounted-tab-set.ts", "a-root-note.txt"];

  // Equal counts also prove no folder is collapsed: flattenDiffTree drops the
  // descendants of a collapsed folder, which would make the tree a subsequence
  // of the diff rather than a match, and mask a real ordering difference.
  await expect(treeNames).toHaveCount(expected.length);
  await expect(diffHeaders).toHaveCount(expected.length);
  await expect(treeNames).toHaveText(expected);
  const expectedHeaderNames = [
    "src/zz-folder/nested/changed.ts, +1, -1",
    "src/zz-folder/root.ts, +1, -1",
    "src/use-mounted-tab-set.ts, +37, -1",
    "a-root-note.txt, +1, -0",
  ];
  for (const [index, accessibleName] of expectedHeaderNames.entries()) {
    await expect(diffHeaders.nth(index)).toHaveAccessibleName(accessibleName);
  }
});

test("changes context menu recursively collapses descendant folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeNestedFolders: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const tree = changesTree(page);
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(tree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  const rootRow = tree.getByTestId("diff-folder-src-toggle");
  const rootLabel = tree.getByTestId("diff-folder-src-toggle").getByText("src", { exact: true });
  await expect(rootRow).toHaveCSS("opacity", "1");
  await expect(rootLabel).toHaveCSS("opacity", "0.76");
  await rootRow.hover();
  await expect(rootLabel).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  const nestedLabel = tree
    .getByTestId("diff-folder-src/zz-folder-toggle")
    .getByText("zz-folder", { exact: true });
  const [rootBounds, nestedBounds] = await Promise.all([
    rootLabel.boundingBox(),
    nestedLabel.boundingBox(),
  ]);
  if (!rootBounds || !nestedBounds) throw new Error("Changes tree rows have no bounds");
  expect(nestedBounds.x - rootBounds.x).toBe(12);

  await tree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-collapse-folder").click();
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toHaveCount(0);

  await tree.getByTestId("diff-folder-src-toggle").click();
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(tree.getByText("root.ts", { exact: true })).toHaveCount(0);

  await tree.getByTestId("diff-folder-src/zz-folder-toggle").click();
  await expect(tree.getByText("root.ts", { exact: true })).toBeVisible();
  await expect(tree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  await expect(tree.getByText("changed.ts", { exact: true })).toHaveCount(0);

  await tree.getByTestId("diff-folder-src/zz-folder/nested-toggle").click();
  await expect(tree.getByText("changed.ts", { exact: true })).toBeVisible();
});

test("changes context menus expose folder revert and restore a file after confirmation", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const tree = changesTree(page);
  await tree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  const folderRevert = page.getByTestId("diff-folder-src-revert");
  await expect(folderRevert).toBeVisible();
  const revertLabelColor = await folderRevert
    .getByText("Discard changes", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(folderRevert.locator("svg")).toHaveCSS("stroke", revertLabelColor);
  await page.keyboard.press("Escape");

  await tree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  const cancelledConfirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      resolve(message);
    });
  });
  await page.getByTestId("diff-tree-file-0-revert").click();
  expect(await cancelledConfirmation).toContain("src/use-mounted-tab-set.ts");
  await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);

  await tree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      resolve(message);
    });
  });
  await page.getByTestId("diff-tree-file-0-revert").click();
  expect(await confirmation).toContain("src/use-mounted-tab-set.ts");

  await expect(tree.getByTestId("diff-tree-file-0")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(BEFORE);
});

test("discarding a staged rename restores its source path", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeRenamedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const renamedHeader = diffHeaderForPath(panel, "src/zz-renamed.ts");
  await expect(renamedHeader).toHaveAccessibleName("src/zz-renamed.ts, +1, -0");
  const renamedToggle = renamedHeader.getByTestId(/^diff-file-\d+-toggle$/);
  const toggleTestId = await renamedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await renamedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-renamed.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/rename-source.ts"), "utf8"))
    .toBe("export const renamed = true;\n");
});

test("discarding an untracked file removes it from the working tree", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeUntrackedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const untrackedHeader = diffHeaderForPath(panel, "zz-untracked.txt");
  await expect(untrackedHeader).toHaveAccessibleName("zz-untracked.txt, +1, -0");
  const untrackedToggle = untrackedHeader.getByTestId(/^diff-file-\d+-toggle$/);
  const toggleTestId = await untrackedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await untrackedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-untracked.txt", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    readFile(path.join(workspace.repoPath, "zz-untracked.txt"), "utf8"),
  ).rejects.toThrow();
});

test("shows a revert error returned by the daemon", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await failNextDiscardRequest(page);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  await confirmation;

  await expect(page.getByText("Injected revert failure", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);
});
