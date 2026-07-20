import { describe, expect, test } from "vitest";
import { resolveBySpaceHostedRelease } from "@bytetrue/byspace-protocol/release-channel";
import appPackage from "../../package.json";
import { resolveAppHostedRelease } from "./hosted-release";

describe("resolveAppHostedRelease", () => {
  test("matches the app package release channel", () => {
    expect(resolveAppHostedRelease()).toEqual(resolveBySpaceHostedRelease(appPackage.version));
  });
});
