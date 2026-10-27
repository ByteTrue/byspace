import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  cancelInlineReview,
  changeCodeTypographyFromSettings,
  configureDiffPresentation,
  createWorkspaceWithExactSelectionDiff,
  createWorkspaceWithManyTinyDiffs,
  createWorkspaceWithMountedTabDiff,
  deleteInlineReview,
  editInlineReview,
  expectDiffCodeFontFamily,
  expectDiffCodeFontSize,
  expectExpandedMountedTabDiff,
  expectStoredCodeFontSize,
  expectVisibleDiffRowsShareTypography,
  holdBrowserFontLoads,
  horizontallyScrollFirstFile,
  hoverFirstChangedGutter,
  openSelectionWorkspaceChanges,
  openWorkspaceChanges,
  openWorkspaceChangesSurface,
  readDiffTypographyGeometry,
  releaseBrowserFontLoads,
  returnToWorkspaceChanges,
  saveInlineReview,
  scrollToLowerUnwrappedDiffRows,
  setOpenChangesPresentation,
  startReviewOnFirstChangedLine,
  useCodeFont,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { getServerId } from "../support/helpers/server-id";
import { openChangesPanel, waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

// Canvas rendering: typography, reviews, scrolling and geometry.
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

test("canvas diff stays sharp while its workspace pane is resized", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const canvas = page.getByTestId("git-diff-canvas");
  const root = page.getByTestId("git-diff-canvas-root");
  const handle = page
    .getByTestId("workspace-explorer-sidebar-resize-handle")
    .getByRole("separator");
  await expect(handle).toBeVisible();
  await expect
    .poll(async () => {
      const [canvasWidth, rootWidth] = await Promise.all([
        canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
        root.evaluate((element) => element.getBoundingClientRect().width),
      ]);
      return Math.abs(canvasWidth - rootWidth) < 1;
    })
    .toBe(true);
  const [handleBounds, before] = await Promise.all([
    handle.boundingBox(),
    canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        width: canvasElement.getBoundingClientRect().width,
        ratio: window.devicePixelRatio || 1,
      };
    }),
  ]);
  if (!handleBounds) throw new Error("Explorer sidebar resize handle has no bounds");

  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + 120, handleBounds.y + 120);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const duringDrag = await Promise.all([
    canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
    root.evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(duringDrag[0]).toBeCloseTo(before.width, 0);
  expect(duringDrag[1]).toBeGreaterThan(before.width + 10);

  await page.mouse.up();
  const resizeFrames = await page.evaluate(async () => {
    const canvasElement = document.querySelector<HTMLCanvasElement>(
      '[data-testid="git-diff-canvas"]',
    )!;
    const ratio = window.devicePixelRatio || 1;
    const frames: Array<{ cssWidth: number; bitmapWidth: number }> = [];
    for (let index = 0; index < 10; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push({
        cssWidth: canvasElement.getBoundingClientRect().width,
        bitmapWidth: canvasElement.width / ratio,
      });
    }
    return frames;
  });
  for (const frame of resizeFrames) {
    expect(Math.abs(frame.cssWidth - frame.bitmapWidth)).toBeLessThan(1);
  }
  await expect
    .poll(async () => {
      const [canvasWidth, rootWidth, backingWidth] = await Promise.all([
        canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
        root.evaluate((element) => element.getBoundingClientRect().width),
        canvas.evaluate((element) => (element as HTMLCanvasElement).width),
      ]);
      return (
        Math.abs(canvasWidth - rootWidth) < 1 &&
        Math.abs(backingWidth / before.ratio - rootWidth) < 1
      );
    })
    .toBe(true);
});

test("changes diff applies code size changes to gutter and code typography", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  const before = await readDiffTypographyGeometry(page);

  await changeCodeTypographyFromSettings(page, {
    fontSize: 18,
    fontFamily: "Courier New, Courier, monospace",
  });
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);
  await scrollToLowerUnwrappedDiffRows(page);

  await expectDiffCodeFontSize(page, 18);
  await expectDiffCodeFontFamily(page, "Courier");
  await expectVisibleDiffRowsShareTypography(page);
  const after = await readDiffTypographyGeometry(page);
  expect(after.horizontalExtent).toBeGreaterThan(before.horizontalExtent);
  expect(after.canvasPixels).not.toEqual(before.canvasPixels);
});

test("canvas diff does not commit geometry before configured fonts are ready", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await holdBrowserFontLoads(page);
  await useUnwrappedDiffLines(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);

  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.getByTestId("diff-file-0-body")).toHaveCount(0);
  await releaseBrowserFontLoads(page);
  await expectExpandedMountedTabDiff(page);
});

test("canvas diff creates, edits, and deletes an inline review without DOM code rows", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await startReviewOnFirstChangedLine(page);
  await cancelInlineReview(page);
  await startReviewOnFirstChangedLine(page);
  await saveInlineReview(page, "Please keep this branch explicit");
  await editInlineReview(page, "Please keep this branch named explicitly");
  await deleteInlineReview(page);

  await expect(page.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
});

test("autofocusing an inline review keeps the Changes tab focused", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const changesTab = page.getByTestId("workspace-tab-working_diff").filter({ visible: true });
  const focusedBackground = await changesTab.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await startReviewOnFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor-input")).toBeFocused();
  await expect
    .poll(() => changesTab.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(focusedBackground);
});

test("inline reviews keep the browser text context menu", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await startReviewOnFirstChangedLine(page);
  await page.getByTestId("inline-review-editor-input").click({ button: "right" });
  await expect(page.getByTestId("diff-source-context-menu")).toHaveCount(0);
});

test("split canvas creates a review on the changed side and keeps it in that column", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await configureDiffPresentation(page, { layout: "split", wrapLines: false });
  await openWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "split", wrapLines: false });
  await startReviewOnFirstChangedLine(page, "right");
  const [editor, body] = await Promise.all([
    page.getByTestId("inline-review-editor").boundingBox(),
    page.getByTestId("diff-file-0-body").boundingBox(),
  ]);
  expect(editor).not.toBeNull();
  expect(body).not.toBeNull();
  expect(editor!.x).toBeGreaterThanOrEqual(body!.x + body!.width / 2);
  await cancelInlineReview(page);
});

test("scrolling clears the hovered review affordance", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await hoverFirstChangedGutter(page);
  await expect(page.getByRole("button", { name: "Add review comment" })).toBeVisible();
  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop += 80;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });

  await expect(page.getByRole("button", { name: "Add review comment" })).toHaveCount(0);
});

test("canvas diff uses the overlay scrollbar and its thumb controls vertical scrolling", async ({
  page,
}) => {
  const lines = Array.from({ length: 240 }, (_, index) => `export const line${index} = ${index};`);
  const workspace = await createWorkspaceWithExactSelectionDiff(lines.join("\n"));
  await openSelectionWorkspaceChanges(page, workspace);

  const root = page.getByTestId("git-diff-canvas-root");
  const scroller = page.getByTestId("git-diff-scroll");
  const grab = root.getByTestId("workspace-overlay-scrollbar-grab");
  await expect(grab).toBeVisible();
  await expect(scroller).toHaveCSS("scrollbar-width", "none");

  const bounds = await grab.boundingBox();
  if (!bounds) throw new Error("Diff overlay scrollbar thumb has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(grab).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 180);
  await page.mouse.up();

  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("canvas headers keep a many-file diff bounded while scrolling end to end", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const workspace = await createWorkspaceWithManyTinyDiffs(2_000);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChangesSurface(page, workspace, 90_000);

  const root = page.getByTestId("git-diff-canvas-root");
  const scroller = page.getByTestId("git-diff-scroll");
  await expect(root.locator('[data-testid^="git-diff-sticky-header-"]')).toHaveCount(2);
  await expect.poll(() => root.locator('[data-diff-header="true"]').count()).toBeLessThan(120);

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });

  await expect(page.getByTestId("diff-file-1999")).toBeVisible();
  await expect.poll(() => root.locator('[data-diff-header="true"]').count()).toBeLessThan(120);
  await expect(root.locator('[data-testid^="git-diff-sticky-header-"]')).toHaveCount(2);
});

test("the whole reviewable row reveals the gutter affordance and uses a text cursor", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  await page.mouse.move(bodyBounds.x + bodyBounds.width - 32, bodyBounds.y + lineHeight * 1.5);

  const affordance = page.getByRole("button", { name: "Add review comment" });
  await expect(affordance).toBeVisible();
  await expect(affordance.locator("svg")).toBeVisible();
  const affordanceBounds = await affordance.boundingBox();
  expect(affordanceBounds?.width).toBeCloseTo(22, 0);
  expect(affordanceBounds?.height).toBeCloseTo(22, 0);
  await expect(affordance).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("git-diff-scroll")).toHaveCSS("cursor", "text");
});

test("collapsing and expanding restores the real horizontal scroll offset", async ({ page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("x".repeat(400));
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  const retainedOffset = await horizontallyScrollFirstFile(page, 320);
  await page.getByTestId("diff-file-0-toggle").click();
  await expect(page.getByTestId("diff-file-0-horizontal-scroll")).toHaveCount(0);
  await page.getByTestId("diff-file-0-toggle").click();

  await expect
    .poll(() =>
      page.getByTestId("diff-file-0-horizontal-scroll").evaluate((element) => element.scrollLeft),
    )
    .toBe(retainedOffset);
});
