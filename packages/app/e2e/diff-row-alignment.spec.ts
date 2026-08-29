import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../src/utils/host-routes";
import { test, expect } from "./fixtures";
import { getServerId } from "./helpers/server-id";
import { connectSeedClient } from "./helpers/seed-client";
import { createTempGitRepo } from "./helpers/workspace";
import { openChangesPanel, waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";

interface DirtyWorkspace {
  id: string;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@byspace:app-settings";
const CHANGES_PREFERENCES_KEY = "@byspace:changes-preferences";

const BEFORE = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

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

const AFTER = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

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

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("changes diff paints the aligned code and gutter canvas", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 9);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectStoredCodeFontSize(page, 9);
  await expectCanvasDiffPainted(page);
});

test("changes diff switches between flat and tree file lists", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);
  await expect(page.getByTestId("changes-layout-unified")).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-split")).toHaveCount(0);

  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-layout")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("changes-toggle-whitespace")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByTestId("changes-toggle-wrap-lines")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByTestId("changes-toggle-whitespace").click();
  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-toggle-whitespace")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expectCanvasDiffPainted(page);
  await page.getByTestId("changes-toggle-tree").click();
  const tree = page.getByTestId("changes-tree-rail");
  await expect(tree.getByTestId("diff-folder-src")).toBeVisible();
  await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();

  await tree.getByTestId("diff-folder-src-toggle").click();
  await expect(tree.getByTestId("diff-tree-file-0")).toHaveCount(0);
  await tree.getByTestId("diff-folder-src-toggle").click();
  await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();

  await page.getByTestId("changes-toggle-tree").click();
  await expect(tree).toHaveCount(0);
});

test("working diff tab focus navigation expands and locates the requested file", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  const serverId = getServerId();
  await useUnwrappedDiffLines(page);
  await seedFocusedWorkingDiffTab(page, {
    serverId,
    workspaceId: workspace.id,
    focusPath: "src/use-mounted-tab-set.ts",
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(serverId, workspace.id));
  await waitForWorkspaceTabsVisible(page);

  await expect(page.getByTestId("workspace-tab-working_diff")).toBeVisible();
  await expectCanvasDiffPainted(page);
});

test("changes diff keeps unwrapped gutter and code rows aligned after code size changes", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  await expectCanvasDiffPainted(page);
  const before = await page.getByTestId("git-diff-canvas").screenshot();

  await changeCodeFontSizeFromSettings(page, 18);
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);
  await expectCanvasDiffPainted(page);
  const after = await page.getByTestId("git-diff-canvas").screenshot();
  expect(after.equals(before)).toBe(false);
});

async function expectCanvasDiffPainted(page: Page): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  await expect(body).toBeVisible({ timeout: 30_000 });
  const canvas = page.getByTestId("git-diff-canvas");
  await expect(canvas).toBeAttached();
  await expect
    .poll(
      () =>
        canvas.evaluate(
          (element) =>
            (element as HTMLCanvasElement).width > 0 && (element as HTMLCanvasElement).height > 0,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function seedFocusedWorkingDiffTab(
  page: Page,
  input: { serverId: string; workspaceId: string; focusPath: string },
): Promise<void> {
  await page.addInitScript(({ serverId, workspaceId, focusPath }) => {
    const workspaceKey = `${serverId}:${workspaceId}`;
    localStorage.setItem(
      "workspace-layout-state",
      JSON.stringify({
        state: {
          layoutByWorkspace: {
            [workspaceKey]: {
              root: {
                kind: "pane",
                pane: {
                  id: "main",
                  tabs: [
                    {
                      tabId: "working_diff",
                      target: { kind: "working_diff", focusPath, focusRequestId: 1 },
                      createdAt: 1,
                    },
                  ],
                  tabIds: ["working_diff"],
                  focusedTabId: "working_diff",
                },
              },
              focusedPaneId: "main",
            },
          },
          splitSizesByWorkspace: {},
        },
        version: 1,
      }),
    );
  }, input);
}

async function useCodeFont(page: Page, codeFontSize: number): Promise<void> {
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
          uiFontSize: 16,
          codeFontSize: fontSize,
        }),
      );
    },
    { settingsKey: APP_SETTINGS_KEY, fontSize: codeFontSize },
  );
}

async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: "unified",
          viewMode: "flat",
          wrapLines: false,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function expectFlatFileList(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(page.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toContainText("src");
}

async function createWorkspaceWithMountedTabDiff(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("diff-row-alignment-", {
    files: [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id };
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
  await expectExpandedMountedTabDiff(page);
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expectCanvasDiffPainted(page);
}

async function changeCodeFontSizeFromSettings(page: Page, codeFontSize: number): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("preferences")}$`));
  await page.getByLabel("Code font size").fill(String(codeFontSize));
  await page.getByLabel("Code font size").press("Enter");
  await expect(page.getByLabel("Code font size")).toHaveValue(String(codeFontSize));
  await expectStoredCodeFontSize(page, codeFontSize);
}

async function expectStoredCodeFontSize(page: Page, codeFontSize: number): Promise<void> {
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

async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
  await expectExpandedMountedTabDiff(page);
}
