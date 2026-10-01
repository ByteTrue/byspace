import { describe, expect, test } from "vitest";

import {
  buildRelayEndpointPatch,
  buildWebOriginPatch,
  parseRelayEndpoint,
  parseWebOrigin,
} from "./onboard.js";

describe("parseWebOrigin", () => {
  test("normalizes an http origin with port", () => {
    expect(parseWebOrigin("http://192.168.1.10:8080")).toEqual({
      baseUrl: "http://192.168.1.10:8080",
      corsOrigin: "http://192.168.1.10:8080",
    });
  });

  test("keeps a subpath and strips trailing slashes", () => {
    expect(parseWebOrigin("https://example.com/byspace/")).toEqual({
      baseUrl: "https://example.com/byspace",
      corsOrigin: "https://example.com",
    });
  });

  test("rejects non-http schemes", () => {
    expect(() => parseWebOrigin("ftp://example.com")).toThrow(/only http/);
  });

  test("rejects scheme-less values", () => {
    expect(() => parseWebOrigin("192.168.1.10:8080")).toThrow(/Invalid --web-origin/);
  });
});

describe("parseRelayEndpoint", () => {
  test("normalizes a bare host:port with the TLS default", () => {
    expect(parseRelayEndpoint("relay.example.com:443")).toEqual({
      endpoint: "relay.example.com:443",
      useTls: true,
    });
  });

  test("defaults the port from the scheme", () => {
    expect(parseRelayEndpoint("relay.example.com")).toEqual({
      endpoint: "relay.example.com:443",
      useTls: true,
    });
    expect(parseRelayEndpoint("ws://relay.example.com")).toEqual({
      endpoint: "relay.example.com:80",
      useTls: false,
    });
    expect(parseRelayEndpoint("wss://relay.example.com")).toEqual({
      endpoint: "relay.example.com:443",
      useTls: true,
    });
  });

  test("keeps an explicit port and derives useTls from the scheme", () => {
    expect(parseRelayEndpoint("ws://relay.example.com:8081")).toEqual({
      endpoint: "relay.example.com:8081",
      useTls: false,
    });
    expect(parseRelayEndpoint("https://relay.example.com:8443")).toEqual({
      endpoint: "relay.example.com:8443",
      useTls: true,
    });
  });

  test("requires brackets for IPv6 literals", () => {
    expect(parseRelayEndpoint("[::1]:8081")).toEqual({
      endpoint: "[::1]:8081",
      useTls: false,
    });
    expect(() => parseRelayEndpoint("::1:8081")).toThrow(/IPv6/);
  });

  test("rejects empty and malformed values", () => {
    expect(() => parseRelayEndpoint("")).toThrow(/endpoint is required/);
    expect(() => parseRelayEndpoint("relay.example.com:notaport")).toThrow(
      /Invalid --relay-endpoint/,
    );
  });
});

describe("buildRelayEndpointPatch", () => {
  const target = { endpoint: "relay.example.com:443", useTls: true };

  test("returns null when endpoint and useTls match", () => {
    expect(
      buildRelayEndpointPatch(target, {
        relay: { enabled: true, endpoint: "relay.example.com:443", useTls: true },
      }),
    ).toBeNull();
  });

  test("patches only the differing field", () => {
    expect(
      buildRelayEndpointPatch(target, {
        relay: { enabled: true, endpoint: "relay.example.com:443", useTls: false },
      }),
    ).toEqual({ relay: { useTls: true } });
    expect(
      buildRelayEndpointPatch(target, {
        relay: { enabled: false, endpoint: "relay.byspace.cc.cd:443", useTls: true },
      }),
    ).toEqual({ relay: { endpoint: "relay.example.com:443" } });
  });

  test("handles a config without relay config", () => {
    expect(buildRelayEndpointPatch(target, null)).toEqual({
      relay: { endpoint: "relay.example.com:443", useTls: true },
    });
  });
});

describe("buildWebOriginPatch", () => {
  const target = { baseUrl: "http://192.168.1.10:8080", corsOrigin: "http://192.168.1.10:8080" };

  test("returns null when already configured", () => {
    expect(
      buildWebOriginPatch(target, {
        app: { baseUrl: "http://192.168.1.10:8080" },
        cors: { allowedOrigins: ["https://app.byspace.cc.cd", "http://192.168.1.10:8080"] },
      }),
    ).toBeNull();
  });

  test("merges into existing allowed origins without dropping them", () => {
    expect(
      buildWebOriginPatch(target, {
        app: { baseUrl: "https://app.byspace.cc.cd" },
        cors: { allowedOrigins: ["https://app.byspace.cc.cd"] },
      }),
    ).toEqual({
      app: { baseUrl: "http://192.168.1.10:8080" },
      cors: { allowedOrigins: ["https://app.byspace.cc.cd", "http://192.168.1.10:8080"] },
    });
  });

  test("skips the cors patch when the origin is already allowed", () => {
    expect(
      buildWebOriginPatch(target, {
        app: { baseUrl: "https://app.byspace.cc.cd" },
        cors: { allowedOrigins: ["http://192.168.1.10:8080"] },
      }),
    ).toEqual({ app: { baseUrl: "http://192.168.1.10:8080" } });
  });

  test("handles a null config", () => {
    expect(buildWebOriginPatch(target, null)).toEqual({
      app: { baseUrl: "http://192.168.1.10:8080" },
      cors: { allowedOrigins: ["http://192.168.1.10:8080"] },
    });
  });
});
