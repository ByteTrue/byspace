import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BETA_HOSTED_RELEASE,
  STABLE_HOSTED_RELEASE,
} from "@bytetrue/byspace-protocol/release-channel";
import { afterEach, expect, test } from "vitest";
import { generateLocalPairingOffer } from "./pairing-offer.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test.each([
  ["0.2.0", STABLE_HOSTED_RELEASE],
  ["0.2.0-beta.2", BETA_HOSTED_RELEASE],
] as const)(
  "uses hosted pairing defaults for a %s daemon",
  async (releaseVersion, hostedRelease) => {
    const byspaceHome = await mkdtemp(path.join(os.tmpdir(), "byspace-pairing-"));
    homes.push(byspaceHome);

    const pairing = await generateLocalPairingOffer({
      byspaceHome,
      releaseVersion,
      includeQr: false,
    });

    expect(pairing.url?.startsWith(`${hostedRelease.appBaseUrl}/#offer=`)).toBe(true);
    const encoded = pairing.url?.split("#offer=")[1];
    const offer = JSON.parse(Buffer.from(encoded ?? "", "base64url").toString("utf8"));
    expect(offer.relay).toEqual({
      endpoint: hostedRelease.relayEndpoint,
      useTls: true,
    });
  },
);
