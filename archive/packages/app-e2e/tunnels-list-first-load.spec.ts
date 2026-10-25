import http from "node:http";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { startLocalNodeRelay } from "../support/helpers/local-node-relay";
import { parseConnectionOfferFromUrl } from "@bytetrue/protocol/connection-offer";
import { openTopLevelNavMenu, topLevelNavItem } from "../support/helpers/sidebar-chrome";

const D1_ID = "tunnels-firstload-d1";
const D2_ID = "tunnels-firstload-d2";
const PASSWORD = "tunnel-firstload-password";

/**
 * Issue 076. The tunnels list showed a placeholder forever when the tunnel
 * already existed at first paint, while the RPC answered correctly the whole
 * time.
 *
 * The existing spec could not catch it: it asserts the *add* flow, where the
 * row appears through a refetch after the sheet closes. This spec takes the
 * other path — the tunnel exists before the page loads, so the list can only
 * come from the initial query.
 *
 * Why it reproduced: the app publishes a host's connection status and its
 * client in separate ticks, so the first query ran while d1 read "connecting"
 * with no client. The aggregate answered "connecting" (right), but the query
 * key was built from connection status alone, so nothing refetched when the
 * client landed and the result stayed cached.
 */
test("lists an existing tunnel on first load", async ({ page }) => {
  test.setTimeout(180_000);
  const relay = await startLocalNodeRelay();

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
  // D1 owns the tunnel, so it must be enabled here too.
  const d1 = await startIsolatedHostDaemon(D1_ID, {
    daemonConfig: { auth: { password: hashSync(PASSWORD, 4) }, tunnel: { enabled: true } },
  });

  let d2Client: DaemonClient | null = null;
  let d1Client: DaemonClient | null = null;
  try {
    d2Client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "tunnels-firstload-d2",
      port: d2.port,
      password: PASSWORD,
    });
    const offer = await d2Client.getDaemonPairingOffer();
    const offerPayload = parseConnectionOfferFromUrl(offer.url);
    if (!offerPayload) throw new Error("Expected a decodable pairing offer");

    // Create the tunnel before the page ever loads, through D1's own RPC. The
    // GUI is not involved in establishing it, so the list has nothing to
    // refetch from and must render the initial query's result.
    d1Client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "tunnels-firstload-d1",
      port: d1.port,
      password: PASSWORD,
    });
    await d1Client.createTunnel({
      peerId: D2_ID,
      url: relayClientUrl(offerPayload.relay.endpoint, D2_ID, offerPayload.relay.useTls ?? false),
      password: PASSWORD,
      daemonPublicKeyB64: offerPayload.daemonPublicKeyB64,
      forwards: [{ remotePort: servicePort }],
    });
    const listed = await d1Client.listTunnels();
    expect(listed.entries.length).toBe(1);

    await page.goto("/");
    await page.evaluate(
      ({ endpoint, password, d2Id, relayEndpoint, relayUseTls, daemonPublicKeyB64 }) => {
        const nonce = window.localStorage.getItem("@byspace:e2e-seed-nonce");
        if (!nonce) throw new Error("Expected the e2e seed nonce before replacing the registry.");
        const nowIso = new Date().toISOString();
        const connectionId = "direct:" + endpoint;
        const relayConnectionId = "relay:" + relayEndpoint;
        const registry = [
          {
            serverId: "tunnels-firstload-d1",
            label: "Tunnels D1",
            connections: [{ id: connectionId, type: "directTcp", endpoint, password }],
            preferredConnectionId: connectionId,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          {
            serverId: d2Id,
            label: "Tunnels D2",
            connections: [
              {
                id: relayConnectionId,
                type: "relay",
                relayEndpoint,
                useTls: relayUseTls,
                daemonPublicKeyB64,
              },
            ],
            preferredConnectionId: relayConnectionId,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
        window.localStorage.setItem("@byspace:daemon-registry", JSON.stringify(registry));
        window.localStorage.setItem("@byspace:e2e-disable-default-seed-once", nonce);
      },
      {
        endpoint: "127.0.0.1:" + d1.port,
        password: PASSWORD,
        d2Id: D2_ID,
        relayEndpoint: offerPayload.relay.endpoint,
        relayUseTls: offerPayload.relay.useTls ?? false,
        daemonPublicKeyB64: offerPayload.daemonPublicKeyB64,
      },
    );

    // Enter the way a user does, with the tunnel already in place.
    await page.goto("/");
    await openTopLevelNavMenu(page);
    await topLevelNavItem(page, "sidebar-tunnels").click();

    // No add/refetch interaction: the row has to come from the initial query.
    const row = page.getByTestId("tunnels-row-outbound").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tunnels-row-local-port")).toBeVisible();
    await expect(page.getByText("No tunnels yet")).toHaveCount(0);
  } finally {
    await d1Client?.close().catch(() => undefined);
    await d2Client?.close().catch(() => undefined);
    await d1.close();
    await d2.close();
    await relay.close();
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
});

/**
 * Built by hand rather than importing buildRelayWebSocketUrl: importing that
 * module at spec scope makes Playwright's loader resolve a different copy of
 * @bytetrue/protocol than the client's dist does, and the client then fails to
 * find its own export. The e2e helpers load dist builds directly, so keep this
 * file's imports to the ones the other specs already use.
 */
function relayClientUrl(endpoint: string, serverId: string, useTls: boolean): string {
  const [host, port] = endpoint.split(":");
  const url = new URL(`${useTls ? "wss" : "ws"}://${host}:${port}/ws`);
  url.searchParams.set("serverId", serverId);
  url.searchParams.set("role", "client");
  url.searchParams.set("v", "2");
  return url.toString();
}
