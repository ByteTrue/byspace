import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";

test("shows only Light, Dark, and System as built-in themes", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  await expect(page.getByLabel("Interface font size")).toBeVisible();
  await expect(page.getByLabel("Content font size")).toBeVisible();
  await expect(page.getByLabel("Code font size")).toBeVisible();
  await expect(page.getByLabel("Interface font family")).toHaveCount(0);
  await expect(page.getByLabel("Code font family")).toHaveCount(0);
  await expect(page.getByLabel(/Highlight theme:/)).toHaveCount(0);

  const themeTrigger = page.getByLabel("Theme: System", { exact: true });
  await themeTrigger.click();
  for (const name of ["Light", "Dark", "System"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Zinc", "Midnight", "Claude", "Ghostty", "Pure black"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("appearance-theme-picker.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("keeps the selected workspace visible in Light", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "light-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "light" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(228, 228, 231)");
    await page.screenshot({
      path: testInfo.outputPath("light-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("applies the interface font size to settings text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiBaseFontSize: 21 }));
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sectionTitle = page.getByText("Theme", { exact: true }).first();
  await expect(sectionTitle).toHaveCSS("font-size", "18px");

  const interfaceSizeInput = page.getByLabel("Interface font size");
  const contentSizeInput = page.getByLabel("Content font size");
  await expect(interfaceSizeInput).toHaveValue("21");
  await expect(contentSizeInput).toHaveValue("21");
  await interfaceSizeInput.fill("12");
  await interfaceSizeInput.press("Tab");

  await expect(interfaceSizeInput).toHaveValue("12");
  await expect(contentSizeInput).toHaveValue("21");
  await expect(sectionTitle).toHaveCSS("font-size", "10px");
});
