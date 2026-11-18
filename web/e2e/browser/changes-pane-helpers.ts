// Shared fixtures for the Changes-pane specs.
//
// The suite was one 2100-line file with 41 tests, and Playwright assigns shards per FILE. Every
// shard count therefore still put all of it on one worker: at 16 shards, that file alone was 46
// test cases on a single runner and set the wall clock at 18 minutes while every other shard
// finished in 10. Splitting it is what makes more shards mean anything.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { connectSeedClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openChangesPanel, waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { createTempGitRepo } from "../support/helpers/workspace";

export interface DirtyWorkspace {
  id: string;
  repoPath: string;
}

export interface WorkspaceFixtureOptions {
  includeDeletedFile?: boolean;
  includeNestedFolders?: boolean;
  includeRenamedFile?: boolean;
  // A root-level file whose name sorts BEFORE the root-level "src" directory.
  // zz-untracked.txt cannot stand in for it: "src" < "zz", so that file lands
  // last whether paths are compared whole or segment by segment.
  includeRootFileSortingFirst?: boolean;
  includeUntrackedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

export const cleanupTasks: CleanupTask[] = [];
export const APP_SETTINGS_KEY = "@byspace:app-settings";

export function changesTree(page: Page) {
  return page.getByTestId("changes-file-tree").filter({ visible: true });
}

export function diffHeaderForPath(panel: Locator, filePath: string): Locator {
  return panel.locator(`[data-diff-header-path="${filePath}"]`).getByTestId(/^diff-file-\d+$/);
}

export async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function failNextDiscardRequest(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      if (typeof message === "string") {
        const envelope = JSON.parse(message) as {
          message?: { type?: string; cwd?: string; requestId?: string };
        };
        if (envelope.message?.type === "checkout.discard_changes.request") {
          browserSocket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "checkout.discard_changes.response",
                payload: {
                  cwd: envelope.message.cwd,
                  success: false,
                  error: { code: "UNKNOWN", message: "Injected revert failure" },
                  requestId: envelope.message.requestId,
                },
              },
            }),
          );
          return;
        }
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => browserSocket.send(message));
  });
}

export const CHANGES_PREFERENCES_KEY = "@byspace:changes-preferences";

export const BEFORE = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds };
}
`;

export const AFTER = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

interface DeriveRenderMountedTabIdsInput {
  activeTabId: string | null;
  availableTabIds: Set<string>;
  cap: number;
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function deriveRenderMountedTabIds(input: DeriveRenderMountedTabIdsInput): Set<string> {
  const { activeTabId, availableTabIds, cap, mountedTabIds } = input;
  if (!activeTabId || !availableTabIds.has(activeTabId) || mountedTabIds.has(activeTabId)) {
    return mountedTabIds;
  }

  const next = new Set<string>([activeTabId]);
  const maxSize = Math.max(1, cap);
  for (const tabId of mountedTabIds) {
    if (next.size >= maxSize) {
      break;
    }
    if (availableTabIds.has(tabId)) {
      next.add(tabId);
    }
  }
  return next;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);
  const renderMountedTabIds = useMemo(
    () =>
      deriveRenderMountedTabIds({
        activeTabId,
        availableTabIds,
        cap,
        mountedTabIds,
      }),
    [activeTabId, availableTabIds, cap, mountedTabIds],
  );

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds: renderMountedTabIds };
}
`;

export async function useCodeFont(page: Page, codeFontSize: number): Promise<void> {
  await page.addInitScript(
    ({ settingsKey, fontSize }) => {
      if (localStorage.getItem(settingsKey)) {
        return;
      }
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          theme: "dark",
          sendBehavior: "interrupt",
          serviceUrlBehavior: "ask",
          terminalScrollbackLines: 10_000,
          uiFontFamily: "",
          monoFontFamily: "",
          uiFontSize: 16,
          codeFontSize: fontSize,
          syntaxTheme: "one",
        }),
      );
    },
    { settingsKey: APP_SETTINGS_KEY, fontSize: codeFontSize },
  );
}

export async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await configureDiffPresentation(page, { layout: "unified", wrapLines: false });
}

export async function configureDiffPresentation(
  page: Page,
  requestedPresentation: { layout: "unified" | "split"; wrapLines: boolean },
): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey, presentation }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: presentation.layout,
          desktopTreeVisible: false,
          wrapLines: presentation.wrapLines,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY, presentation: requestedPresentation },
  );
}

export async function setOpenChangesPresentation(
  page: Page,
  requestedPresentation: { layout: "unified" | "split"; wrapLines: boolean },
): Promise<void> {
  const diffPanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const layoutItem = diffPanel.getByTestId("changes-toggle-layout");
  const currentLayout =
    (await layoutItem.getAttribute("aria-label")) === "Switch to unified diff"
      ? "split"
      : "unified";
  if (currentLayout !== requestedPresentation.layout) {
    await layoutItem.click();
  }

  const wrapItem = diffPanel.getByTestId("changes-toggle-wrap-lines");
  const currentWrapLines = (await wrapItem.getAttribute("aria-label")) === "Scroll long lines";
  if (currentWrapLines !== requestedPresentation.wrapLines) {
    await wrapItem.click();
  }
}

export async function holdBrowserFontLoads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fontSet = document.fonts;
    const originalLoad = fontSet.load.bind(fontSet);
    const pending: Array<() => void> = [];
    Object.defineProperty(fontSet, "load", {
      configurable: true,
      value(font: string, text?: string) {
        return new Promise<FontFace[]>((resolve, reject) => {
          pending.push(() => {
            originalLoad(font, text).then(resolve, reject);
          });
        });
      },
    });
    Object.assign(window, {
      __releaseBySpaceDiffFontLoads() {
        for (const release of pending.splice(0)) release();
      },
    });
  });
}

export async function releaseBrowserFontLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as typeof window & { __releaseBySpaceDiffFontLoads: () => void }
    ).__releaseBySpaceDiffFontLoads();
  });
}

export async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  const canvas = page.getByTestId("git-diff-canvas");
  await expect
    .poll(async () => {
      return canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    })
    .toBe(fontSize);
}

export async function expectDiffCodeFontFamily(page: Page, fontFamily: string): Promise<void> {
  await expect
    .poll(() =>
      page
        .getByTestId("git-diff-canvas")
        .evaluate((element) => getComputedStyle(element).fontFamily),
    )
    .toContain(fontFamily);
}

export async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
}

export async function createWorkspaceWithMountedTabDiff(
  options: WorkspaceFixtureOptions = {},
): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options.includeDeletedFile) {
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
  }
  if (options.includeRenamedFile) {
    files.push({ path: "src/rename-source.ts", content: "export const renamed = true;\n" });
  }
  if (options.includeNestedFolders) {
    files.push(
      { path: "src/zz-folder/root.ts", content: "export const root = 1;\n" },
      { path: "src/zz-folder/nested/changed.ts", content: "export const nested = 1;\n" },
    );
  }
  const repo = await createTempGitRepo("changes-pane-", { files });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  if (options.includeUntrackedFile) {
    await writeFile(path.join(repo.path, "zz-untracked.txt"), "remove me\n");
  }
  if (options.includeRootFileSortingFirst) {
    await writeFile(path.join(repo.path, "a-root-note.txt"), "root note\n");
  }
  if (options.includeDeletedFile) {
    await unlink(path.join(repo.path, "src/zz-deleted.ts"));
  }
  if (options.includeRenamedFile) {
    execFileSync("git", ["mv", "src/rename-source.ts", "src/zz-renamed.ts"], {
      cwd: repo.path,
    });
  }
  if (options.includeNestedFolders) {
    await writeFile(path.join(repo.path, "src/zz-folder/root.ts"), "export const root = 2;\n");
    await writeFile(
      path.join(repo.path, "src/zz-folder/nested/changed.ts"),
      "export const nested = 2;\n",
    );
  }
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

export async function createWorkspaceWithCommittedDiff(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-committed-", {
    files: [{ path: "tracked.ts", content: "export const tracked = 1;\n" }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  execFileSync("git", ["checkout", "-b", "feature"], { cwd: repo.path });
  await writeFile(path.join(repo.path, "committed-only.ts"), "export const committed = true;\n");
  execFileSync("git", ["add", "committed-only.ts"], { cwd: repo.path });
  execFileSync("git", ["commit", "-m", "Add committed-only file"], { cwd: repo.path });

  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create committed workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function createWorkspaceWithScrollableComparisons(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-comparison-focus-", {
    files: [{ path: "tracked.ts", content: "export const tracked = true;\n" }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  const longFile = Array.from(
    { length: 120 },
    (_, index) => `export const line${index} = ${index};`,
  ).join("\n");
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: repo.path });
  await writeComparisonFiles(repo.path, "committed", longFile);
  execFileSync("git", ["add", "committed"], { cwd: repo.path });
  execFileSync("git", ["commit", "-m", "Add committed comparison files"], { cwd: repo.path });
  await writeComparisonFiles(repo.path, "uncommitted", longFile);

  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create comparison workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function writeComparisonFiles(
  repoPath: string,
  directory: "committed" | "uncommitted",
  longFile: string,
): Promise<void> {
  await mkdir(path.join(repoPath, directory), { recursive: true });
  await Promise.all([
    writeFile(path.join(repoPath, directory, "00-before.ts"), `${longFile}\n`),
    writeFile(path.join(repoPath, directory, "50-target.ts"), "export const target = true;\n"),
    writeFile(path.join(repoPath, directory, "99-after.ts"), `${longFile}\n`),
  ]);
}

export async function createWorkspaceWithExactSelectionDiff(
  content: string,
): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-canvas-selection-", {
    files: [{ path: "src/selection.ts", content: "" }],
  });
  await writeFile(path.join(repo.path, "src/selection.ts"), `${content}\n`);
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create selection workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function createWorkspaceWithTwoSelectionDiffs(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-canvas-selection-shift-", {
    files: [
      { path: "src/first.ts", content: "" },
      { path: "src/second.ts", content: "" },
    ],
  });
  await Promise.all([
    writeFile(path.join(repo.path, "src/first.ts"), "FIRST\n"),
    writeFile(path.join(repo.path, "src/second.ts"), "ABCDEFGHIJ\n"),
  ]);
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create selection workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function createWorkspaceWithManyTinyDiffs(fileCount: number): Promise<DirtyWorkspace> {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/file-${String(index).padStart(4, "0")}.ts`,
    content: "export const value = 0;\n",
  }));
  const repo = await createTempGitRepo("changes-canvas-many-files-", { files });
  await Promise.all(
    files.map((file, index) =>
      writeFile(path.join(repo.path, file.path), `export const value = ${index + 1};\n`),
    ),
  );
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create many-file workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function createWorkspaceWithStickyTransitionDiff(): Promise<DirtyWorkspace> {
  const source = Array.from(
    { length: 48 },
    (_, index) => `export const value${index} = ${index};`,
  ).join("\n");
  const files = ["src/first.ts", "src/second.ts"].map((filePath) => ({
    path: filePath,
    content: `${source}\n`,
  }));
  const repo = await createTempGitRepo("changes-canvas-sticky-transition-", { files });
  const changedSource = Array.from(
    { length: 48 },
    (_, index) => `export const value${index} = ${index + 100};`,
  ).join("\n");
  await Promise.all(
    files.map((file) => writeFile(path.join(repo.path, file.path), `${changedSource}\n`)),
  );
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create sticky workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

export async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await page.getByTestId("workspace-explorer-toggle").first().click();
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

export async function openWorkspaceChangesSurface(
  page: Page,
  workspace: DirtyWorkspace,
  timeout?: number,
): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page, timeout);
}

export async function openSelectionWorkspaceChanges(
  page: Page,
  workspace: DirtyWorkspace,
): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
  const diffPanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(diffPanel.getByTestId("diff-file-0")).toHaveAccessibleName(/selection\.ts/, {
    timeout: 30_000,
  });
  await expectExpandedMountedTabDiff(page);
}

export async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  const explorer = page.getByTestId("workspace-explorer-sidebar");
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  const changesTab = explorer.getByRole("button", { name: /Working tree diff/i }).first();
  await changesTab.click();
  const changedFile = explorer
    .locator('[data-testid^="diff-tree-file-"][data-testid$="-toggle"]')
    .filter({ visible: true })
    .first();
  await expect(changedFile).toBeVisible({ timeout: 30_000 });
  await changedFile.click();
  await expect(page.getByTestId("working-diff-panel").filter({ visible: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function selectChangesComparison(
  page: Page,
  comparison: "Committed" | "Uncommitted",
): Promise<void> {
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await tree.getByTestId("changes-diff-status-trigger").click();
  await page.getByTestId(`changes-diff-mode-${comparison.toLowerCase()}`).click();
  await expect(tree.getByTestId("changes-diff-status-trigger")).toContainText(comparison);
}

export async function expectWorkingComparisonFiles(
  page: Page,
  comparison: "committed" | "uncommitted",
): Promise<void> {
  const tree = changesTree(page);
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const paths = ["00-before.ts", "50-target.ts", "99-after.ts"];
  await expect(tree.locator('[data-testid^="diff-tree-file-"][data-testid$="-name"]')).toHaveText(
    paths,
  );
  for (const fileName of paths) {
    await expect(diffHeaderForPath(panel, `${comparison}/${fileName}`)).toBeAttached();
  }
}

export async function selectChangedFileAndExpectFocused(
  page: Page,
  filePath: string,
): Promise<void> {
  const tree = changesTree(page);
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const scroller = panel.getByTestId("git-diff-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });

  await tree.getByText(path.basename(filePath), { exact: true }).click();
  const header = diffHeaderForPath(panel, filePath);
  await expect(header).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const [scrollBounds, headerBounds] = await Promise.all([
    scroller.boundingBox(),
    header.boundingBox(),
  ]);
  if (!scrollBounds || !headerBounds)
    throw new Error("Focused diff header geometry is unavailable");
  expect(headerBounds.y - scrollBounds.y).toBeCloseTo(0, 0);
}

export async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible({ timeout: 30_000 });
}

export async function changeCodeTypographyFromSettings(
  page: Page,
  typography: { fontSize: number; fontFamily: string },
): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("general")}|/settings$`));
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Code font family").fill(typography.fontFamily);
  await page.getByLabel("Code font family").press("Enter");
  await page.getByLabel("Code font size").fill(String(typography.fontSize));
  await page.getByLabel("Code font size").press("Enter");
  await expect(page.getByLabel("Code font family")).toHaveValue(typography.fontFamily);
  await expect(page.getByLabel("Code font size")).toHaveValue(String(typography.fontSize));
  await expectStoredCodeFontSize(page, typography.fontSize);
}

export async function expectStoredCodeFontSize(page: Page, codeFontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (settingsKey) => localStorage.getItem(settingsKey),
        APP_SETTINGS_KEY,
      );
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { codeFontSize?: number }).codeFontSize ?? null;
    })
    .toBe(codeFontSize);
}

export async function startReviewOnFirstChangedLine(
  page: Page,
  side: "unified" | "right" = "unified",
): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const columnLeft = side === "right" ? bodyBounds.x + bodyBounds.width / 2 : bodyBounds.x;
  await page.mouse.move(columnLeft + 20, bodyBounds.y + lineHeight * 1.5);
  await page.getByRole("button", { name: "Add review comment" }).click();
  await expect(page.getByTestId("inline-review-editor")).toBeVisible();
}

export async function clickFirstChangedLine(page: Page): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  await page.mouse.click(bodyBounds.x + 120, bodyBounds.y + lineHeight * 1.5);
}

export async function rightClickFirstChangedLine(page: Page, fileIndex = 0): Promise<void> {
  const body = page.getByTestId(`diff-file-${fileIndex}-body`);
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  await page.mouse.click(bodyBounds.x + 120, bodyBounds.y + lineHeight * 1.5, {
    button: "right",
  });
}

export async function hoverFirstChangedGutter(page: Page): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const gutterWidth = 2 * Math.ceil(fontSize * 0.62) + 12;
  await page.mouse.move(bodyBounds.x + gutterWidth, bodyBounds.y + lineHeight * 1.5);
}

export async function saveInlineReview(page: Page, body: string): Promise<void> {
  await page.getByTestId("inline-review-editor-input").fill(body);
  await page.getByTestId("inline-review-editor-save").click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}

export async function cancelInlineReview(page: Page): Promise<void> {
  await page.getByTestId("inline-review-editor-cancel").click();
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
}

export async function editInlineReview(page: Page, body: string): Promise<void> {
  await page.getByTestId(/^review-comment-edit-/).click();
  await expect(page.getByTestId("inline-review-editor")).toBeVisible();
  await page.getByTestId("inline-review-editor-input").fill(body);
  await page.getByTestId("inline-review-editor-save").click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}

export async function deleteInlineReview(page: Page): Promise<void> {
  await page.getByTestId(/^review-comment-delete-/).click();
  await expect(page.getByTestId(/^review-comment-delete-/)).toHaveCount(0);
}

export async function dragExactAddedText(
  page: Page,
  offsets: { startOffset: number; endOffset: number },
  fileIndex = 0,
): Promise<void> {
  const body = page.getByTestId(`diff-file-${fileIndex}-body`);
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, metrics] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const measurementCanvas = document.createElement("canvas");
      const context = measurementCanvas.getContext("2d")!;
      context.font = `${fontSize}px ${style.fontFamily}`;
      return { fontSize, characterWidth: context.measureText("A").width };
    }),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(metrics.fontSize * 1.5);
  const gutterWidth = Math.max(2, String(1).length) * Math.ceil(metrics.fontSize * 0.62) + 12;
  const textLeft = bodyBounds.x + gutterWidth + 8;
  await page.mouse.move(
    textLeft + offsets.startOffset * metrics.characterWidth + 1,
    bodyBounds.y + lineHeight * 1.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    textLeft + offsets.endOffset * metrics.characterWidth - 1,
    bodyBounds.y + lineHeight * 1.5,
    { steps: 8 },
  );
  await page.mouse.up();
}

export async function dragAddedTextRange(
  page: Page,
  input: {
    lines: string[];
    start: { line: number; offset: number };
    end: { line: number; offset: number };
    side?: "left" | "right";
    wrapped?: boolean;
    horizontalOffset?: number;
  },
): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bounds, metrics] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${fontSize}px ${style.fontFamily}`;
      return { fontSize, characterWidth: context.measureText("A").width };
    }),
  ]);
  if (!bounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(metrics.fontSize * 1.5);
  const gutterWidth = 2 * Math.ceil(metrics.fontSize * 0.62) + 12;
  const columnWidth = input.side ? bounds.width / 2 : bounds.width;
  const columnLeft = input.side === "right" ? bounds.x + columnWidth : bounds.x;
  const availableWidth = columnWidth - gutterWidth - 16;
  const charactersPerFragment = Math.max(1, Math.floor(availableWidth / metrics.characterWidth));
  const fragmentsBefore = (line: number) =>
    input.wrapped
      ? input.lines
          .slice(0, line)
          .reduce(
            (total, text) => total + Math.max(1, Math.ceil(text.length / charactersPerFragment)),
            0,
          )
      : line;
  const point = ({ line, offset }: { line: number; offset: number }) => {
    const fragment = input.wrapped ? Math.floor(offset / charactersPerFragment) : 0;
    const localOffset = input.wrapped ? offset % charactersPerFragment : offset;
    return {
      x:
        columnLeft +
        gutterWidth +
        8 +
        localOffset * metrics.characterWidth -
        (input.horizontalOffset ?? 0),
      y: bounds.y + (1 + fragmentsBefore(line) + fragment + 0.5) * lineHeight,
    };
  };
  const start = point(input.start);
  const end = point(input.end);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

export async function readSelectionPaintSamples(
  page: Page,
  side: "unified" | "right" = "unified",
): Promise<{ gutter: number[]; code: number[]; opposite: number[] }> {
  return page.getByTestId("diff-file-0-body").evaluate((body, selectedSide) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="git-diff-canvas"]')!;
    const bodyBounds = body.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / canvasBounds.width;
    const scaleY = canvas.height / canvasBounds.height;
    const context = canvas.getContext("2d")!;
    const sample = (left: number, top: number, width: number, height: number) =>
      Array.from(
        context.getImageData(
          Math.round((left - canvasBounds.left) * scaleX),
          Math.round((top - canvasBounds.top) * scaleY),
          Math.max(1, Math.round(width * scaleX)),
          Math.max(1, Math.round(height * scaleY)),
        ).data,
      );
    const columnLeft =
      selectedSide === "right" ? bodyBounds.left + bodyBounds.width / 2 : bodyBounds.left;
    return {
      gutter: sample(columnLeft + 2, bodyBounds.top + 24, 8, 8),
      code: sample(columnLeft + 80, bodyBounds.top + 24, 80, 10),
      opposite: sample(bodyBounds.left + 80, bodyBounds.top + 24, 80, 10),
    };
  }, side);
}

export async function dragWithinFirstAddedGrapheme(page: Page): Promise<void> {
  const bodyBounds = await page.getByTestId("diff-file-0-body").boundingBox();
  const fontSize = await page
    .getByTestId("git-diff-canvas")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const gutterWidth = 2 * Math.ceil(fontSize * 0.62) + 12;
  const x = bodyBounds.x + gutterWidth + 10;
  const y = bodyBounds.y + lineHeight * 1.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y, { steps: 3 });
  await page.mouse.up();
}

export async function dragFirstAddedLineIntoHeader(page: Page): Promise<void> {
  const bodyBounds = await page.getByTestId("diff-file-0-body").boundingBox();
  const fontSize = await page
    .getByTestId("git-diff-canvas")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const x = bodyBounds.x + 60;
  await page.mouse.move(x, bodyBounds.y + lineHeight * 1.5);
  await page.mouse.down();
  await page.mouse.move(x, bodyBounds.y - 10, { steps: 4 });
  await page.mouse.up();
}

export async function horizontallyScrollFirstFile(
  page: Page,
  requestedOffset: number,
): Promise<number> {
  const horizontalScroll = page.getByTestId("diff-file-0-horizontal-scroll");
  const retainedOffset = await horizontalScroll.evaluate((element, offset) => {
    element.scrollLeft = offset;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollLeft;
  }, requestedOffset);
  expect(retainedOffset).toBeGreaterThan(0);
  return retainedOffset;
}

export async function measureInFlowHeaderMotion(
  page: Page,
): Promise<{ headerSurface: number; shell: number }> {
  return page.getByTestId("git-diff-scroll").evaluate(async (element) => {
    const scroll = element as HTMLElement;
    const headerSurface = document.querySelector<HTMLElement>('[data-testid="git-diff-canvas"]');
    const shell = document.querySelector<HTMLElement>('[data-diff-header-path="src/second.ts"]');
    if (!headerSurface || !shell) throw new Error("Diff header motion surfaces are unavailable");

    const shellDocumentTop =
      scroll.scrollTop + shell.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    scroll.scrollTop = Math.max(0, shellDocumentTop - scroll.clientHeight + 80);
    scroll.dispatchEvent(new Event("scroll", { bubbles: false }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const before = {
      headerSurface: headerSurface.getBoundingClientRect().top,
      shell: shell.getBoundingClientRect().top,
    };
    scroll.scrollTop += 120;
    const after = {
      headerSurface: headerSurface.getBoundingClientRect().top,
      shell: shell.getBoundingClientRect().top,
    };
    return {
      headerSurface: after.headerSurface - before.headerSurface,
      shell: after.shell - before.shell,
    };
  });
}

export async function longPressFileHeader(page: Page, header: Locator): Promise<void> {
  const bounds = await header.boundingBox();
  if (!bounds) throw new Error("File header has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

export async function headerCanvasPixel(
  canvas: Locator,
  header: Locator,
  offsetY: number,
): Promise<string> {
  const [canvasBounds, headerBounds] = await Promise.all([
    canvas.boundingBox(),
    header.boundingBox(),
  ]);
  if (!canvasBounds || !headerBounds) throw new Error("Canvas header has no bounds");
  return canvas.evaluate(
    (element, point) => {
      const target = element as HTMLCanvasElement;
      const ratio = target.width / target.getBoundingClientRect().width;
      const context = target.getContext("2d");
      if (!context) throw new Error("Canvas header has no 2D context");
      return Array.from(
        context.getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1).data,
      ).join(",");
    },
    { x: 4, y: headerBounds.y - canvasBounds.y + offsetY },
  );
}

export async function readDiffTypographyGeometry(page: Page): Promise<{
  horizontalExtent: number;
  canvasPixels: string;
}> {
  const horizontalExtent = await page
    .getByTestId("diff-file-0-horizontal-scroll")
    .evaluate((element) => element.scrollWidth);
  const canvasPixels = (await page.getByTestId("git-diff-canvas").screenshot()).toString("base64");
  return { horizontalExtent, canvasPixels };
}

export async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

export async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
}
