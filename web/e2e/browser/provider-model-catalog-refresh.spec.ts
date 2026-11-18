import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { openModelPicker } from "../support/helpers/agent-profiles";
import { expectComposerVisible } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

const PROVIDER = "refresh-catalog";
const LABEL = "Refresh Catalog";

function models(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `refresh-${index}`,
    label: `Refresh model ${index}`,
    description: "Catalog refresh regression",
  }));
}

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        [PROVIDER]: {
          extends: "pi",
          label: LABEL,
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/fake-pi-rpc.mjs")],
          models: models(17),
        },
      },
    },
  },
});

async function writeCatalogModels(count: number): Promise<void> {
  const home = process.env.E2E_BYSPACE_HOME;
  if (!home) throw new Error("E2E_BYSPACE_HOME is not set");
  const configPath = path.join(home, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.agents.providers[PROVIDER].models = models(count);
  // Change only the catalog source. Going through patchDaemonConfig would invalidate every scope
  // before the Refresh button under test is clicked and would not reproduce the stale-cache bug.
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test("settings Refresh updates the workspace picker and its persisted catalog", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await seedWorkspace({ repoPrefix: "provider-model-refresh-" });
  const agent = await session.client.createAgent({
    provider: PROVIDER,
    cwd: session.repoPath,
    workspaceId: session.workspaceId,
    title: "Provider model refresh e2e",
    model: "refresh-0",
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "provider-model-refresh",
  });

  try {
    // Seed the old project-scoped catalog that a previously used session would already have.
    await client.refreshProvidersSnapshot({ cwd: session.repoPath, providers: [PROVIDER] });
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: agent.id });
    await expectComposerVisible(page);
    await openModelPicker(page);
    const picker = page.getByTestId("combobox-desktop-container").filter({ visible: true });
    await picker.getByPlaceholder("Search models...").fill("Refresh model 20");
    await expect(picker.getByTestId(`model-row-${PROVIDER}-refresh-20`)).toHaveCount(0);
    await page.getByTestId(`selector-header-settings-${PROVIDER}`).click();

    const settings = page.getByTestId("provider-settings-sheet");
    await expect(settings).toBeVisible();
    const discovered = settings.getByText("Discovered", { exact: true }).locator("..");
    await expect(discovered).toContainText("17");

    await writeCatalogModels(21);
    await settings.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(discovered).toContainText("21");

    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(settings).not.toBeVisible();
    await expect(picker.getByTestId(`model-row-${PROVIDER}-refresh-20`)).toBeVisible();

    await page.reload();
    await expectComposerVisible(page);
    await openModelPicker(page);
    const reloadedPicker = page.getByTestId("combobox-desktop-container").filter({ visible: true });
    await reloadedPicker.getByPlaceholder("Search models...").fill("Refresh model 20");
    await expect(reloadedPicker.getByTestId(`model-row-${PROVIDER}-refresh-20`)).toBeVisible();
  } finally {
    await client.close();
    await session.cleanup();
  }
});
