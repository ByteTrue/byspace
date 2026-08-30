import { describe, expect, it } from "vitest";
import {
  BETA_APP_BASE_URL,
  isBySpaceHostedAppBaseUrl,
  resolveBySpaceHostedAppBaseUrl,
  STABLE_APP_BASE_URL,
} from "./release-channel";

describe("resolveBySpaceHostedAppBaseUrl", () => {
  it.each(["0.7.0", "1.2.3+build.5"])("uses the stable app for %s", (version) => {
    expect(resolveBySpaceHostedAppBaseUrl(version)).toBe(STABLE_APP_BASE_URL);
  });

  it.each(["0.7.0-beta.2", "1.2.3-rc.1+build.5"])("uses the beta app for %s", (version) => {
    expect(resolveBySpaceHostedAppBaseUrl(version)).toBe(BETA_APP_BASE_URL);
  });
});

describe("isBySpaceHostedAppBaseUrl", () => {
  it("recognizes only managed BySpace app origins", () => {
    expect(isBySpaceHostedAppBaseUrl("https://app.byspace.cc.cd")).toBe(true);
    expect(isBySpaceHostedAppBaseUrl("https://app-beta.byspace.cc.cd")).toBe(true);
    expect(isBySpaceHostedAppBaseUrl("https://self-hosted.example.com")).toBe(false);
  });
});
