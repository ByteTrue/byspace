import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl,
} from "./connection-offer.js";

function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("connection offer", () => {
  it("decodes base64url JSON payloads", () => {
    const payload = {
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.byspace.cc.cd:443" },
    };

    expect(decodeOfferFragmentPayload(encodeBase64UrlNoPadUtf8(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("parses connection offers from QR-style URLs", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.byspace.cc.cd:443" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.byspace.cc.cd/#offer=${encoded}`)).toEqual(
      offer,
    );
  });

  it("leaves relay TLS unset when absent", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-123",
        daemonPublicKeyB64: "pubkey",
        relay: { endpoint: "relay.example.com:80" },
      }),
    ).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:80" },
    });
  });

  it("round-trips relay TLS in offers without rejecting extra relay fields", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true, extra: "future" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.byspace.cc.cd/#offer=${encoded}`)).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true },
    });
  });

  it("parses authenticated v3 offers without exposing the token outside the fragment", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 3,
      serverId: "srv_AAAAAAAAAAAA",
      daemonPublicKeyB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      clientAuthTokenB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      relay: { endpoint: "relay.byspace.cc.cd:443", useTls: true },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));
    const url = `https://app.byspace.cc.cd/#offer=${encoded}`;

    expect(parseConnectionOfferFromUrl(url)).toEqual(offer);
    expect(new URL(url).search).toBe("");
  });

  it("strictly rejects malformed v3 identity and endpoint fields", () => {
    const valid = {
      v: 3 as const,
      serverId: "srv_AAAAAAAAAAAA",
      daemonPublicKeyB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      clientAuthTokenB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      relay: { endpoint: "relay.byspace.cc.cd:443", useTls: true },
    };
    for (const malformed of [
      { ...valid, serverId: "server-123" },
      { ...valid, daemonPublicKeyB64: "pubkey" },
      { ...valid, clientAuthTokenB64: "too-short" },
      {
        ...valid,
        clientAuthTokenB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh9=",
      },
      { ...valid, relay: { endpoint: "relay.byspace.cc.cd", useTls: true } },
      { ...valid, relay: { endpoint: "relay.byspace.cc.cd:0", useTls: true } },
      { ...valid, relay: { endpoint: "-:443", useTls: true } },
      { ...valid, relay: { endpoint: "relay..example:443", useTls: true } },
      { ...valid, relay: { endpoint: "-relay.example:443", useTls: true } },
      { ...valid, relay: { endpoint: "relay.example-:443", useTls: true } },
      { ...valid, relay: { endpoint: "999.0.0.1:443", useTls: true } },
      { ...valid, relay: { endpoint: "[::::]:443", useTls: true } },
    ]) {
      expect(() => ConnectionOfferSchema.parse(malformed)).toThrow();
    }

    for (const endpoint of [
      "127.0.0.1:8080",
      "[2001:db8::1]:443",
      "[::ffff:192.0.2.128]:443",
      "localhost:8787",
    ]) {
      expect(
        ConnectionOfferSchema.parse({ ...valid, relay: { endpoint, useTls: true } }).relay.endpoint,
      ).toBe(endpoint);
    }
  });

  it("returns null when the URL has no offer fragment", () => {
    expect(parseConnectionOfferFromUrl("https://app.byspace.cc.cd/pair")).toBeNull();
  });
});
