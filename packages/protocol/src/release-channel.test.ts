import { describe, expect, test } from "vitest";
import {
  BETA_HOSTED_RELEASE,
  isBySpaceHostedAppBaseUrl,
  isBySpaceHostedRelayEndpoint,
  resolveBySpaceHostedRelease,
  STABLE_HOSTED_RELEASE,
} from "./release-channel.js";

describe("resolveBySpaceHostedRelease", () => {
  test("maps stable versions to stable infrastructure and npm latest", () => {
    expect(resolveBySpaceHostedRelease("0.2.0")).toEqual(STABLE_HOSTED_RELEASE);
    expect(resolveBySpaceHostedRelease("0.2.0+build.1")).toEqual(STABLE_HOSTED_RELEASE);
    expect(resolveBySpaceHostedRelease("0.2.0+build-with-hyphen")).toEqual(STABLE_HOSTED_RELEASE);
  });

  test("maps every prerelease to beta infrastructure and npm beta", () => {
    expect(resolveBySpaceHostedRelease("0.2.0-beta.2")).toEqual(BETA_HOSTED_RELEASE);
    expect(resolveBySpaceHostedRelease("0.2.0-rc.1")).toEqual(BETA_HOSTED_RELEASE);
  });

  test("rejects malformed versions", () => {
    expect(() => resolveBySpaceHostedRelease("")).toThrow("Invalid BySpace release version");
    expect(() => resolveBySpaceHostedRelease("latest")).toThrow("Invalid BySpace release version");
    expect(() => resolveBySpaceHostedRelease("01.2.3")).toThrow("Invalid BySpace release version");
  });
});

test("recognizes only the two managed hosted endpoint sets", () => {
  expect(isBySpaceHostedAppBaseUrl(STABLE_HOSTED_RELEASE.appBaseUrl)).toBe(true);
  expect(isBySpaceHostedAppBaseUrl(BETA_HOSTED_RELEASE.appBaseUrl)).toBe(true);
  expect(isBySpaceHostedAppBaseUrl("https://byspace.example.com")).toBe(false);
  expect(isBySpaceHostedRelayEndpoint(STABLE_HOSTED_RELEASE.relayEndpoint)).toBe(true);
  expect(isBySpaceHostedRelayEndpoint(BETA_HOSTED_RELEASE.relayEndpoint)).toBe(true);
  expect(isBySpaceHostedRelayEndpoint("relay.example.com:443")).toBe(false);
});
