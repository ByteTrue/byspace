import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  cleanupTasks,
  createWorkspaceWithExactSelectionDiff,
  dragExactAddedText,
  openSelectionWorkspaceChanges,
  rightClickFirstChangedLine,
  useUnwrappedDiffLines,
} from "./changes-pane-helpers";

// The diff canvas reports the copy outcome from the clipboard write itself. `writeText` resolves
// false when the API refuses and the textarea fallback also fails, so a refused copy must not be
// announced as "Copied".
test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test.describe.configure({ timeout: 180_000 });

async function refuseClipboardWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = () => false;
  });
}

test("canvas diff reports a successful copy", async ({ context, page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await rightClickFirstChangedLine(page);
  await page.getByTestId("diff-source-copy-selection").click();

  await expect(page.getByTestId("app-toast-message")).toContainText("Copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("CDEFGH");
});

test("canvas diff reports a refused copy instead of claiming it copied", async ({ page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);
  await refuseClipboardWrites(page);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await rightClickFirstChangedLine(page);
  await page.getByTestId("diff-source-copy-selection").click();

  const toastMessage = page.getByTestId("app-toast-message");
  await expect(toastMessage).toContainText("Unable to copy");
  await expect(toastMessage).not.toContainText("Copied");
});
