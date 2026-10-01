import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { waitForConnectedHost } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { startLocalNodeRelay } from "../support/helpers/local-node-relay";

const SERVER_ID = "setup-guide-pairing";

// The welcome screen's setup guide is the only path a self-hoster has from "I just ran
// `byspace onboard`" to a connected app: paste the printed pairing link, press Pair. Every other
// e2e pairing test seeds the host registry directly, so this walks the real path once — browser
// loads the Metro bundle, talks to a real daemon through the real Node relay, and lands on the
// connected app shell.
test("pairs with a pasted offer through the setup guide", async ({ page, baseURL }) => {
  const relay = await startLocalNodeRelay();
  const daemon = await startIsolatedHostDaemon(SERVER_ID, {
    mutableRelay: { enabled: true, endpoint: relay.endpoint },
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "setup-guide-pairing",
    port: daemon.port,
  });
  try {
    const offer = await client.getDaemonPairingOffer();
    expect(offer.relayEnabled).toBe(true);
    expect(offer.url).toContain("#offer=");

    // The auto-seed fixture writes a host registry entry on every navigation. Load once to let it
    // write the nonce, then replace the registry with an empty one and set its disable-once flag so
    // the welcome screen is actually reachable.
    await page.goto("/");
    await page.evaluate(() => {
      const nonce = window.localStorage.getItem("@byspace:e2e-seed-nonce");
      if (!nonce) throw new Error("Expected the e2e seed nonce before clearing the host registry.");
      window.localStorage.setItem("@byspace:daemon-registry", "[]");
      window.localStorage.setItem("@byspace:e2e-disable-default-seed-once", nonce);
    });

    await page.goto("/welcome");
    await page.getByTestId("welcome-setup-guide").click();
    await expect(page.getByTestId("setup-guide-modal")).toBeVisible();

    // A non-hosted origin must teach the self-hosting command, not the hosted one.
    const origin = new URL(baseURL ?? "http://localhost").origin;
    await expect(page.getByTestId("setup-guide-onboard-command")).toContainText(
      "--web-origin " + origin,
    );

    await page.getByTestId("setup-guide-pairing-link-input").fill(offer.url);
    await page.getByTestId("setup-guide-submit").click();

    await expect(page.getByTestId("sidebar-settings")).toBeVisible({ timeout: 30_000 });
    await waitForConnectedHost(page, { serverId: SERVER_ID, endpoint: relay.endpoint });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await relay.close();
  }
});
