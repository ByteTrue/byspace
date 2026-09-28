import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { TEST_HOST_LABEL } from "../support/helpers/daemon-registry";
import { getServerId } from "../support/helpers/server-id";
import {
  expectSettingsHeader,
  openSettingsHost,
  openHostSection,
  expectHostLabelDisplayed,
  clickEditHostLabel,
  expectHostLabelEditMode,
  expectHostConnectionsCard,
  expectHostInjectMcpCard,
  expectHostActionCards,
  expectHostProvidersCard,
  expectHostNoDaemonLifecycleRow,
  expectRetiredSidebarSectionsAbsent,
  expectHostPageVisible,
  seedSavedSettingsHosts,
} from "../support/helpers/settings";

async function closeProviderSheet(page: Page) {
  const sheet = page.getByTestId("provider-settings-sheet");
  await sheet.getByLabel("Close", { exact: true }).click();
  await expect(sheet).not.toBeVisible({ timeout: 10_000 });
}

test.describe("Settings host page", () => {
  test("connections section shows the seeded connection endpoint", async ({ page }) => {
    const serverId = getServerId();
    const port = getE2EDaemonPort();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);

    await expectSettingsHeader(page, "Connections");
    await expectHostConnectionsCard(page, port);
  });

  test("agents section shows the inject MCP toggle", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);

    await openHostSection(page, serverId, "agents");
    await expectSettingsHeader(page, "Agents");
    await expectHostInjectMcpCard(page);
  });

  test("a provider's Terminal tab exposes its agent hook switch", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openHostSection(page, serverId, "agents");

    // Terminal integration lives in the provider detail sheet: one switch per
    // provider, on the Terminal face of that provider. The switcher is in the
    // header next to the provider name.
    for (const [providerId, label] of [
      ["claude", "Claude"],
      ["codex", "Codex"],
      ["opencode", "OpenCode"],
      ["pi", "Pi"],
    ] as const) {
      // Exact: the accessible-name match is a substring by default, so "Pi"
      // would also resolve "Oh My Pi".
      await page.getByRole("button", { name: `${label} provider details`, exact: true }).click();
      const sheet = page.getByTestId("provider-settings-sheet");
      await expect(sheet).toBeVisible();
      await sheet
        .getByTestId("provider-sheet-tabs")
        .getByRole("button", { name: "Terminal" })
        .click();
      await expect(
        page.getByTestId(`provider-terminal-hooks-${providerId}-switch`),
      ).toHaveAttribute("aria-checked", "false");
      await closeProviderSheet(page);
      await expect(sheet).toHaveCount(0);
    }
  });

  test("providers section shows the providers card", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);

    await expectHostProvidersCard(page, serverId);
    await expectSettingsHeader(page, "Agents");
  });

  test("host section shows the host label and restart/remove action cards", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);

    await openHostSection(page, serverId, "host");
    await expectSettingsHeader(page, "Overview");
    await expectHostLabelDisplayed(page);
    await expectHostActionCards(page, serverId);
  });

  test("a failed remote daemon update remains visible in the host UI", async ({
    page,
    outdatedDaemon,
  }) => {
    await seedSavedSettingsHosts(page, [outdatedDaemon]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, outdatedDaemon.serverId);
    await openHostSection(page, outdatedDaemon.serverId, "host");

    page.once("dialog", (dialog) => dialog.accept());
    const updateButton = page.getByTestId("host-page-update-button");
    await updateButton.click();

    await expect(
      updateButton.filter({ hasText: /Preparing update|Downloading packages|Installing/ }),
    ).toBeDisabled();

    const updateFailure = page.getByTestId("host-page-update-error");
    await expect(updateFailure).toBeVisible();
    await expect(updateFailure).toContainText("Update failed");
    await expect(updateFailure).toContainText("Failed to update the daemon:");
    await expect(updateButton).toBeEnabled();
  });

  test("clicking the label pencil reveals the inline editor", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openHostSection(page, serverId, "host");

    await expectHostLabelDisplayed(page);
    await clickEditHostLabel(page);
    await expectHostLabelEditMode(page, TEST_HOST_LABEL);
  });

  test("host section does not render daemon lifecycle controls for a remote daemon", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openHostSection(page, serverId, "host");

    // TODO: add a local-daemon fixture for positive daemon lifecycle coverage.
    await expectHostNoDaemonLifecycleRow(page);
  });

  test("settings sidebar exposes the flat App and Host section rows", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    await expectRetiredSidebarSectionsAbsent(page);
  });

  test("navigating to /settings/hosts/[serverId] redirects to the connections section", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await page.goto(`/settings/hosts/${encodeURIComponent(serverId)}`);

    await expectHostPageVisible(page, serverId);
    await expectSettingsHeader(page, "Connections");
    await openHostSection(page, serverId, "host");
    await expectHostLabelDisplayed(page);
    await expectHostActionCards(page, serverId);
  });
});
