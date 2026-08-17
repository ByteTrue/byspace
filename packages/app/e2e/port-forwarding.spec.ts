import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { waitForConnectedHost } from "./helpers/add-project-flow";
import { buildSeededHost } from "./helpers/daemon-registry";
import { type IsolatedHostDaemon, startIsolatedHostDaemon } from "./helpers/isolated-host-daemon";

const EXTRA_HOSTS_KEY = "@byspace:e2e-extra-hosts";
const TARGET_HOST_ID = "port-forward-target";
const TARGET_HOST_LABEL = "Forward Target";
const TARGET_RESPONSE = "byspace-port-forward-ui-ok";

async function startTargetServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(TARGET_RESPONSE);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Target server did not bind TCP");
  return { server, port: address.port };
}

async function addTargetHost(page: Page, host: IsolatedHostDaemon): Promise<void> {
  const registryEntry = buildSeededHost({
    serverId: host.serverId,
    label: TARGET_HOST_LABEL,
    endpoint: `127.0.0.1:${host.port}`,
    nowIso: new Date().toISOString(),
  });
  await page.evaluate(({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])), {
    key: EXTRA_HOSTS_KEY,
    entry: registryEntry,
  });
  await page.reload();
  await waitForConnectedHost(page, {
    serverId: host.serverId,
    endpoint: `localhost:${host.port}`,
  });
}

async function openSidebarPage(page: Page, testId: string): Promise<void> {
  await page.getByTestId("sidebar-pages").click();
  await page.getByTestId(testId).click();
}

async function openPortForwarding(page: Page): Promise<void> {
  await openSidebarPage(page, "sidebar-tunnels");
  await expect(page).toHaveURL(/\/tunnels$/);
  await expect(page.getByTestId("port-forwarding-page")).toBeVisible();
}

async function forwardedAddress(page: Page): Promise<string> {
  const address = page.getByText(/^127\.0\.0\.1:\d+$/).first();
  await expect(address).toBeVisible();
  const value = await address.textContent();
  if (!value) throw new Error("Forward row did not render the local address");
  return value;
}

async function renderedBox(locator: Locator): Promise<{ x: number; width: number }> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  });
}

test.describe("Port forwarding page", () => {
  test.describe.configure({ timeout: 180_000 });

  let targetDaemon: IsolatedHostDaemon;
  let targetServer: Server;
  let targetPort: number;

  test.beforeAll(async () => {
    ({ server: targetServer, port: targetPort } = await startTargetServer());
    targetDaemon = await startIsolatedHostDaemon(TARGET_HOST_ID, { relayEnabled: true });
  });

  test.afterAll(async () => {
    await targetDaemon?.close();
    if (targetServer?.listening) {
      targetServer.close();
      await once(targetServer, "close");
    }
  });

  test("starts, preserves, and cleans up a real Relay forward", async ({ page }, testInfo) => {
    await gotoAppShell(page);
    await addTargetHost(page, targetDaemon);
    await openPortForwarding(page);

    await page.getByTestId("port-forward-target-port-input").fill(String(targetPort));
    await page.getByTestId("port-forward-start").click();

    const row = page.locator('[data-testid^="port-forward-row-"]').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${TARGET_HOST_LABEL}:${targetPort}`);
    const address = await forwardedAddress(page);
    await expect.poll(async () => (await fetch(`http://${address}`)).text()).toBe(TARGET_RESPONSE);

    await openSidebarPage(page, "sidebar-sessions");
    await expect(page).toHaveURL(/\/sessions$/);
    await openPortForwarding(page);
    await expect(row).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("port-forwarding-desktop.png"),
      fullPage: true,
    });
    await row.getByRole("button", { name: "Stop forward" }).click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => {
        try {
          await fetch(`http://${address}`, { signal: AbortSignal.timeout(500) });
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);

    await page.getByTestId("port-forward-target-port-input").fill(String(targetPort));
    await page.getByTestId("port-forward-start").click();
    await expect(row).toBeVisible();
    const reloadAddress = await forwardedAddress(page);
    await expect
      .poll(async () => (await fetch(`http://${reloadAddress}`)).text())
      .toBe(TARGET_RESPONSE);

    await page.reload();
    await expect(page.getByTestId("port-forwarding-page")).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => {
        try {
          await fetch(`http://${reloadAddress}`, { signal: AbortSignal.timeout(500) });
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  });

  test("keeps the form inside a narrow browser viewport", async ({ page }, testInfo) => {
    await gotoAppShell(page);
    await addTargetHost(page, targetDaemon);
    await openPortForwarding(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const form = page.getByTestId("port-forwarding-form");
    await expect(form).toBeVisible();
    const box = await renderedBox(form);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    for (const testId of [
      "port-forward-source",
      "port-forward-target",
      "port-forward-target-port",
      "port-forward-local-port",
      "port-forward-start",
    ]) {
      const control = await renderedBox(page.getByTestId(testId));
      expect(control.x).toBeGreaterThanOrEqual(box.x);
      expect(control.x + control.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }

    await page.screenshot({
      path: testInfo.outputPath("port-forwarding-narrow.png"),
      fullPage: true,
    });
  });
});
