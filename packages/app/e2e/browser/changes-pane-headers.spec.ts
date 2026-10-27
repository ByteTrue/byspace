import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  createWorkspaceWithExactSelectionDiff,
  createWorkspaceWithMountedTabDiff,
  createWorkspaceWithStickyTransitionDiff,
  headerCanvasPixel,
  horizontallyScrollFirstFile,
  longPressFileHeader,
  measureInFlowHeaderMotion,
  openSelectionWorkspaceChanges,
  openWorkspaceChanges,
  openWorkspaceChangesSurface,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";

// File headers: selection, hover feedback, and the sticky handoff.
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

test("canvas file headers select without toggling for context menu and long press", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const firstFile = page.getByTestId("diff-file-0-toggle");
  const deletedFile = page.getByTestId("diff-file-1-toggle");
  await deletedFile.click({ button: "right" });
  await expect(deletedFile).toHaveAttribute("aria-selected", "true");
  await expect(deletedFile).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.keyboard.press("Escape");

  await longPressFileHeader(page, firstFile);
  await expect(firstFile).toHaveAttribute("aria-selected", "true");
  await expect(deletedFile).toHaveAttribute("aria-selected", "false");
  await expect(firstFile).toHaveAttribute("aria-expanded", "true");
});

test("every interactive file header has the same hover feedback", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const first = page.getByTestId("diff-file-0-toggle");
  const second = page.getByTestId("diff-file-1-toggle");
  const firstCanvas = page.getByTestId("git-diff-sticky-header-0");
  const secondCanvas = page.getByTestId("git-diff-sticky-header-1");
  const normalBackground = await headerCanvasPixel(firstCanvas, first, 10);

  await first.hover();
  await expect.poll(() => headerCanvasPixel(firstCanvas, first, 10)).not.toBe(normalBackground);
  const hoverBackground = await headerCanvasPixel(firstCanvas, first, 10);

  await first.click();
  await page.mouse.move(0, 0);
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => headerCanvasPixel(firstCanvas, first, 10)).toBe(normalBackground);

  await first.hover();
  await expect.poll(() => headerCanvasPixel(firstCanvas, first, 10)).toBe(hoverBackground);
  await second.hover();
  await expect.poll(() => headerCanvasPixel(firstCanvas, first, 10)).toBe(normalBackground);
  await expect.poll(() => headerCanvasPixel(secondCanvas, second, 10)).toBe(hoverBackground);
});

test("horizontal body scrolling never moves or repaints the canvas header", async ({ page }) => {
  const wideLine = `export const wide = "${"wide".repeat(160)}";`;
  const workspace = await createWorkspaceWithExactSelectionDiff(wideLine);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  const headerCanvas = page.getByTestId("git-diff-canvas");
  const header = page.getByTestId("diff-file-0-toggle");
  const beforePixel = await headerCanvasPixel(headerCanvas, header, 10);
  const beforeBounds = await header.boundingBox();

  await horizontallyScrollFirstFile(page, 320);
  await page.waitForTimeout(50);

  expect(await headerCanvasPixel(headerCanvas, header, 10)).toBe(beforePixel);
  expect(await header.boundingBox()).toEqual(beforeBounds);
});

test("in-flow file headers move with the diff document", async ({ page }) => {
  const workspace = await createWorkspaceWithStickyTransitionDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChangesSurface(page, workspace);

  const motion = await measureInFlowHeaderMotion(page);

  expect(motion).toEqual({ headerSurface: -120, shell: -120 });
});

test("the outgoing sticky header hands off without a gap or overlap", async ({
  page,
}, testInfo) => {
  const workspace = await createWorkspaceWithStickyTransitionDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChangesSurface(page, workspace);

  const scroller = page.getByTestId("git-diff-scroll");
  const first = page.getByTestId("diff-file-0-toggle");
  const second = page.getByTestId("diff-file-1-toggle");
  const secondTop = await second.evaluate((element) => {
    const scrollElement = element.closest<HTMLElement>('[data-testid="git-diff-scroll"]');
    if (!scrollElement) return Number.NaN;
    return (
      scrollElement.scrollTop +
      element.getBoundingClientRect().top -
      scrollElement.getBoundingClientRect().top
    );
  });
  expect(secondTop).toBeGreaterThan(30);
  await scroller.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  }, secondTop - 15);
  await expect(first).toBeAttached();
  await expect(second).toBeAttached();

  const [scrollBounds, firstBounds, secondBounds] = await Promise.all([
    scroller.boundingBox(),
    first.boundingBox(),
    second.boundingBox(),
  ]);
  if (!scrollBounds || !firstBounds || !secondBounds) {
    throw new Error("Sticky transition geometry is unavailable");
  }
  expect(firstBounds.y - scrollBounds.y).toBeCloseTo(-15, 0);
  expect(secondBounds.y - scrollBounds.y).toBeCloseTo(15, 0);
  const transitionHits = await scroller.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [14, 16].map(
      (y) =>
        document
          .elementFromPoint(bounds.left + bounds.width / 2, bounds.top + y)
          ?.closest<HTMLElement>("[data-diff-header]")?.dataset.diffHeaderPath ?? null,
    );
  });
  expect(transitionHits).toEqual(["src/first.ts", "src/second.ts"]);
  await testInfo.attach("canvas-header-sticky-handoff", {
    body: await page.getByTestId("git-diff-canvas-root").screenshot(),
    contentType: "image/png",
  });

  await scroller.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  }, secondTop);
  await expect
    .poll(async () => {
      const bounds = await second.boundingBox();
      return bounds ? bounds.y - scrollBounds.y : Number.NaN;
    })
    .toBeCloseTo(0, 0);
});
