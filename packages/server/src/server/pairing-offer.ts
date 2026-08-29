import type { Logger } from "pino";
import {
  isBySpaceHostedRelayEndpoint,
  resolveBySpaceHostedRelease,
} from "@bytetrue/byspace-protocol/release-channel";

import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";

export interface LocalPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

export async function generateLocalPairingOffer(args: {
  byspaceHome: string;
  releaseVersion?: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  includeQr?: boolean;
  logger?: Logger;
}): Promise<LocalPairingOffer> {
  const hostedRelease = resolveBySpaceHostedRelease(args.releaseVersion ?? resolveDaemonVersion());
  const relayEnabled = args.relayEnabled ?? true;
  if (!relayEnabled) {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }

  const relayEndpoint = args.relayEndpoint ?? hostedRelease.relayEndpoint;
  const relayPublicEndpoint = args.relayPublicEndpoint ?? relayEndpoint;
  const relayUseTls = args.relayUseTls ?? isBySpaceHostedRelayEndpoint(relayEndpoint);
  const relayPublicUseTls =
    args.relayPublicUseTls ??
    (args.relayUseTls === undefined && isBySpaceHostedRelayEndpoint(relayPublicEndpoint)
      ? true
      : relayUseTls);
  const appBaseUrl = args.appBaseUrl ?? hostedRelease.appBaseUrl;
  const serverId = getOrCreateServerId(args.byspaceHome, { logger: args.logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.byspaceHome, args.logger);
  const offer = await createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
  });
  const url = encodeOfferToFragmentUrl({ offer, appBaseUrl });

  if (args.includeQr === false) {
    return {
      relayEnabled: true,
      url,
      qr: null,
    };
  }

  let qr: string | null = null;
  try {
    qr = await renderPairingQr(url);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to render pairing QR");
  }

  return {
    relayEnabled: true,
    url,
    qr,
  };
}
