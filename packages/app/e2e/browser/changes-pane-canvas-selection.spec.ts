import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  clickFirstChangedLine,
  configureDiffPresentation,
  createWorkspaceWithExactSelectionDiff,
  createWorkspaceWithTwoSelectionDiffs,
  dragAddedTextRange,
  dragExactAddedText,
  dragFirstAddedLineIntoHeader,
  dragWithinFirstAddedGrapheme,
  horizontallyScrollFirstFile,
  openSelectionWorkspaceChanges,
  openWorkspaceChanges,
  readSelectionPaintSamples,
  rightClickFirstChangedLine,
  setOpenChangesPresentation,
  useCodeFont,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";

// Canvas selection: dragging, copying and clipboard contents.
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

test("canvas diff copies a dragged character selection without opening a review", async ({
  context,
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await page.keyboard.press("ControlOrMeta+C");

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("CDEFGH");
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});

test("canvas diff context menu copies selections and source lines", async ({ context, page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await rightClickFirstChangedLine(page);
  await page.getByTestId("diff-source-copy-selection").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("CDEFGH");

  await rightClickFirstChangedLine(page);
  await page.getByTestId("diff-source-copy-line").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("ABCDEFGHIJ");
});

test("canvas diff clears a selection when collapsing an earlier file", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoSelectionDiffs();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 }, 1);
  await page.getByTestId("diff-file-0-toggle").click();
  await rightClickFirstChangedLine(page, 1);
  await expect(page.getByTestId("diff-source-copy-selection")).toBeDisabled();
});

test("clicking the canvas dismisses a selection without opening a review", async ({ page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await clickFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  await clickFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});

test("canvas diff replaces a selection with forward and backward drags", async ({
  context,
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDE\nFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);
  for (const [start, end, expectedText] of [
    [{ line: 0, offset: 2 }, { line: 1, offset: 3 }, "CDE\nFGH"],
    [{ line: 1, offset: 5 }, { line: 0, offset: 3 }, "DE\nFGHIJ"],
  ] as const) {
    await dragAddedTextRange(page, { lines: ["ABCDE", "FGHIJ"], start, end });
    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedText);
  }
});

test("canvas diff copies only the selected split side", async ({ context, page }) => {
  const lines = ["RIGHT-ONE", "RIGHT-TWO"];
  const workspace = await createWorkspaceWithExactSelectionDiff(lines.join("\n"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await configureDiffPresentation(page, { layout: "split", wrapLines: false });
  await openSelectionWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "split", wrapLines: false });
  const before = await readSelectionPaintSamples(page, "right");
  await dragAddedTextRange(page, {
    lines,
    side: "right",
    start: { line: 0, offset: 1 },
    end: { line: 1, offset: 5 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("IGHT-ONE\nRIGHT");
  const after = await readSelectionPaintSamples(page, "right");
  expect(after.gutter).toEqual(before.gutter);
  expect(after.opposite).toEqual(before.opposite);
  expect(after.code).not.toEqual(before.code);
});

test("canvas diff copies exact wrapped fragments", async ({ context, page }) => {
  const content = "abcdefghijklmnopqrstuvwxyz".repeat(8);
  const workspace = await createWorkspaceWithExactSelectionDiff(content);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await configureDiffPresentation(page, { layout: "unified", wrapLines: true });
  await openSelectionWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "unified", wrapLines: true });
  await dragAddedTextRange(page, {
    lines: [content],
    wrapped: true,
    start: { line: 0, offset: 35 },
    end: { line: 0, offset: 95 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(content.slice(35, 95));
});

test("horizontally scrolled selection copies exactly and does not paint the gutter", async ({
  context,
  page,
}) => {
  const content = "0123456789".repeat(50);
  const workspace = await createWorkspaceWithExactSelectionDiff(content);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);
  const horizontalOffset = await horizontallyScrollFirstFile(page, 320);
  const before = await readSelectionPaintSamples(page);
  await dragAddedTextRange(page, {
    lines: [content],
    horizontalOffset,
    start: { line: 0, offset: 48 },
    end: { line: 0, offset: 58 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(content.slice(48, 58));
  const after = await readSelectionPaintSamples(page);
  expect(after.gutter).toEqual(before.gutter);
  expect(after.code).not.toEqual(before.code);
});

test("dragging within one wide grapheme or outside its cell never opens a review", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("👨‍👩‍👧‍👦tail");
  await useCodeFont(page, 40);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragWithinFirstAddedGrapheme(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  await dragFirstAddedLineIntoHeader(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  const body = await page.getByTestId("diff-file-0-body").boundingBox();
  if (!body) throw new Error("Expanded diff body has no bounds");
  await page.mouse.click(body.x + 60, body.y + 90, { button: "right" });
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});
