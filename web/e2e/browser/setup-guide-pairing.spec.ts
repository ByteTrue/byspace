import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { test, expect, type Page } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { waitForConnectedHost } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { startLocalGoRelay } from "../support/helpers/local-go-relay";

const SERVER_ID = "setup-guide-pairing";
// Relay is the path that requires a daemon password; loopback and SSH do not. The pairing link
// never carries it, so every entry point has to ask.
const DAEMON_PASSWORD = "setup-guide-secret";

async function startPairableHost() {
  const relay = await startLocalGoRelay();
  const daemon = await startIsolatedHostDaemon(SERVER_ID, {
    mutableRelay: { enabled: true, endpoint: relay.endpoint },
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "setup-guide-pairing",
    port: daemon.port,
  });
  try {
    // The daemon starts from a config that enables the relay; the relay stays off until a password
    // exists, and setting one here is what brings it up.
    await client.patchDaemonConfig({ auth: { password: DAEMON_PASSWORD } });
    const offer = await client.getDaemonPairingOffer();
    expect(offer.relayEnabled).toBe(true);
    expect(offer.url).toContain("#offer=");
    return { relay, daemon, client, offer };
  } catch (error) {
    await client.close().catch(() => undefined);
    await daemon.close();
    await relay.close();
    throw error;
  }
}

async function stopPairableHost(host: Awaited<ReturnType<typeof startPairableHost>>) {
  await host.client.close().catch(() => undefined);
  await host.daemon.close();
  await host.relay.close();
}

async function expectPaired(
  page: Page,
  relay: Awaited<ReturnType<typeof startPairableHost>>["relay"],
) {
  await expect(page.getByTestId("sidebar-settings")).toBeVisible({ timeout: 30_000 });
  await waitForConnectedHost(page, { serverId: SERVER_ID, endpoint: relay.endpoint });
}

// The auto-seed fixture writes a host registry entry on every navigation. Load once to let it write
// the nonce, then replace the registry with an empty one and set its disable-once flag so the
// welcome screen is actually reachable.
async function clearSeededRegistry(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const nonce = window.localStorage.getItem("@byspace:e2e-seed-nonce");
    if (!nonce) {
      throw new Error("Expected the e2e seed nonce before clearing the host registry.");
    }
    window.localStorage.setItem("@byspace:daemon-registry", "[]");
    window.localStorage.setItem("@byspace:e2e-disable-default-seed-once", nonce);
  });
}

const PASTE_FLOWS = [
  {
    name: "the setup guide",
    entryTestId: "welcome-setup-guide",
    modalTestId: "setup-guide-modal",
    linkTestId: "setup-guide-pairing-link-input",
    passwordTestId: "setup-guide-daemon-password-input",
    submitTestId: "setup-guide-submit",
    showsOnboardCommand: true,
  },
  {
    name: "the paste-link form",
    entryTestId: "welcome-paste-pairing-link",
    modalTestId: "pair-link-modal",
    linkTestId: "pair-link-input",
    passwordTestId: "pair-link-daemon-password-input",
    submitTestId: "pair-link-submit",
    showsOnboardCommand: false,
  },
] as const;

// The welcome screen is the only path a self-hoster has from "I just ran `byspace onboard`" to a
// connected app: paste the printed pairing link, press Pair. Every other e2e pairing test seeds the
// host registry directly, so these walk the real path — browser loads the web bundle, talks to a
// real daemon through the real relay, and lands on the connected app shell.
for (const flow of PASTE_FLOWS) {
  test(`pairs with a pasted offer through ${flow.name}`, async ({ page, baseURL }) => {
    const host = await startPairableHost();
    try {
      await clearSeededRegistry(page);

      await page.goto("/welcome");
      await page.getByTestId(flow.entryTestId).click();
      await expect(page.getByTestId(flow.modalTestId)).toBeVisible();

      if (flow.showsOnboardCommand) {
        // A non-hosted origin must teach the self-hosting command, not the hosted one.
        const origin = new URL(baseURL ?? "http://localhost").origin;
        await expect(page.getByTestId("setup-guide-onboard-command")).toContainText(
          "--web-origin " + origin,
        );
      }

      await page.getByTestId(flow.linkTestId).fill(host.offer.url);
      await page.getByTestId(flow.passwordTestId).fill(DAEMON_PASSWORD);
      await page.getByTestId(flow.submitTestId).click();

      await expectPaired(page, host.relay);
    } finally {
      await stopPairableHost(host);
    }
  });
}

// Clicking the link or scanning the QR opens the app with `#offer=` in the fragment. That used to
// import the host on its own and leave it offline (the offer has no password); now it opens the
// pair form with the link filled in.
test("pairs with an offer link", async ({ page }) => {
  const host = await startPairableHost();
  try {
    const hash = new URL(host.offer.url).hash;
    await page.goto(`/${hash}`);

    await expect(page.getByTestId("pair-link-modal")).toBeVisible();
    await expect(page.getByTestId("pair-link-input")).toHaveValue(/#offer=/);

    await page.getByTestId("pair-link-daemon-password-input").fill(DAEMON_PASSWORD);
    await page.getByTestId("pair-link-submit").click();

    await expectPaired(page, host.relay);
  } finally {
    await stopPairableHost(host);
  }
});
