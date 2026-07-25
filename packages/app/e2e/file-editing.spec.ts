import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { expectFileTabOpen, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { openSettingsSection } from "./helpers/settings";

function editor(page: Page) {
  return page.getByTestId("file-source-editor").filter({ visible: true }).locator(".cm-content");
}

function modifiedIndicator(page: Page) {
  return page.locator('[data-testid^="workspace-tab-modified-"]').filter({ visible: true });
}

async function replaceEditorText(page: Page, content: string): Promise<void> {
  const contentElement = editor(page);
  await contentElement.click();
  await contentElement.press("Control+A");
  await contentElement.fill(content);
}

async function openWorkspaceFile(page: Page, filename: string): Promise<void> {
  const tree = page.getByTestId("file-explorer-tree-scroll");
  if (!(await tree.isVisible())) await openFileExplorer(page);
  await openFileFromExplorer(page, filename);
  await expectFileTabOpen(page, filename);
}

test.describe("workspace file editing", () => {
  test("autosaves, saves immediately, and resolves external conflicts", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-source-" });
    const sourcePath = path.join(workspace.repoPath, "source.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "source.ts");

    await replaceEditorText(page, "const autosaved = 2;\n");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const autosaved = 2;\n");

    await replaceEditorText(page, "const immediate = 3;\n");
    await editor(page).press("Control+s");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const immediate = 3;\n");

    await writeFile(sourcePath, "const external = 4;\n", "utf8");
    await expect(editor(page)).toContainText("const external = 4;");

    await replaceEditorText(page, "const localWins = 5;\n");
    await writeFile(sourcePath, "const diskLoses = 6;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const localWins = 5;\n");

    await replaceEditorText(page, "const discarded = 7;\n");
    await writeFile(sourcePath, "const diskWins = 8;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(editor(page)).toContainText("const diskWins = 8;");
  });

  test("enables Vim keybindings from Preferences", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-vim-" });
    const sourcePath = path.join(workspace.repoPath, "vim.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();

    await page.getByTestId("sidebar-settings").filter({ visible: true }).click();
    await openSettingsSection(page, "preferences");
    const vimToggle = page.getByRole("switch", { name: "Vim keybindings" });
    await expect(vimToggle).not.toBeChecked();
    await vimToggle.click();
    await expect(vimToggle).toBeChecked();

    await workspace.navigateTo();
    await openWorkspaceFile(page, "vim.ts");
    await editor(page).click();
    await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
    await editor(page).press("i");
    await expect(page.getByText("INSERT", { exact: true })).toBeVisible();
    await editor(page).pressSequentially("X");
    await editor(page).press("Escape");
    await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const initial = 1;\nX");
  });

  test("preserves BOM and CRLF while saving", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-encoding-" });
    const sourcePath = path.join(workspace.repoPath, "windows.ts");
    await writeFile(sourcePath, Buffer.from("\uFEFFconst initial = true;\r\n", "utf8"));
    await workspace.navigateTo();
    await openWorkspaceFile(page, "windows.ts");

    await replaceEditorText(page, "const saved = true;\nconst normalized = true;\n");
    await editor(page).press("Control+s");

    const expected = Buffer.from(
      "\uFEFFconst saved = true;\r\nconst normalized = true;\r\n",
      "utf8",
    ).toString("hex");
    await expect.poll(async () => (await readFile(sourcePath)).toString("hex")).toBe(expected);
  });

  test("preserves a dirty buffer across file deletion and guards pane close", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-draft-" });
    const sourcePath = path.join(workspace.repoPath, "draft.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "draft.ts");

    await replaceEditorText(page, "const local = 2;\n");
    await writeFile(sourcePath, "const external = 3;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await rm(sourcePath);
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await expect(editor(page)).toContainText("const local = 2;");
    await expect(modifiedIndicator(page)).toBeVisible();

    let closePrompt = "";
    page.once("dialog", async (dialog) => {
      closePrompt = dialog.message();
      await dialog.dismiss();
    });
    await page.locator('[data-testid^="workspace-file-close-"]').click();

    await expect.poll(() => closePrompt.toLowerCase()).toContain("unsaved");
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(editor(page)).toContainText("const local = 2;");
  });
});
