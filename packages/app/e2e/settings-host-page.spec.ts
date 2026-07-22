import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { gotoAppShell, openSettings } from "./helpers/app";
import { daemonWsRoutePattern, getE2EDaemonPort } from "./helpers/daemon-port";
import { TEST_HOST_LABEL } from "./helpers/daemon-registry";
import { getServerId } from "./helpers/server-id";
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
  expectHostNoLocalOnlyRows,
  expectRetiredSidebarSectionsAbsent,
  expectHostPageVisible,
  seedSavedSettingsHosts,
} from "./helpers/settings";

async function rejectNextConfigWrite(page: Page): Promise<void> {
  let shouldReject = true;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      let request:
        | {
            type?: string;
            requestId?: string;
            config?: { terminalAgentHooks?: unknown; enableTerminalAgentHooks?: unknown };
          }
        | undefined;
      try {
        const envelope = JSON.parse(message.toString()) as {
          type?: string;
          message?: {
            type?: string;
            requestId?: string;
            config?: { terminalAgentHooks?: unknown; enableTerminalAgentHooks?: unknown };
          };
        };
        if (envelope.type === "session") request = envelope.message;
      } catch {
        // Forward non-JSON frames unchanged.
      }
      if (
        shouldReject &&
        request?.type === "set_daemon_config_request" &&
        (request.config?.terminalAgentHooks !== undefined ||
          request.config?.enableTerminalAgentHooks !== undefined) &&
        typeof request.requestId === "string"
      ) {
        shouldReject = false;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: request.requestId,
                requestType: request.type,
                error: "Test config write failure.",
                code: "transport",
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
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

  test("providers section shows the providers card", async ({ page }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);

    await expectHostProvidersCard(page, serverId);
    await expectSettingsHeader(page, "Providers");
    await expect(page.getByTestId("other-terminal-profiles-row")).toBeVisible();
  });

  test("Pi provider separates its model list from Terminal settings", async ({ page }) => {
    const serverId = getServerId();
    await rejectNextConfigWrite(page);

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openHostSection(page, serverId, "providers");

    await page.getByTestId("provider-row-pi").click();
    await expect(page.getByTestId("provider-settings-search")).toBeVisible();
    await page.getByTestId("provider-settings-tab-models").focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByTestId("provider-settings-search")).toHaveCount(0);
    await expect(page.getByTestId("terminal-agent-hook-pi")).toBeVisible();
    const profileRow = page.getByTestId("terminal-profile-row-pi");
    const profileActions = page.getByTestId("terminal-profile-actions-pi");
    await expect(profileRow).toBeVisible();
    await expect(profileRow.getByTestId("terminal-profile-actions-pi")).toHaveCount(0);
    await profileActions.click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Edit profile", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-terminal-add-profile")).toBeVisible();
    await page.getByTestId("terminal-agent-hook-pi").click();
    const updateError = page.getByTestId("provider-terminal-hook-error");
    await expect(updateError).toContainText("Test config write failure.");
    await updateError.getByRole("button", { name: "Dismiss" }).click();
    await expect(updateError).toHaveCount(0);
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

  test("host section does not render pair-device or daemon-lifecycle rows for a remote daemon", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openHostSection(page, serverId, "host");

    // TODO: add local-daemon fixture for positive Pair/Daemon coverage.
    await expectHostNoLocalOnlyRows(page);
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
