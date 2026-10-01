import { decodeOfferFragmentPayload, normalizeHostPort } from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import type { HostProfile } from "@/types/host-connection";
import { ConnectionOfferSchema, type ConnectionOffer } from "@bytetrue/protocol/connection-offer";

export type PairOfferErrorKey = "required" | "missingOffer" | "emptyOffer" | "invalid";

export type ParsedPairingOffer =
  | { ok: true; offer: ConnectionOffer }
  | { ok: false; errorKey: PairOfferErrorKey };

/**
 * Parses a pairing link (.../#offer=...) into a validated connection offer.
 * Error keys map onto pairing.link.errors.* i18n keys at the call site.
 */
export function parsePairingOfferUrl(raw: string): ParsedPairingOffer {
  if (!raw) {
    return { ok: false, errorKey: "required" };
  }
  if (!raw.includes("#offer=")) {
    return { ok: false, errorKey: "missingOffer" };
  }
  const idx = raw.indexOf("#offer=");
  const encoded = raw.slice(idx + "#offer=".length).trim();
  if (!encoded) {
    return { ok: false, errorKey: "emptyOffer" };
  }
  try {
    const payload = decodeOfferFragmentPayload(encoded);
    return { ok: true, offer: ConnectionOfferSchema.parse(payload) };
  } catch {
    return { ok: false, errorKey: "invalid" };
  }
}

/**
 * Probes the daemon behind a pairing link and persists the connection.
 * Shared by the paste-pairing-link modal and the setup guide modal.
 */
export async function pairWithOfferUrl(args: {
  rawUrl: string;
  offer: ConnectionOffer;
  knownServerIds: readonly string[];
  upsert: (url: string, hostname?: string) => Promise<HostProfile>;
}): Promise<{ profile: HostProfile; hostname: string | null; isNewHost: boolean }> {
  const { client, hostname } = await connectToDaemon(
    {
      id: "probe",
      type: "relay",
      relayEndpoint: normalizeHostPort(args.offer.relay.endpoint),
      useTls: args.offer.relay.useTls,
      daemonPublicKeyB64: args.offer.daemonPublicKeyB64,
    },
    { serverId: args.offer.serverId },
  );
  await client.close().catch(() => undefined);

  const isNewHost = !args.knownServerIds.includes(args.offer.serverId);
  const profile = await args.upsert(args.rawUrl, hostname ?? undefined);
  return { profile, hostname, isNewHost };
}
