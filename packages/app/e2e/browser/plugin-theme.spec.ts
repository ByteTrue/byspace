import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../fixtures";
import { connectNewWorkspaceDaemonClient } from "../helpers/new-workspace";

const PLUGIN_ID = "plugin-theme-e2e";

// Catppuccin Mocha: base, text, surface0, surface1, mauve, subtext0, overlay0.
const PLUGIN_SOURCE = `export default function contribute(plugin) {
  plugin.addTheme({
    id: "mocha",
    name: "Catppuccin Mocha",
    appearance: "dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      raised: "#313244",
      control: "#45475a",
      border: "#45475a",
      accent: "#cba6f7",
      mutedForeground: "#a6adc8",
      ring: "#6c7086",
    },
  });
  plugin.addTheme({
    id: "latte",
    name: "Catppuccin Latte",
    appearance: "light",
    colors: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      raised: "#e6e9ef",
      control: "#dce0e8",
      border: "#ccd0da",
      accent: "#8839ef",
      mutedForeground: "#6c6f85",
      ring: "#9ca0b0",
    },
  });
  return () => {};
}`;

// settingsStyles.sectionHeaderTitle paints from foregroundMuted, so the section heading proves the
// contributed palette reached the semantic tokens rather than just the swatch.
const MOCHA_MUTED_FOREGROUND = "rgb(166, 173, 200)";
const LATTE_MUTED_FOREGROUND = "rgb(108, 111, 133)";

test("applies a contributed theme and falls back when its plugin is gone", async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(path.join(tmpdir(), "byspace-plugin-theme-e2e-"));
  const client = await connectNewWorkspaceDaemonClient();
  const previousConfig = await client.getDaemonConfig();
  await writeFile(path.join(directory, "byspace-plugin.json"), JSON.stringify({ id: PLUGIN_ID }));
  await writeFile(path.join(directory, "index.ts"), PLUGIN_SOURCE);

  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem("@byspace:app-settings") ?? "{}");
      localStorage.setItem(
        "@byspace:app-settings",
        JSON.stringify({ ...current, theme: "plugin", pluginThemeId: "plugin-theme-e2e:latte" }),
      );
    });
    await page.reload();
    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    const sectionTitle = page.getByText("Preferences", { exact: true }).first();

    await test.step("a contributed light theme uses the light palette", async () => {
      await expect(sectionTitle).toHaveCSS("color", LATTE_MUTED_FOREGROUND, { timeout: 30_000 });
    });

    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem("@byspace:app-settings") ?? "{}");
      localStorage.setItem(
        "@byspace:app-settings",
        JSON.stringify({ ...current, theme: "plugin", pluginThemeId: "plugin-theme-e2e:mocha" }),
      );
    });
    await page.reload();
    await expect(sectionTitle).toHaveCSS("color", MOCHA_MUTED_FOREGROUND, { timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-applied.png"),
      fullPage: true,
    });

    await test.step("the selection survives a reload", async () => {
      await page.reload();
      await expect(sectionTitle).toHaveCSS("color", MOCHA_MUTED_FOREGROUND, { timeout: 30_000 });
    });

    await test.step("removing the plugin falls back to the default theme", async () => {
      await client.removePlugin(PLUGIN_ID);
      await page.reload();
      await expect(sectionTitle).not.toHaveCSS("color", MOCHA_MUTED_FOREGROUND, {
        timeout: 30_000,
      });
      await page.screenshot({
        path: testInfo.outputPath("plugin-theme-fallback.png"),
        fullPage: true,
      });
    });
  } finally {
    await client.removePlugin(PLUGIN_ID).catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previousConfig.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
