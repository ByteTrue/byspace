import { z } from "zod";

/**
 * Relay-only pairing offer.
 *
 * `serverId` is a stable daemon identifier scoped to `PASEO_HOME`, and is also
 * used as the relay session identifier.
 */
const ConnectionOfferRelaySchema = z.object({
  endpoint: z.string().min(1),
  useTls: z.boolean().optional(),
});

const CanonicalKeyBase64Schema = z.string().superRefine((value, context) => {
  try {
    const decoded = globalThis.atob(value);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32 || globalThis.btoa(decoded) !== value) {
      context.addIssue({
        code: "custom",
        message: "must be canonical base64 for exactly 32 bytes",
      });
    }
  } catch {
    context.addIssue({ code: "custom", message: "must be canonical base64 for exactly 32 bytes" });
  }
});

function isValidIPv4(host: string): boolean {
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function isValidHostname(host: string): boolean {
  if (host.length > 253 || /^[0-9.]+$/.test(host)) return false;
  return host
    .split(".")
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    );
}

function isValidIPv6(host: string): boolean {
  try {
    const parsed = new URL(`http://[${host}]:1/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
}

const RelayV3EndpointSchema = z.string().superRefine((value, context) => {
  const bracketed = /^\[([^\]]+)\]:([0-9]{1,5})$/.exec(value);
  const named = /^([^:\[\]]+):([0-9]{1,5})$/.exec(value);
  const host = bracketed?.[1] ?? named?.[1] ?? "";
  const portText = bracketed?.[2] ?? named?.[2] ?? "";
  const validHost = bracketed ? isValidIPv6(host) : isValidIPv4(host) || isValidHostname(host);
  const port = Number(portText);
  if (!validHost || port < 1 || port > 65535) {
    context.addIssue({ code: "custom", message: "must be a valid explicit host:port" });
  }
});

export const ConnectionOfferV2Schema = z.object({
  v: z.literal(2),
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  relay: ConnectionOfferRelaySchema,
});

export const ConnectionOfferV3Schema = z.object({
  v: z.literal(3),
  serverId: z.string().regex(/^srv_[A-Za-z0-9_-]{12}$/, "must be a canonical daemon server ID"),
  daemonPublicKeyB64: CanonicalKeyBase64Schema,
  clientAuthTokenB64: CanonicalKeyBase64Schema,
  relay: z.object({
    endpoint: RelayV3EndpointSchema,
    useTls: z.boolean().optional(),
  }),
});

export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>;
export type ConnectionOfferV3 = z.infer<typeof ConnectionOfferV3Schema>;

export const ConnectionOfferSchema = z.discriminatedUnion("v", [
  ConnectionOfferV2Schema,
  ConnectionOfferV3Schema,
]);
export type ConnectionOffer = z.infer<typeof ConnectionOfferSchema>;

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

const OFFER_FRAGMENT_PREFIX = "#offer=";

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://app.byspace.cc.cd/#offer=<base64url>`.
 *
 * Returns `null` if the input has no `#offer=` fragment. Throws if the fragment
 * exists but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}
