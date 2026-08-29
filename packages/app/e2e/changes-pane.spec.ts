import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { buildHostWorkspaceRoute } from "../src/utils/host-routes";
import { getServerId } from "./helpers/server-id";
import { connectSeedClient } from "./helpers/seed-client";
import { createTempGitRepo } from "./helpers/workspace";
import { openChangesPanel, waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";

const CHANGES_PREFERENCES_KEY = "@byspace:changes-preferences";

const BEFORE = `export const tracked = 1;
export const draft = "before";
`;

const AFTER = `export const tracked = 1;
export const draft = "after";
`;

interface DirtyWorkspace {
  id: string;
  repoPath: string;
  cleanup(): Promise<void>;
}

function changesTree(page: Page) {
  return page.getByTestId("changes-tree-rail");
}

function changesContent(page: Page) {
  return page.getByTestId("changes-file-tree");
}

async function createWorkspaceWithMountedTabDiff(options?: {
  includeDeletedFile?: boolean;
}): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options?.includeDeletedFile) {
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
  }
  const repo = await createTempGitRepo("changes-pane-", { files });
  const client = await connectSeedClient();
  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  if (options?.includeDeletedFile) {
    await rm(path.join(repo.path, "src/zz-deleted.ts"));
  }
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to create workspace ${repo.path}`);
    }
    return {
      id: created.workspace.id,
      repoPath: repo.path,
      cleanup: async () => {
        await client.close().catch(() => undefined);
        await repo.cleanup().catch(() => undefined);
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
    throw error;
  }
}

async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: "unified",
          desktopTreeVisible: false,
          wrapLines: false,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
  // Wait for the canvas diff to paint its file headers before interacting; the header
  // DOM nodes mount immediately but their box comes from the canvas model's first paint.
  // (The canvas element itself is absolutely positioned, so its own visibility check is
  // unreliable; the candidate's own diff spec uses the file body as the ready signal.)
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
}

async function expectFlatFileList(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(page.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toContainText("src");
}

async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
  await expect
    .poll(() =>
      page.getByTestId("git-diff-canvas").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return canvas.width > 0 && canvas.height > 0;
      }),
    )
    .toBe(true);
}

async function hoverDiffHeader(locator: ReturnType<Page["getByTestId"]>): Promise<void> {
  // BySpace keeps sticky Changes/Commits chrome above the diff scrollport. Dispatch the same
  // pointer transition directly so Playwright does not auto-scroll the target under that chrome.
  await locator.dispatchEvent("pointerover", { pointerType: "mouse" });
}

test("every interactive file header has the same hover feedback", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  try {
    const first = page.getByTestId("diff-file-0-toggle");
    const second = page.getByTestId("diff-file-1-toggle");
    const normalBackground = await first.evaluate(
      (element) => getComputedStyle(element.parentElement!).backgroundColor,
    );
    await expect
      .poll(() =>
        first.evaluate((element) => getComputedStyle(element.parentElement!).borderTopWidth),
      )
      .toBe("0px");

    await hoverDiffHeader(first);
    const hoverBackground = await first.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(hoverBackground).not.toBe(normalBackground);

    await first.dispatchEvent("click");
    await first.dispatchEvent("pointerout", { pointerType: "mouse" });
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        first.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
      )
      .toBe(normalBackground);
    const [sharedBorder, secondTopBorderWidth] = await Promise.all([
      first.evaluate((element) => getComputedStyle(element.parentElement!).borderBottomColor),
      second.evaluate((element) => getComputedStyle(element.parentElement!).borderTopWidth),
    ]);
    expect(sharedBorder).not.toBe("rgba(0, 0, 0, 0)");
    expect(secondTopBorderWidth).toBe("0px");

    await hoverDiffHeader(first);
    await expect
      .poll(() => first.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(hoverBackground);
    await first.dispatchEvent("pointerout", { pointerType: "mouse" });
    await hoverDiffHeader(second);
    await expect
      .poll(() =>
        first.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
      )
      .toBe(normalBackground);
    await expect
      .poll(() => second.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(hoverBackground);
  } finally {
    await workspace.cleanup();
  }
});

test("desktop Changes toggles a navigation tree beside the expanded diff document", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  try {
    await expectFlatFileList(page);
    // The tree toggle is the one icon action that stays outside the overflow menu.
    await expect(page.getByTestId("changes-toggle-tree")).toBeVisible();

    await scrollToLowerUnwrappedDiffRows(page);
    await page.getByTestId("changes-toggle-tree").click();
    const tree = changesTree(page);
    const content = changesContent(page);
    await expect(tree.getByTestId("diff-folder-src")).toBeVisible();
    await expect(tree.getByTestId("diff-folder-src").getByText("src", { exact: true })).toHaveCSS(
      "user-select",
      "none",
    );
    await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();
    const folderToggleBounds = await tree.getByTestId("diff-folder-src-toggle").boundingBox();
    const folderChevronBounds = await tree
      .getByTestId("diff-folder-src-toggle")
      .locator("svg")
      .boundingBox();
    expect(folderToggleBounds).not.toBeNull();
    expect(folderChevronBounds).not.toBeNull();
    expect(folderChevronBounds!.y + folderChevronBounds!.height / 2).toBeCloseTo(
      folderToggleBounds!.y + folderToggleBounds!.height / 2,
      0,
    );
    const folderLabelBounds = await tree
      .getByTestId("diff-folder-src")
      .getByText("src", { exact: true })
      .boundingBox();
    const fileLabelBounds = await tree
      .getByTestId("diff-tree-file-0")
      .getByText("use-mounted-tab-set.ts", { exact: true })
      .boundingBox();
    expect(folderLabelBounds).not.toBeNull();
    expect(fileLabelBounds).not.toBeNull();
    expect(fileLabelBounds!.x - folderLabelBounds!.x).toBeCloseTo(12, 0);

    const folderToggle = tree.getByTestId("diff-folder-src-toggle");
    await folderToggle.click();
    await expect(folderToggle).toHaveAttribute("aria-selected", "true");
    await expect(tree.getByTestId("diff-tree-file-0")).toHaveCount(0);
    await folderToggle.click();
    await expect(folderToggle).toHaveAttribute("aria-selected", "true");
    await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();

    await expect(content).toBeAttached();
  } finally {
    await workspace.cleanup();
  }
});

test("canvas diff stays sharp while its workspace pane is resized", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  try {
    const canvas = page.getByTestId("git-diff-canvas");
    const root = page.getByTestId("git-diff-canvas-root");
    const handle = page.getByTestId("workspace-split-resize-handle").getByRole("separator");
    await expect(handle).toBeVisible();
    await expect
      .poll(async () => {
        const [canvasWidth, rootWidth] = await Promise.all([
          canvas.evaluate((element) => element.getBoundingClientRect().width),
          root.evaluate((element) => element.getBoundingClientRect().width),
        ]);
        return Math.abs(canvasWidth - rootWidth);
      })
      .toBeLessThan(1);
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
    if (!handleBounds) throw new Error("Workspace split resize handle has no bounds");

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + 120);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x - 120, handleBounds.y + 120);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const duringDrag = await Promise.all([
      canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
      root.evaluate((element) => element.getBoundingClientRect().width),
    ]);
    expect(duringDrag[0]).toBeCloseTo(before.width, 0);
    expect(duringDrag[1]).toBeGreaterThan(before.width + 10);
    const canvasNow = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        bitmapWidth: canvasElement.width,
        ratio: window.devicePixelRatio || 1,
      };
    });
    expect(Math.abs(canvasNow.bitmapWidth / canvasNow.ratio - before.width)).toBeLessThan(2);
    await page.mouse.up();
  } finally {
    await workspace.cleanup();
  }
});
