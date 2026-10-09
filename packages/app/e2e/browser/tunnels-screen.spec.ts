import http from "node:http";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { startLocalNodeRelay } from "../support/helpers/local-node-relay";

const D1_ID = "tunnels-gui-d1";
const D2_ID = "tunnels-gui-d2";
const PASSWORD = "tunnel-gui-password";

// The /tunnels screen manages daemon-to-daemon port forwarding (issue 062).
// This walks the real GUI path: a loopback D1 daemon in the app's host
// registry, a relay-paired D2 with a password and a port allowlist, and the
// add-tunnel sheet pasting D2's pairing offer. Success means the outbound row
// lists a local port that serves D2's bytes.
test("creates a tunnel from the GUI and forwards bytes", async ({ page }) => {
  test.setTimeout(180_000);
  const relay = await startLocalNodeRelay();

  // The service D2 exposes: its port lands in D2's allowlist.
  const service = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello from d2 " + req.url);
  });
  await new Promise<void>((resolve) => {
    service.listen(0, "127.0.0.1", () => resolve());
  });
  const servicePort = (service.address() as { port: number }).port;

  const { hashSync } = await import("bcryptjs");
  const d2 = await startIsolatedHostDaemon(D2_ID, {
    mutableRelay: { enabled: true, endpoint: relay.endpoint },
    daemonConfig: {
      auth: { password: hashSync(PASSWORD, 4) },
      tunnel: { enabled: true, allowedPorts: [servicePort] },
    },
  });
  const d1 = await startIsolatedHostDaemon(D1_ID, {
    daemonConfig: { auth: { password: hashSync(PASSWORD, 4) } },
  });

  let d2Client: DaemonClient | null = null;
  try {
    d2Client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "tunnels-gui-d2",
      port: d2.port,
      password: PASSWORD,
    });
    const offer = await d2Client.getDaemonPairingOffer();
    expect(offer.url).toContain("#offer=");

    // Replace the default seeded host registry with the isolated loopback D1.
    // The e2e auto-seed writes on every navigation; use its disable-once flag.
    await page.goto("/");
    await page.evaluate(
      ({ endpoint, password }) => {
        const nonce = window.localStorage.getItem("@byspace:e2e-seed-nonce");
        if (!nonce) throw new Error("Expected the e2e seed nonce before replacing the registry.");
        const nowIso = new Date().toISOString();
        const connectionId = "direct:" + endpoint;
        const registry = [
          {
            serverId: "tunnels-gui-d1",
            label: "Tunnels D1",
            connections: [
              {
                id: connectionId,
                type: "directTcp",
                endpoint,
                password,
              },
            ],
            preferredConnectionId: connectionId,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
        window.localStorage.setItem("@byspace:daemon-registry", JSON.stringify(registry));
        window.localStorage.setItem("@byspace:e2e-disable-default-seed-once", nonce);
      },
      { endpoint: "127.0.0.1:" + d1.port, password: PASSWORD },
    );

    await page.goto("/tunnels");

    // Experimental gate (issue 063): the page opens on the enable card.
    const enableCard = page.getByTestId("tunnels-enable-card");
    await expect(enableCard).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tunnels-enable").click();
    await expect(enableCard).not.toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("tunnels-add")).toBeVisible({ timeout: 30_000 });

    // Open the add-tunnel sheet and fill in D2's offer, password, and port.
    await page.getByTestId("tunnels-add").click();
    const sheet = page.getByTestId("tunnels-add-sheet");
    await expect(sheet).toBeVisible();

    const inputs = sheet.locator("input");
    await inputs.nth(0).fill(offer.url);
    await inputs.nth(1).fill(PASSWORD);
    await inputs.nth(2).fill(String(servicePort));

    await sheet.getByRole("button", { name: /Add tunnel/i }).click();

    // The outbound row appears with a local port once the daemon establishes
    // the tunnel (embedded client dials D2 through the relay).
    const row = page.getByTestId("tunnels-row-outbound").first();
    await expect(row).toBeVisible({ timeout: 45_000 });
    const localPortText = await page.getByTestId("tunnels-row-local-port").textContent();
    const localPort = Number.parseInt((localPortText ?? "").replace(":", "").trim(), 10);
    expect(Number.isInteger(localPort)).toBe(true);

    // Bytes flow: the local port serves D2's service through the relay.
    // The peer dial may still be settling when the row first appears; retry.
    let body: string | null = null;
    for (let attempt = 0; attempt < 30 && body === null; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:" + localPort + "/gui");
        body = await response.text();
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(body).toBe("hello from d2 /gui");
  } finally {
    await d2Client?.close().catch(() => undefined);
    await d1.close();
    await d2.close();
    await relay.close();
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
});
